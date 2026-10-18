import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)),
  require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const remote = process.argv.includes("--remote"),
  benchmark = process.argv.includes("--benchmark");
const skipLarge = process.argv.includes("--skip-large");
const count = Number(
    process.argv.find((a) => a.startsWith("--samples="))?.split("=")[1] ?? 100,
  ),
  warmups = 10;
const selectedCases = process.argv
  .find((a) => a.startsWith("--cases="))
  ?.slice("--cases=".length)
  .split(",");
const directory = join(
    root,
    remote ? ".wrangler/owner-runtime-remote" : ".wrangler/bounded-owner-local",
  ),
  state = join(directory, "state");
const evidence = join(
  root,
  process.env.BOUNDED_SAVE_EVIDENCE ??
    "specs/2026-10-16-free-owner-saves/bounded",
);
await mkdir(directory, { recursive: true });
await mkdir(evidence, { recursive: true });
const configs = {
  jobs: join(directory, "jobs.json"),
  web: join(directory, "web.json"),
};
const origin = remote
  ? "https://hasaweb-owner-runtime-web.umerthepro2009.workers.dev"
  : "http://127.0.0.1:8822";
const database = remote ? "hasaweb-owner-runtime-spike" : "bounded-owner-local";
const secrets = remote
  ? JSON.parse(await readFile(join(directory, "secrets.json"), "utf8"))
  : {
      RUNTIME_KEY: randomBytes(32).toString("hex"),
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    };
const tokens = Object.fromEntries(
  ["alice", "bob", "expired", "deleting"].map((id) => [
    id,
    randomBytes(32).toString("hex"),
  ]),
);
let deferredPreparation = false,
  pendingPreparation;
const checks = [],
  samples = [],
  windows = [],
  metrics = [];
let child,
  logs = "",
  completed = false;
function cli(args) {
  const r = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}
async function sql(text) {
  const file = join(directory, "bounded-query.sql");
  await writeFile(file, text);
  const out = cli([
    "d1",
    "execute",
    database,
    "-c",
    configs.jobs,
    remote ? "--remote" : "--local",
    ...(!remote ? ["--persist-to", state] : []),
    ...(remote && /^SELECT\b/i.test(text.trim())
      ? ["--command", text]
      : ["--file", file]),
    "--json",
  ]);
  await rm(file);
  const result = JSON.parse(out.slice(out.indexOf("[\n")));
  for (const row of result) metrics.push(row.meta);
  return result;
}
function cookie(id) {
  const token = tokens[id];
  return `__Host-hasaweb.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secrets.BETTER_AUTH_SECRET).update(token).digest("base64")}`)}`;
}
async function request(action, body = {}, extra = {}) {
  const at = Date.now(),
    start = performance.now(),
    name = extra.name ?? "check";
  const path = action.startsWith("/") ? action : `/api/owner/bounded/${action}`;
  const r = await fetch(`${origin}${path}?case=${name}`, {
    method: extra.method ?? "POST",
    headers: {
      "X-Runtime-Key": secrets.RUNTIME_KEY,
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: extra.id === null ? "" : cookie(extra.id ?? "alice"),
      ...(pendingPreparation
        ? { "X-Fixture-Prepare": JSON.stringify(pendingPreparation) }
        : {}),
      ...extra.headers,
    },
    ...(extra.method === "GET"
      ? {}
      : {
          body:
            typeof body === "string" || body instanceof Uint8Array
              ? body
              : JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(30000),
  });
  pendingPreparation = undefined;
  const text = await r.text();
  if (extra.record !== false)
    samples.push({
      case: name,
      at,
      elapsedMs: +(performance.now() - start).toFixed(3),
      status: r.status,
      rowsRead: Number(r.headers.get("X-Fixture-Rows-Read") ?? 0),
      rowsWritten: Number(r.headers.get("X-Fixture-Rows-Written") ?? 0),
      queries: Number(r.headers.get("X-Fixture-Queries") ?? 0),
      colo: r.headers.get("cf-ray")?.split("-")[1] ?? null,
    });
  const expected = extra.status ?? 200;
  assert.ok(
    (Array.isArray(expected) ? expected : [expected]).includes(r.status),
    `${name} ${action}: ${r.status} ${text.slice(0, 180)}`,
  );
  if (!action.startsWith("/__fixture")) {
    assert.match(r.headers.get("Cache-Control") ?? "", /private.*no-store/);
    assert.equal(r.headers.get("X-Robots-Tag"), "noindex");
  }
  return text ? JSON.parse(text) : null;
}
const prep = (operation, id, template) => {
  if (deferredPreparation) {
    pendingPreparation = { operation, id, template };
    return Promise.resolve({ prepared: true });
  }
  return request(
    "/__fixture/bounded-prepare",
    { operation, id, template },
    { record: false },
  );
};
const progress = { step: "profile", enteredEditor: false };
const change = (op, path, rest = {}) => ({ op, path, ...rest });
let revision = 0;
async function patch(c, extra = {}) {
  const row = await request("patch", { revision, progress, change: c }, extra);
  if (extra.status === undefined) revision = row.revision;
  return row;
}
async function check(name, fn) {
  await fn();
  checks.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function start() {
  child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "-c",
      configs.web,
      "-c",
      configs.jobs,
      "--persist-to",
      state,
      "--port",
      "8822",
      "--ip",
      "127.0.0.1",
      "--inspector-port",
      "9252",
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      logs = (logs + chunk).slice(-10000);
    });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      if (
        (
          await fetch(`${origin}/health`, {
            headers: { "X-Runtime-Key": secrets.RUNTIME_KEY },
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      )
        return;
    } catch {}
    await setTimeout(200);
  }
  throw new Error("Runtime did not start");
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  process.kill(-child.pid, "SIGTERM");
  await Promise.race([exited, setTimeout(5000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null)
    process.kill(-child.pid, "SIGKILL");
}
if (!remote) {
  await rm(state, { recursive: true, force: true });
  const base = {
    compatibility_date: "2026-10-14",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
  };
  await writeFile(
    configs.jobs,
    JSON.stringify({
      ...base,
      name: "bounded-jobs-local",
      main: join(root, "apps/jobs/integration/bounded-owner-runtime.ts"),
      d1_databases: [
        {
          binding: "DB",
          database_name: database,
          database_id: "00000000-0000-0000-0000-000000000012",
        },
      ],
      vars: {
        APP_ENV: "test",
        MEASURE_DB: "true",
        APP_ORIGIN: "https://hasaweb.site",
        RUNTIME_ENABLED: "true",
        GITHUB_CLIENT_ID: "fixture",
        GITHUB_CLIENT_SECRET: "fixture",
        GOOGLE_CLIENT_ID: "fixture",
        GOOGLE_CLIENT_SECRET: "fixture",
      },
    }),
  );
  await writeFile(
    configs.web,
    JSON.stringify({
      ...base,
      name: "bounded-web-local",
      main: join(root, "apps/web/integration/owner-runtime-gateway.ts"),
      services: [
        {
          binding: "OWNER_API",
          service: "bounded-jobs-local",
          entrypoint: "RuntimeOwnerApi",
        },
        { binding: "JOBS", service: "bounded-jobs-local" },
      ],
      vars: { RUNTIME_ORIGIN: origin, RUNTIME_ENABLED: "true" },
    }),
  );
  await writeFile(
    join(directory, ".dev.vars"),
    Object.entries(secrets)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    { mode: 0o600 },
  );
  for (const file of (await readdir(join(root, "packages/db/migrations")))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await sql(
      await readFile(join(root, "packages/db/migrations", file), "utf8"),
    );
}
await sql(
  await readFile(
    join(root, "packages/db/integration/bounded-save.sql"),
    "utf8",
  ),
);
// Generate only the small contract fixture in Node. Dense/large input is built
// inside D1 outside all measured windows; no large fixture-generation Worker.
const esbuild = createRequire(require.resolve("wrangler"))("esbuild");
await esbuild.build({
  stdin: {
    contents: `export {completeDraft} from './packages/schema/src/fixtures.test-support.ts'; export {draftSchema} from './packages/schema/src/draft.ts';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(directory, "fixtures.mjs"),
});
const { completeDraft, draftSchema } = await import(
  fileURLToPath(new URL(`file://${directory}/fixtures.mjs`))
);
const baseDraft = completeDraft(),
  baseJson = JSON.stringify(baseDraft).replaceAll("'", "''");
try {
  const now = Date.now();
  await sql(`DELETE FROM user WHERE id LIKE 'runtime-%';
CREATE TABLE IF NOT EXISTS owner_runtime_fixture(user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,draft TEXT NOT NULL,progress TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS owner_runtime_template(name TEXT PRIMARY KEY,draft TEXT NOT NULL);
DELETE FROM owner_runtime_template;
${Object.keys(tokens)
  .map(
    (
      id,
    ) => `INSERT INTO user(id,name,email,email_verified,created_at,updated_at,deleting_at)VALUES('runtime-${id}','${id}','${id}@runtime.example.test',1,${now},${now},${id === "deleting" ? now : "NULL"});
INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at)VALUES('runtime-session-${id}','${tokens[id]}','runtime-${id}',${id === "expired" ? 1 : now + 7200000},${now},${now});
INSERT INTO owner_runtime_fixture(user_id,draft,progress)VALUES('runtime-${id}','${baseJson}','${JSON.stringify(progress)}');`,
  )
  .join("\n")}
INSERT INTO owner_runtime_template(name,draft)VALUES('full','${baseJson}'),('dense','${baseJson}'),('components','${baseJson}');
UPDATE owner_runtime_template SET draft=json_set(draft,'$.profile.bio','');
UPDATE owner_runtime_template SET draft=json_set(draft,'$.components[3].data.body',json('{"type":"doc","content":[{"type":"paragraph","content":[' || rtrim(replace(hex(zeroblob(17000)),'0','{"type":"text","text":"x"},'),',') || ']}]}')) WHERE name='dense';
UPDATE owner_runtime_template SET draft=json_set(draft,'$.components',json('[' || rtrim(replace(hex(zeroblob(1500)),'0','{"id":"temporary","type":"text","version":1,"data":{"title":"","body":{"type":"doc","content":[]}}},'),',') || ']')) WHERE name='components';
UPDATE owner_runtime_template SET draft=json_set(draft,'$.components',json((SELECT json_group_array(json(json_set(value,'$.id','dense-'||key))) FROM json_each(draft,'$.components')))) WHERE name='components';
UPDATE owner_runtime_template SET draft=json_set(draft,'$.samples',json('{}')) WHERE name='components';
UPDATE owner_runtime_template SET draft=json_set(draft,'$.profile.bio',replace(hex(zeroblob((1048576-length(CAST(draft AS BLOB)))/2)),'0','x') || CASE WHEN (1048576-length(CAST(draft AS BLOB)))%2 THEN 'x' ELSE '' END);
`);
  if (!remote) await start();
  await check(
    "real sessions, missing/tampered/expired/deleting owners, Origin and type guards",
    async () => {
      for (const id of [null, "expired", "deleting"])
        await request("begin", { revision: 0, progress }, { id, status: 401 });
      await request(
        "begin",
        { revision: 0, progress },
        { headers: { Cookie: `${cookie("alice")}x` }, status: 401 },
      );
      await request(
        "begin",
        { revision: 0, progress },
        { headers: { Origin: "https://evil.test" }, status: 403 },
      );
      await request(
        "begin",
        { revision: 0, progress },
        { headers: { "Content-Type": "text/plain" }, status: 415 },
      );
    },
  );
  await check(
    "bounded transport rejects malformed, oversized and unsafe requests",
    async () => {
      await request("patch", new Uint8Array([0x7b, 0xff, 0x7d]), {
        status: 400,
      });
      await request("patch", " ".repeat(8193), { status: 413 });
      await request("patch", '{"revision":NaN}', { status: 400 });
      await request(
        "patch",
        { revision: 0, progress, extra: true },
        { status: 422 },
      );
      await request("__proto__", {}, { status: 404 });
      await request(
        "patch",
        {
          revision: 0,
          progress,
          change: { op: "set", path: ["__proto__"], value: true },
        },
        { status: 422 },
      );
    },
  );
  await check(
    "small atomic patches reject stale revisions and unsafe content",
    async () => {
      await patch(change("set", ["profile", "name"], { value: "New name" }));
      await request(
        "patch",
        {
          revision: 0,
          progress,
          change: change("set", ["profile", "bio"], { value: "stale" }),
        },
        { status: 409 },
      );
      await patch(
        change("set", ["links", 1, "value"], { value: "javascript:alert(1)" }),
        { status: 422 },
      );
      await patch(change("set", ["profile", "unknown"], { value: "x" }), {
        status: 422,
      });
      await patch(change("remove", ["profile", "name"]), { status: 422 });
      await patch(
        change("set", ["profile", "bio"], { value: "x".repeat(6000) }),
        { status: 422 },
      );
    },
  );
  await check("nested cross-document refinements remain enforced", async () => {
    await patch(
      change("append", ["components"], { values: [baseDraft.components[0]] }),
      { status: 409 },
    );
    await patch(
      change("set", ["components", 1, "data", "entries", 0, "categoryId"], {
        value: "missing",
      }),
      { status: 409 },
    );
    await patch(
      change("set", ["components", 2, "data", "entries", 0, "endDate"], {
        value: "2020-01",
      }),
      { status: 409 },
    );
    await patch(
      change("set", ["samples", "components.missing"], { value: true }),
      { status: 409 },
    );
    await patch(change("append", ["links"], { values: [baseDraft.links[0]] }), {
      status: 409,
    });
  });
  await check("parallel saves have one revision winner", async () => {
    const body = {
      revision,
      progress,
      change: change("set", ["profile", "bio"], { value: "one winner" }),
    };
    const rows = await Promise.all(
      Array.from({ length: 4 }, () =>
        request("patch", body, { status: [200, 409] }),
      ),
    );
    const winners = rows.filter((row) => row.revision !== undefined);
    assert.equal(winners.length, 1);
    revision = winners[0].revision;
  });
  await check(
    "nested rich-text list paths use stored discriminators",
    async () => {
      const body = {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Outer" }],
                  },
                  {
                    type: "orderedList",
                    content: [
                      {
                        type: "listItem",
                        content: [
                          {
                            type: "paragraph",
                            content: [{ type: "text", text: "Nested" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      await patch(
        change("set", ["components", 3, "data", "body"], { value: body }),
      );
      const path = [
        "components",
        3,
        "data",
        "body",
        "content",
        0,
        "content",
        0,
        "content",
        1,
        "content",
        0,
        "content",
        0,
        "content",
        0,
        "text",
      ];
      await patch(change("set", path, { value: "Changed" }));
      const saved = await sql(
        "SELECT draft FROM owner_runtime_fixture WHERE user_id='runtime-alice';",
      );
      const actual = draftSchema.parse(JSON.parse(saved[0].results[0].draft));
      let value = actual;
      for (const part of path) value = value[part];
      assert.equal(value, "Changed");
    },
  );
  await check(
    "approved URL and email limits apply to bounded saves",
    async () => {
      const prefix = "https://example.test/";
      const url = `${prefix}${'"'.repeat(2048 - prefix.length)}`;
      const link = { ...baseDraft.links[1], value: url };
      await patch(change("set", ["links", 1], { value: link }));
      await patch(
        change("set", ["links", 1], { value: { ...link, value: `${url}x` } }),
        { status: 422 },
      );
      const email = `${"a".repeat(242)}@example.com`;
      await patch(
        change("set", ["links", 0], {
          value: { ...baseDraft.links[0], value: email },
        }),
      );
      await patch(
        change("set", ["links", 0], {
          value: { ...baseDraft.links[0], value: `a${email}` },
        }),
        { status: 422 },
      );
      for (let i = 0; i < 2; i++)
        await patch(change("set", ["links", i], { value: baseDraft.links[i] }));
    },
  );
  let attempt;
  await check(
    "private attempts, sequence checks, immutable retries and owner isolation",
    async () => {
      attempt = await request("begin", { revision, progress });
      await request(
        "change",
        {
          id: attempt.id,
          sequence: 0,
          change: change("set", ["profile", "name"], {
            value: "Private staging",
          }),
        },
        { id: "bob", status: 409 },
      );
      const command = {
        id: attempt.id,
        sequence: 0,
        change: change("set", ["profile", "name"], {
          value: "Private staging",
        }),
      };
      const first = await request("change", command);
      const retry = await request("change", command);
      assert.equal(first.sequence, retry.sequence);
      assert.equal(retry.replayed, true);
      await request(
        "change",
        {
          ...command,
          change: change("set", ["profile", "name"], { value: "mutated" }),
        },
        { status: 409 },
      );
      attempt.sequence = first.sequence;
      const rows = await sql(
        "SELECT json_extract(draft,'$.profile.name') AS name,revision FROM owner_runtime_fixture WHERE user_id='runtime-alice';",
      );
      assert.equal(rows[0].results[0].name, "New name");
    },
  );
  await check(
    "pending saves survive lost responses and explicit session recovery",
    async () => {
      tokens.alice2 = randomBytes(32).toString("hex");
      const now = Date.now();
      await sql(
        `INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES('runtime-session-alice2','${tokens.alice2}','runtime-alice',${now + 7200000},${now},${now});`,
      );
      const pending = await request("pending");
      assert.equal(pending.id, attempt.id);
      assert.equal(await request("pending", {}, { id: "bob" }), null);
      await request("status", { id: attempt.id }, { id: "bob", status: 409 });
      assert.equal(
        (await request("pending", {}, { id: "alice2" })).requiresResume,
        1,
      );
      const resumed = await request(
        "resume",
        { id: attempt.id },
        { id: "alice2" },
      );
      assert.equal(resumed.sequence, attempt.sequence + 1);
      assert.equal(
        (await request("resume", { id: attempt.id }, { id: "alice2" }))
          .sequence,
        resumed.sequence,
      );
      await request("status", { id: attempt.id }, { status: 409 });
      const back = await request("resume", { id: attempt.id });
      attempt.sequence = back.sequence;
      assert.equal(back.sequence, resumed.sequence + 1);
    },
  );
  await check(
    "UTF-8 text assembly, quote escaping and a single atomic commit",
    async () => {
      let row = await request("string-start", {
        id: attempt.id,
        sequence: attempt.sequence,
        path: ["profile", "bio"],
      });
      attempt.sequence = row.sequence;
      for (const text of ["عمر 👋 ", 'quotes " and \\ newline\n']) {
        const body = { id: attempt.id, sequence: attempt.sequence, text };
        row = await request("piece", body);
        assert.equal((await request("piece", body)).sequence, row.sequence);
        attempt.sequence = row.sequence;
      }
      await request(
        "change",
        {
          id: attempt.id,
          sequence: attempt.sequence,
          change: change("set", ["profile", "name"], { value: "blocked" }),
        },
        { status: 409 },
      );
      row = await request("string-finish", {
        id: attempt.id,
        sequence: attempt.sequence,
      });
      attempt.sequence = row.sequence;
      row = await request("string-start", {
        id: attempt.id,
        sequence: attempt.sequence,
        path: ["profile", "location"],
      });
      attempt.sequence = row.sequence;
      const cleared = await sql(
        `SELECT count(*) AS pieces FROM owner_save_piece WHERE attempt_id='${attempt.id}';`,
      );
      assert.equal(cleared[0].results[0].pieces, 0);
      row = await request("piece", {
        id: attempt.id,
        sequence: attempt.sequence,
        text: "A location",
      });
      row = await request("string-finish", {
        id: attempt.id,
        sequence: row.sequence,
      });
      attempt.sequence = row.sequence;
      const before = await sql(
        "SELECT json_extract(draft,'$.profile.bio') AS bio FROM owner_runtime_fixture WHERE user_id='runtime-alice';",
      );
      assert.notEqual(
        before[0].results[0].bio,
        'عمر 👋 quotes " and \\ newline\n',
      );
      const committed = await request("commit", attempt);
      revision = committed.revision;
      assert.equal((await request("commit", attempt)).replayed, true);
      const after = await sql(
        "SELECT draft FROM owner_runtime_fixture WHERE user_id='runtime-alice';",
      );
      const actual = JSON.parse(after[0].results[0].draft);
      draftSchema.parse(actual);
      assert.equal(actual.profile.bio, 'عمر 👋 quotes " and \\ newline\n');
      await request("abort", { id: attempt.id });
      while ((await request("cleanup")).pieces > 0) {}
    },
  );
  await check(
    "stale staged commits and permanent progress cannot overwrite canonical state",
    async () => {
      const a = await request("begin", { revision, progress });
      await patch(change("set", ["profile", "name"], { value: "Other tab" }));
      await request("commit", a, { status: 409 });
      await request("abort", { id: a.id });
      await request("cleanup");
      const p = { step: "review", enteredEditor: true };
      const row = await request("patch", {
        revision,
        progress: p,
        change: change("set", ["profile", "bio"], { value: "milestone" }),
      });
      revision = row.revision;
      await patch(change("set", ["profile", "bio"], { value: "reset" }), {
        status: 409,
      });
      await sql(
        `UPDATE owner_runtime_fixture SET progress='${JSON.stringify(progress)}' WHERE user_id='runtime-alice';`,
      );
    },
  );
  await check(
    "exact 1 MiB canonical drafts and dense trees retain their contract",
    async () => {
      const sizes = await sql(
        "SELECT name,length(CAST(draft AS BLOB)) AS bytes FROM owner_runtime_template;",
      );
      for (const row of sizes[0].results) assert.equal(row.bytes, 1048576);
      for (const template of ["full", "dense", "components"]) {
        await prep("canonical", undefined, template);
        const row = await request("patch", {
          revision,
          progress,
          change: change(
            "set",
            template === "components"
              ? ["components", 2999, "data", "title"]
              : ["seo", "title"],
            { value: template === "components" ? "" : "My portfolio" },
          ),
        });
        revision = row.revision;
      }
    },
  );
  // Actual large-field upload, not a preparation shortcut. Final maximum-size
  // assembly and commit remain separate measured request classes below.
  await prep("canonical", undefined, "full");
  let largeAttempt = await request("begin", { revision, progress });
  let seq = 0;
  if (!skipLarge) {
    seq = (
      await request("string-start", {
        id: largeAttempt.id,
        sequence: 0,
        path: ["profile", "bio"],
      })
    ).sequence;
    const lengthRows = await sql(
      "SELECT length(json_extract(draft,'$.profile.bio')) AS n FROM owner_runtime_template WHERE name='full';",
    );
    let left = lengthRows[0].results[0].n;
    const pieceStart = new Date().toISOString();
    let pieceIndex = 0;
    while (left) {
      const size = Math.min(4000, left),
        measured = pieceIndex >= warmups && pieceIndex < warmups + count;
      const row = await request(
        "piece",
        { id: largeAttempt.id, sequence: seq, text: "x".repeat(size) },
        {
          name: measured
            ? "piece"
            : pieceIndex < warmups
              ? "warmup-piece"
              : "piece-remainder",
        },
      );
      seq = row.sequence;
      left -= size;
      pieceIndex++;
    }
    windows.push({
      name: "piece",
      from: pieceStart,
      to: new Date().toISOString(),
      clientCount: Math.min(count, pieceIndex - warmups),
    });
    seq = (
      await request("string-finish", { id: largeAttempt.id, sequence: seq })
    ).sequence;
    largeAttempt.sequence = seq;
    await check(
      "maximum individual text is assembled in D1 and published to draft atomically",
      async () => {
        revision = (await request("commit", largeAttempt)).revision;
        const sizes = await sql(
          "SELECT length(CAST(draft AS BLOB)) AS bytes FROM owner_runtime_fixture WHERE user_id='runtime-alice';",
        );
        assert.equal(sizes[0].results[0].bytes, 1048576);
      },
    );
  }
  if (benchmark) {
    const run = async (name, prepare, work) => {
      if (selectedCases && !selectedCases.includes(name)) return;
      const start = new Date().toISOString();
      for (let i = 0; i < warmups + count; i++) {
        deferredPreparation = true;
        try {
          await prepare?.();
          await work(i >= warmups ? name : `warmup-${name}`, i);
        } finally {
          deferredPreparation = false;
          pendingPreparation = undefined;
        }
      }
      windows.push({
        name,
        from: start,
        to: new Date().toISOString(),
        clientCount: count,
      });
      console.log(`Measured ${name}`);
    };
    await run(
      "commit",
      () => prep("open", largeAttempt.id, "full"),
      async (name) => {
        revision = (
          await request(
            "commit",
            { id: largeAttempt.id, sequence: 0 },
            { name },
          )
        ).revision;
      },
    );
    await prep("open", largeAttempt.id, "full");
    seq = 0;
    await run(
      "string-finish",
      () => prep("string", largeAttempt.id),
      async (name) => {
        seq = (
          await request(
            "string-finish",
            { id: largeAttempt.id, sequence: seq },
            { name },
          )
        ).sequence;
      },
    );
    await prep("open", largeAttempt.id, "full");
    seq = 0;
    await run("change", undefined, async (name) => {
      seq = (
        await request(
          "change",
          {
            id: largeAttempt.id,
            sequence: seq,
            change: change("set", ["seo", "title"], { value: "My portfolio" }),
          },
          { name },
        )
      ).sequence;
    });
    for (const template of ["full", "dense", "components"]) {
      await prep("canonical", undefined, template);
      await run(`patch-${template}`, undefined, async (name) => {
        const row = await request(
          "patch",
          {
            revision,
            progress,
            change: change(
              "set",
              template === "components"
                ? ["components", 2999, "data", "title"]
                : ["seo", "title"],
              { value: template === "components" ? "" : "My portfolio" },
            ),
          },
          { name },
        );
        revision = row.revision;
      });
    }
    await prep("canonical", undefined, "full");
    await patch(change("set", ["profile", "bio"], { value: "" }));
    await run("patch-url", undefined, async (name) => {
      const prefix = "https://example.test/";
      await patch(
        change("set", ["links", 1], {
          value: {
            ...baseDraft.links[1],
            value: `${prefix}${'"'.repeat(2048 - prefix.length)}`,
          },
        }),
        { name },
      );
    });
    await run(
      "append",
      () => prep("append"),
      async (name) => {
        await patch(
          change("append", ["components"], {
            values: Array.from({ length: 32 }, (_, i) => ({
              id: `append-${i}`,
              type: "text",
              version: 1,
              data: { title: "", body: { type: "doc", content: [] } },
            })),
          }),
          { name },
        );
      },
    );
    await run(
      "remove",
      () => prep("canonical", undefined, "components"),
      async (name) => {
        await patch(change("remove", ["components", 2999]), { name });
      },
    );
    await run(
      "abort",
      () => prep("open", largeAttempt.id, "full"),
      (name) => request("abort", { id: largeAttempt.id }, { name }),
    );
    await run(
      "cleanup",
      () => prep("cleanup", largeAttempt.id),
      async (name) => {
        const row = await request("cleanup", {}, { name });
        assert.equal(row.pieces, 32);
      },
    );
    // Clear the remaining 32 retained pieces/attempt before timing new starts.
    while ((await request("cleanup")).pieces > 0) {}
    await run(
      "begin",
      () => prep("drop-attempt"),
      async (name) => {
        largeAttempt = await request("begin", { revision, progress }, { name });
      },
    );
    await run(
      "string-start",
      () => prep("open", largeAttempt.id, "full"),
      async (name) => {
        await request(
          "string-start",
          { id: largeAttempt.id, sequence: 0, path: ["profile", "bio"] },
          { name },
        );
      },
    );
    await run("pending", undefined, (name) => request("pending", {}, { name }));
    await run("status", undefined, (name) =>
      request("status", { id: largeAttempt.id }, { name }),
    );
    await run("resume", undefined, (name, i) =>
      request(
        "resume",
        { id: largeAttempt.id },
        { name, id: i % 2 ? "alice" : "alice2" },
      ),
    );
  }
  await prep("canonical", undefined, "full");
  await check(
    "expired attempts cannot commit and cleanup deletes at most 32 pieces",
    async () => {
      await prep("cleanup", largeAttempt.id);
      await request(
        "commit",
        { id: largeAttempt.id, sequence: 0 },
        { status: 409 },
      );
      let removed = 0;
      for (let step = 0; step < 20; step++) {
        const row = await request("cleanup");
        assert.ok(row.pieces <= 32);
        removed += row.pieces;
        if (!row.pieces) break;
      }
      assert.ok(removed >= 64);
      await patch(
        change("set", ["profile", "name"], {
          value: `${baseDraft.profile.name}x`,
        }),
        { status: 409 },
      );
    },
  );
  await check(
    "a revoked creating session can be discarded without waiting for expiry",
    async () => {
      await prep("drop-attempt");
      const next = await request("begin", { revision, progress });
      const string = await request("string-start", {
        id: next.id,
        sequence: next.sequence,
        path: ["profile", "bio"],
      });
      await sql(
        `UPDATE owner_save_attempt SET piece_count=512 WHERE id='${next.id}';`,
      );
      await request(
        "piece",
        { id: next.id, sequence: string.sequence, text: "x" },
        { status: 413 },
      );
      await request("resume", { id: next.id }, { id: "alice2" });
      await sql("DELETE FROM session WHERE id='runtime-session-alice2';");
      assert.equal((await request("cleanup")).attempts, 1);
    },
  );
  await check(
    "revocation/deletion and expiry block staged/direct writes",
    async () => {
      await sql("UPDATE user SET deleting_at=1 WHERE id='runtime-bob';");
      await request(
        "begin",
        { revision: 0, progress },
        { id: "bob", status: 401 },
      );
      await request(
        "patch",
        {
          revision,
          progress,
          change: change("set", ["profile", "name"], { value: "revoked" }),
        },
        { headers: { "X-Runtime-Revoke-At-Write": "true" }, status: 401 },
      );
      await request("begin", { revision, progress }, { status: 401 });
    },
  );
  await check("a real D1 failure returns private 503", async () => {
    await sql(
      "UPDATE user SET deleting_at=NULL WHERE id='runtime-bob'; DROP TABLE owner_runtime_fixture;",
    );
    await request(
      "patch",
      {
        revision: 0,
        progress,
        change: change("set", ["profile", "bio"], { value: "unavailable" }),
      },
      { id: "bob", status: 503 },
    );
  });
  completed = true;
} catch (error) {
  console.error(
    logs
      .replaceAll(secrets.RUNTIME_KEY, "[redacted]")
      .replaceAll(secrets.BETTER_AUTH_SECRET, "[redacted]"),
  );
  throw error;
} finally {
  await stop();
  await writeFile(
    join(evidence, remote ? "deployed-requests.json" : "local-results.json"),
    `${JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        completed,
        remote,
        benchmark,
        count,
        warmups,
        method:
          "Real Better Auth, web adapter and named jobs binding. All supported data mutation calls process bounded input; SQL handles canonical JSON and atomic progress/revision updates. Client elapsed is not CPU. Fixed keyed benchmark preparation executes inside the measured invocation; its extra CPU is conservatively included. Template source sizes are 1 MiB.",
        checks,
        samples,
        windows,
        metrics,
      },
      null,
      2,
    )}\n`,
  );
  await sql("DELETE FROM user WHERE id LIKE 'runtime-%';");
  if (!remote) await rm(join(directory, ".dev.vars"), { force: true });
}
console.log(`Evidence: ${evidence}`);
