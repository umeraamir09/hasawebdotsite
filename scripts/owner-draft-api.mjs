// Actual production router through the built web Worker and named jobs binding.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createEvidenceDirectory } from "./lib/evidence-directory.mjs";
import { writeJsonEvidence } from "./lib/write-json-evidence.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)),
  require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const remote = process.argv.includes("--remote"),
  benchmark = process.argv.includes("--benchmark"),
  readBenchmark = process.argv.includes("--read-benchmark");
const samplesCount = Number(
  process.argv.find((v) => v.startsWith("--samples="))?.split("=")[1] ?? 100,
);
const warmupsCount = Number(
  process.argv.find((v) => v.startsWith("--warmups="))?.split("=")[1] ?? 10,
);
const directory = join(
  root,
  remote ? ".wrangler/owner-runtime-remote" : ".wrangler/owner-draft-api",
);
const state = join(directory, "state"),
  configs = {
    jobs: join(directory, "jobs.json"),
    web: join(directory, "web.json"),
  };
const evidence = await createEvidenceDirectory(
  root,
  "draft-api",
  process.env.DRAFT_API_EVIDENCE ??
    (remote ? "specs/2026-10-17-revision-aware-drafts" : undefined),
);
const origin = remote
  ? "https://hasaweb-owner-runtime-web.umerthepro2009.workers.dev"
  : "http://127.0.0.1:8824";
const database = remote ? "hasaweb-owner-runtime-spike" : "owner-draft-api";
const secrets = remote
  ? JSON.parse(await readFile(join(directory, "secrets.json"), "utf8"))
  : {
      RUNTIME_KEY: randomBytes(32).toString("hex"),
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    };
const tokens = Object.fromEntries(
  [
    "alice",
    "alice-other",
    "bob",
    "revoked",
    "expired",
    "deleting",
    "fresh",
  ].map((id) => [id, randomBytes(24).toString("hex")]),
);
const checks = [],
  samples = [],
  windows = [];
let child,
  logs = "";
await mkdir(directory, { recursive: true });
await mkdir(evidence, { recursive: true });
function cli(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
async function sql(query, values = []) {
  const response = await fetch(`${origin}/__fixture/sql`, {
    method: "POST",
    headers: {
      "X-Runtime-Key": secrets.RUNTIME_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, values }),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).results;
}
function cookie(id) {
  const token = tokens[id];
  return `__Host-hasaweb.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secrets.BETTER_AUTH_SECRET).update(token).digest("base64")}`)}`;
}
async function request(action, body = {}, options = {}) {
  const path = action.startsWith("/") ? action : `/api/owner/draft/${action}`;
  const method = options.method ?? (action.startsWith("/") ? "GET" : "POST");
  const at = Date.now(),
    start = performance.now();
  const response = await fetch(
    `${origin}${path}?case=${options.name ?? "check"}`,
    {
      method,
      headers: {
        "X-Runtime-Key": secrets.RUNTIME_KEY,
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: options.owner === null ? "" : cookie(options.owner ?? "alice"),
        "X-Expected-Owner-Id": `draft-${(options.owner ?? "alice").replace("-other", "")}`,
        ...options.headers,
      },
      ...(method === "GET"
        ? {}
        : {
            body:
              typeof body === "string" || body instanceof Uint8Array
                ? body
                : JSON.stringify(body),
          }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const text = await response.text(),
    elapsedMs = +(performance.now() - start).toFixed(3);
  assert.ok(
    (Array.isArray(options.status)
      ? options.status
      : [options.status ?? 200]
    ).includes(response.status),
    `${action}: ${response.status} ${text.slice(0, 200)}`,
  );
  assert.match(
    response.headers.get("Cache-Control") ?? "",
    /private.*no-store/,
  );
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
  assert.match(response.headers.get("Vary") ?? "", /Cookie/);
  if (response.headers.has("X-Fixture-Queries"))
    assert.ok(
      Number(response.headers.get("X-Fixture-Queries")) <= 50,
      "Free invocation query limit",
    );
  const result = text ? JSON.parse(text) : null;
  if (action === "validation-step" && response.ok) {
    assert.ok(result.examined === undefined || result.examined <= 16);
    assert.ok(
      result.validationBytes === undefined || result.validationBytes <= 4096,
    );
    if (benchmark && options.name) assert.equal(result.issue, null);
  }
  if (action === "cleanup" && response.ok && benchmark && options.name) {
    assert.equal(result.pieces, 32);
    assert.ok(result.attempts <= 1);
  }
  samples.push({
    case: options.name ?? "check",
    at,
    elapsedMs,
    status: response.status,
    rowsRead: response.headers.has("X-Fixture-Rows-Read")
      ? Number(response.headers.get("X-Fixture-Rows-Read"))
      : null,
    rowsWritten: response.headers.has("X-Fixture-Rows-Written")
      ? Number(response.headers.get("X-Fixture-Rows-Written"))
      : null,
    queries: response.headers.has("X-Fixture-Queries")
      ? Number(response.headers.get("X-Fixture-Queries"))
      : null,
    colo: response.headers.get("cf-ray")?.split("-")[1] ?? null,
    ...(response.headers.has("X-Fixture-Same-Environment")
      ? {
          sameEnvironment:
            response.headers.get("X-Fixture-Same-Environment") === "true",
          sameDatabase:
            response.headers.get("X-Fixture-Same-Database") === "true",
        }
      : {}),
    ...(action === "validation-step" && response.ok
      ? {
          examined: result.examined ?? 0,
          validationBytes: result.validationBytes ?? 0,
          complete: result.complete,
        }
      : {}),
    ...(action === "cleanup" && response.ok
      ? { cleanupReceipt: { pieces: result.pieces, attempts: result.attempts } }
      : {}),
  });
  return result;
}
async function check(name, action) {
  if (
    (process.argv.includes("--autosave") ||
      process.argv.includes("--editor")) &&
    !name.startsWith("real session")
  )
    return;
  if (
    process.argv.includes("--legacy-only") &&
    !name.startsWith("real session") &&
    !/bounded validation|legacy corrections|unsupported versions/.test(name)
  )
    return;
  if (
    process.argv.includes("--benchmark-only") &&
    !name.startsWith("real session")
  )
    return;
  await action();
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
      "8824",
      "--ip",
      "127.0.0.1",
      "--inspector-port",
      "9254",
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
      logs = (logs + chunk).slice(-12000);
    });
  for (let i = 0; i < 150; i++) {
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
    if (child.exitCode !== null) throw new Error(logs);
    await setTimeout(200);
  }
  throw new Error(`Runtime did not start. ${logs}`);
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  process.kill(-child.pid, "SIGTERM");
  await Promise.race([exited, setTimeout(5000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null)
    process.kill(-child.pid, "SIGKILL");
  child = undefined;
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
      name: "draft-api-jobs-local",
      main: join(root, "apps/jobs/integration/draft-api-worker.ts"),
      d1_databases: [
        {
          binding: "DB",
          database_name: database,
          database_id: "00000000-0000-0000-0000-000000000013",
          migrations_dir: join(root, "packages/db/migrations"),
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
      name: "draft-api-web-local",
      main: join(root, "apps/web/integration/owner-runtime-gateway.ts"),
      d1_databases: [
        {
          binding: "DB",
          database_name: database,
          database_id: "00000000-0000-0000-0000-000000000013",
        },
      ],
      r2_buckets: [
        { binding: "DRAFT_BUCKET", bucket_name: "draft-api-assets" },
      ],
      services: [
        {
          binding: "OWNER_API",
          service: "draft-api-jobs-local",
          entrypoint: "RuntimeOwnerApi",
        },
        { binding: "JOBS", service: "draft-api-jobs-local" },
      ],
      vars: {
        RUNTIME_ORIGIN: origin,
        RUNTIME_ENABLED: "true",
        APP_ENV: "test",
        GITHUB_CLIENT_ID: "fixture",
        GITHUB_CLIENT_SECRET: "fixture",
        GOOGLE_CLIENT_ID: "fixture",
        GOOGLE_CLIENT_SECRET: "fixture",
      },
    }),
  );
  await writeFile(
    join(directory, ".dev.vars"),
    Object.entries(secrets)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    { mode: 0o600 },
  );
  cli([
    "d1",
    "migrations",
    "apply",
    database,
    "-c",
    configs.jobs,
    "--local",
    "--persist-to",
    state,
  ]);
}
const esbuild = createRequire(require.resolve("wrangler"))("esbuild");
await esbuild.build({
  stdin: {
    contents:
      "export {completeDraft} from './packages/schema/src/fixtures.test-support.ts'; export {readDraft,draftSchema} from './packages/schema/src/index.ts';",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(directory, "fixtures.mjs"),
});
const { completeDraft, readDraft, draftSchema } = await import(
  pathToFileURL(join(directory, "fixtures.mjs"))
);
const fixture = completeDraft(),
  progress = { schemaVersion: 1, step: "profile" };
const read = (owner = "alice") => request("/api/owner/draft", {}, { owner });
const patch = (revision, path, value, extra = {}) =>
  request(
    "patch",
    { context: "content", revision, change: { op: "set", path, value } },
    extra,
  );
const pending = () => request("pending");
const clear = () => sql("DELETE FROM owner_save_attempt");
const setDraft = async (draft, generation = 2) => {
  await clear();
  await sql(
    "UPDATE portfolio SET draft=?,draft_validation_version=?,draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
    [JSON.stringify(draft), generation],
  );
  return (await request("/api/owner/progress")).revision;
};
async function validateUntilStop(attempt, options = {}) {
  let result = { sequence: attempt.sequence };
  for (let i = 0; i < 20000; i++) {
    result = await request(
      "validation-step",
      { id: attempt.id, sequence: result.sequence },
      options,
    );
    assert.ok(result.examined === undefined || result.examined <= 16);
    assert.ok(
      result.validationBytes === undefined || result.validationBytes <= 4096,
    );
    if (result.complete || result.issue) return result;
  }
  throw new Error("Validation failed to terminate");
}
try {
  if (!remote) await start();
  await sql("DELETE FROM user WHERE id LIKE 'draft-%'");
  for (const id of Object.keys(tokens)) {
    const owner = id === "alice-other" ? "alice" : id,
      now = Date.now();
    await sql(
      "INSERT OR IGNORE INTO user(id,name,email,email_verified,deleting_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      [
        `draft-${owner}`,
        owner,
        `${owner}@draft.example.test`,
        1,
        owner === "deleting" ? now : null,
        now,
        now,
      ],
    );
    await sql(
      "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      [
        `draft-session-${id}`,
        tokens[id],
        `draft-${owner}`,
        owner === "expired" ? 1 : now + 7200000,
        now,
        now,
      ],
    );
  }
  await check(
    "real session guards and unchanged provisioning/status contracts",
    async () => {
      for (const owner of [null, "expired", "deleting"])
        await request("/api/owner/draft", {}, { owner, status: 401 });
      for (const owner of ["alice", "bob", "revoked"]) {
        const created = await request(
          "/api/owner/portfolio",
          {},
          { method: "POST", owner },
        );
        assert.deepEqual(Object.keys(created).sort(), ["portfolio", "user"]);
        assert.equal(
          (await request("/api/owner", {}, { owner })).portfolio.id,
          created.portfolio.id,
        );
      }
      await request(
        "/api/owner/draft",
        {},
        { headers: { Cookie: `${cookie("alice")}x` }, status: 401 },
      );
      await request(
        "progress",
        { revision: 0, progress },
        { headers: { Origin: "https://evil.test" }, status: 403 },
      );
      await request(
        "progress",
        { revision: 0, progress },
        { headers: { "Content-Type": "text/plain" }, status: 415 },
      );
      await request("/api/owner/draft", {}, { method: "DELETE", status: 405 });
      assert.deepEqual(
        await request(
          "/api/owner/draft",
          {},
          { headers: { "X-Expected-Owner-Id": "" }, status: 400 },
        ),
        { error: "invalid_input" },
      );
      assert.deepEqual(
        await request(
          "patch",
          {
            context: "content",
            revision: 0,
            change: {
              op: "set",
              path: ["profile", "name"],
              value: "foreign input",
            },
          },
          { headers: { "X-Expected-Owner-Id": "draft-bob" }, status: 409 },
        ),
        { error: "owner_changed" },
      );
    },
  );
  await check(
    "real session missing portfolios return not_found on reads and writes",
    async () => {
      assert.equal(
        (await request("/api/owner", {}, { owner: "fresh" })).portfolio,
        null,
      );
      for (const path of ["/api/owner/draft", "/api/owner/progress"])
        assert.deepEqual(
          await request(path, {}, { owner: "fresh", status: 404 }),
          { error: "not_found" },
        );
      for (const [action, body] of [
        ["begin", { revision: 0, context: "content" }],
        [
          "patch",
          {
            context: "content",
            revision: 0,
            change: { op: "set", path: ["profile", "name"], value: "x" },
          },
        ],
        ["progress", { revision: 0, progress }],
      ])
        assert.deepEqual(
          await request(action, body, { owner: "fresh", status: 404 }),
          { error: "not_found" },
        );
    },
  );
  await check(
    "strict bounded request parsing and unsafe path rejection",
    async () => {
      await request("patch", new Uint8Array([0x7b, 0xff, 0x7d]), {
        status: 400,
      });
      await request("patch", " ".repeat(8193), { status: 413 });
      await request("patch", "{", { status: 400 });
      await request("__proto__", {}, { status: 404 });
      for (const value of [
        {
          context: "content",
          revision: 0,
          progress,
          change: { op: "set", path: ["profile", "name"], value: "x" },
        },
        {
          context: "setup",
          revision: 0,
          progress: { ...progress, enteredEditor: true },
          change: { op: "set", path: ["profile", "name"], value: "x" },
        },
      ])
        await request("patch", value, { status: 422 });
      for (const path of [
        ["__proto__"],
        ["firstEditorEnteredAt"],
        ["publishedVersion"],
        ["userId"],
      ])
        await patch(0, path, "x", { status: 422 });
    },
  );
  let revision;
  await check(
    "consistent reads and atomic content/progress races",
    async () => {
      revision = await setDraft(fixture);
      const saved = await read();
      assert.deepEqual(saved.draft, fixture);
      assert.equal(saved.revision, revision);
      const results = await Promise.all([
        patch(revision, ["profile", "name"], "Winner", { status: [200, 409] }),
        request("progress", { revision, progress }, { status: [200, 409] }),
      ]);
      assert.equal(
        results.filter((row) => row.revision !== undefined).length,
        1,
      );
      revision = (await read()).revision;
      assert.equal(
        (
          await patch(revision - 1, ["profile", "name"], "Stale", {
            status: 409,
          })
        ).error,
        "revision_conflict",
      );
      const before = await read();
      await patch(
        revision,
        ["components", 1, "data", "entries", 0, "categoryId"],
        "missing",
        { status: 409 },
      );
      assert.deepEqual(await read(), before);
      assert.equal(
        (
          await request(
            "/api/owner/draft",
            {},
            {
              headers: { "X-Fixture-Fail-Read": "true" },
              status: 503,
            },
          )
        ).error,
        "storage_unavailable",
      );
      for (let i = 0; i < fixture.components.length; i++)
        revision = (
          await patch(revision, ["components", i], fixture.components[i])
        ).revision;
    },
  );
  await check(
    "approved destination boundaries and cross-document invariants",
    async () => {
      const prefix = "https://example.test/",
        url = prefix + '"'.repeat(2048 - prefix.length),
        email = `${"a".repeat(242)}@example.com`;
      for (const [index, value] of [
        [1, url],
        [0, email],
      ]) {
        revision = (
          await patch(revision, ["links", index], {
            ...fixture.links[index],
            value,
          })
        ).revision;
        await patch(
          revision,
          ["links", index],
          { ...fixture.links[index], value: `${value}x` },
          { status: 422 },
        );
      }
      await request(
        "patch",
        {
          revision,
          context: "content",
          change: {
            op: "append",
            path: ["components"],
            values: [fixture.components[0]],
          },
        },
        { status: 409 },
      );
      await patch(revision, ["samples", "components.missing"], true, {
        status: 409,
      });
      await patch(revision, ["links", 0, "value"], "unsafe", { status: 422 });
    },
  );
  await check(
    "attempt ownership, retries, transfer, stale commits and commit receipts",
    async () => {
      const attempt = await request("begin", {
        revision,
        context: "setup",
        progress,
      });
      assert.equal((await pending()).id, attempt.id);
      for (const action of ["status", "resume", "abort"])
        await request(
          action,
          { id: attempt.id },
          { owner: "bob", status: 409 },
        );
      const command = {
        id: attempt.id,
        sequence: 0,
        change: { op: "set", path: ["profile", "name"], value: "Prepared" },
      };
      await request(
        "change",
        { ...command, context: "content" },
        { status: 422 },
      );
      assert.equal((await request("change", command)).sequence, 1);
      assert.equal((await request("change", command)).replayed, true);
      await request(
        "change",
        { ...command, change: { ...command.change, value: "Mutated" } },
        { status: 409 },
      );
      assert.notEqual((await read()).draft.profile.name, "Prepared");
      const transferred = await request(
        "resume",
        { id: attempt.id },
        { owner: "alice-other" },
      );
      assert.equal(transferred.sequence, 2);
      assert.equal(
        (await request("resume", { id: attempt.id }, { owner: "alice-other" }))
          .sequence,
        2,
      );
      await request("commit", { id: attempt.id, sequence: 2 }, { status: 409 });
      revision = (
        await request(
          "commit",
          { id: attempt.id, sequence: 2 },
          { owner: "alice-other" },
        )
      ).revision;
      assert.equal(
        (
          await request(
            "commit",
            { id: attempt.id, sequence: 2 },
            { owner: "alice-other" },
          )
        ).replayed,
        true,
      );
      assert.equal((await pending()).state, "committed");
      await request("cleanup");
      const stale = await request("begin", { revision, context: "content" });
      revision = (await patch(revision, ["profile", "name"], "Newer")).revision;
      await request("commit", { id: stale.id, sequence: 0 }, { status: 409 });
      await request("abort", { id: stale.id });
      await request("cleanup");
    },
  );
  await check(
    "large free text, encoded pieces and exact document ceiling",
    async () => {
      revision = await setDraft(fixture);
      const base = structuredClone(fixture);
      base.profile.bio = "";
      const length = 1048576 - Buffer.byteLength(JSON.stringify(base)),
        attempt = await request("begin", { revision, context: "content" });
      let sequence = (
        await request("string-start", {
          id: attempt.id,
          sequence: 0,
          path: ["profile", "bio"],
        })
      ).sequence;
      for (let offset = 0; offset < length; offset += 4000)
        sequence = (
          await request("piece", {
            id: attempt.id,
            sequence,
            text: "x".repeat(Math.min(4000, length - offset)),
          })
        ).sequence;
      await request(
        "piece",
        { id: attempt.id, sequence, text: "x".repeat(4095) },
        { status: 422 },
      );
      const finished = await request("string-finish", {
        id: attempt.id,
        sequence,
      });
      sequence = finished.sequence;
      assert.equal(
        (
          await request("string-finish", {
            id: attempt.id,
            sequence: sequence - 1,
          })
        ).replayed,
        true,
      );
      revision = (await request("commit", { id: attempt.id, sequence }))
        .revision;
      const saved = await read();
      assert.equal(Buffer.byteLength(JSON.stringify(saved.draft)), 1048576);
      draftSchema.parse(saved.draft);
      await patch(revision, ["profile", "bio"], "y".repeat(6000), {
        status: 422,
      });
      await patch(
        revision,
        ["profile", "name"],
        `${saved.draft.profile.name}x`,
        { status: 409 },
      );
      const cleaned = await request("cleanup");
      assert.ok(cleaned.pieces <= 32);
      while (await pending()) {
        const batch = await request("cleanup");
        assert.ok(batch.pieces <= 32);
      }
      const unicode = await request("begin", { revision, context: "content" });
      sequence = (
        await request("string-start", {
          id: unicode.id,
          sequence: 0,
          path: ["profile", "bio"],
        })
      ).sequence;
      sequence = (
        await request("piece", { id: unicode.id, sequence, text: "\ud83d" })
      ).sequence;
      await request(
        "piece",
        { id: unicode.id, sequence, text: "\ude00" },
        { status: 422 },
      );
      await request("abort", { id: unicode.id });
      await request("cleanup");
    },
  );
  await check(
    "bounded validation agrees with full reference schemas",
    async () => {
      const valid = [
        fixture,
        {
          ...fixture,
          profile: { ...fixture.profile, bio: "lone \ud83d and \ude00" },
        },
        {
          ...fixture,
          profile: { ...fixture.profile, bio: "\u0000😀".repeat(5000) },
        },
        { ...fixture, schemaVersion: 1 },
      ];
      const invalid = [];
      // Walk to the actual shared depth boundary, including a maximum URL at
      // the deepest valid text mark. This also catches cursor-budget stalls.
      let deepest;
      for (let depth = 0; depth < 30; depth++) {
        const value = structuredClone(fixture);
        const prefix = "https://example.test/";
        let list = {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Deep",
                      marks: [
                        {
                          type: "link",
                          attrs: {
                            href: prefix + '"'.repeat(2048 - prefix.length),
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        };
        for (let i = 0; i < depth; i++)
          list = {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              { type: "listItem", content: [{ type: "paragraph" }, list] },
            ],
          };
        value.components[3].data.body = { type: "doc", content: [list] };
        try {
          readDraft(value);
          deepest = value;
        } catch {
          invalid.push(value);
          break;
        }
      }
      assert.ok(deepest);
      valid.push(deepest);
      const mutate = (fn) => {
        const value = structuredClone(fixture);
        fn(value);
        invalid.push(value);
      };
      mutate((v) => {
        v.profile.extra = true;
      });
      mutate((v) => {
        delete v.profile.name;
      });
      mutate((v) => {
        v.components[0].version = 99;
      });
      mutate((v) => {
        v.components.push(structuredClone(v.components[0]));
      });
      mutate((v) => {
        v.components[1].data.entries[0].categoryId = "missing";
      });
      mutate((v) => {
        v.components[2].data.entries[0].endDate = "2020-01";
      });
      mutate((v) => {
        v.samples["components.missing"] = true;
      });
      mutate((v) => {
        v.links[0].value = "https://example.test";
      });
      mutate((v) => {
        v.links[0].value = `${"a".repeat(2048 - "@example.test".length)}@example.test`;
      });
      mutate((v) => {
        v.profile.faceReveal.enabled = 1;
      });
      mutate((v) => {
        v.components[3].data.body = {
          type: "doc",
          content: [
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [] }],
            },
          ],
        };
      });
      mutate((v) => {
        v.components[3].data.body = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Link",
                  marks: [
                    { type: "link", attrs: { href: "javascript:alert(1)" } },
                  ],
                },
              ],
            },
          ],
        };
      });
      mutate((v) => {
        v.components[3].data.body = {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "" }] },
          ],
        };
      });
      mutate((v) => {
        v.components[3].data.body = {
          type: "doc",
          content: [{ type: "heading", attrs: { level: 1 } }],
        };
      });
      revision = await setDraft({ ...fixture, schemaVersion: 1 }, 0);
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio','') WHERE user_id='draft-alice'",
      );
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio',replace(hex(zeroblob((1048576-length(CAST(draft AS BLOB)))/2)),'0','x') || CASE WHEN (1048576-length(CAST(draft AS BLOB)))%2 THEN 'x' ELSE '' END) WHERE user_id='draft-alice'",
      );
      const large = await request("/api/owner/draft/recovery");
      assert.equal(Buffer.byteLength(JSON.stringify(large.draft)), 1048576);
      readDraft(large.draft);
      const staged = await request("validation-begin", { revision }),
        checked = await validateUntilStop(staged);
      assert.equal(checked.complete, true);
      await request("commit", {
        id: staged.id,
        sequence: checked.sequence,
      });
      assert.deepEqual((await read()).draft, readDraft(large.draft));
      for (const [expected, values] of [
        [true, valid],
        [false, invalid],
      ])
        for (const value of values) {
          let reference = true,
            referenceIssue = "";
          try {
            readDraft(value);
          } catch (error) {
            reference = false;
            referenceIssue = JSON.stringify(
              error.issues?.map((issue) => ({
                path: issue.path,
                code: issue.code,
              })) ?? error.message,
            );
          }
          assert.equal(reference, expected);
          revision = await setDraft(value, 0);
          assert.equal(
            (await request("/api/owner/draft", {}, { status: 409 })).error,
            "validation_required",
          );
          const attempt = await request("validation-begin", { revision });
          const result = await validateUntilStop(attempt);
          if (
            value.links[0].kind === "email" &&
            Buffer.byteLength(value.links[0].value) > 254
          ) {
            assert.deepEqual(result.issue.path, ["links", 0, "value"]);
            assert.ok(
              result.validationBytes < 2048,
              "Do not load an oversized legacy email",
            );
          }
          assert.equal(
            result.complete,
            reference,
            referenceIssue || JSON.stringify(value).slice(0, 100),
          );
          assert.deepEqual(
            (await request("/api/owner/draft/recovery")).draft,
            value,
          );
          if (expected) {
            revision = (
              await request("commit", {
                id: attempt.id,
                sequence: result.sequence,
              })
            ).revision;
            assert.deepEqual((await read()).draft, readDraft(value));
          } else
            await request(
              "commit",
              { id: attempt.id, sequence: result.sequence },
              { status: 409 },
            );
        }
    },
  );
  await check(
    "explicit legacy corrections stay staged and restart validation",
    async () => {
      const legacy = structuredClone(fixture);
      legacy.schemaVersion = 1;
      legacy.links[1].value = `https://example.test/${"x".repeat(2048)}`;
      revision = await setDraft(legacy, 0);
      const attempt = await request("validation-begin", { revision });
      let result = await validateUntilStop(attempt);
      assert.deepEqual(result.issue, {
        path: ["links", 1, "value"],
        code: "invalid_destination",
      });
      await request(
        "validation-correct",
        {
          id: attempt.id,
          sequence: result.sequence,
          path: ["profile", "name"],
          value: "No",
        },
        { status: 422 },
      );
      await request(
        "validation-correct",
        {
          id: attempt.id,
          sequence: result.sequence,
          path: result.issue.path,
          value: "javascript:alert(1)",
        },
        { status: 422 },
      );
      const command = {
        id: attempt.id,
        sequence: result.sequence,
        path: result.issue.path,
        value: "https://example.test/fixed",
      };
      result = await request("validation-correct", command);
      assert.equal(
        (await request("validation-correct", command)).replayed,
        true,
      );
      assert.deepEqual(
        (await request("/api/owner/draft/recovery")).draft,
        legacy,
      );
      result = await validateUntilStop({
        id: attempt.id,
        sequence: result.sequence,
      });
      assert.equal(result.complete, true);
      revision = (
        await request("commit", { id: attempt.id, sequence: result.sequence })
      ).revision;
      legacy.links[1].value = command.value;
      assert.deepEqual((await read()).draft, readDraft(legacy));
      legacy.links[1].value = "javascript:alert(1)";
      revision = await setDraft(legacy, 0);
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio','') WHERE user_id='draft-alice'",
      );
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio',replace(hex(zeroblob((1048576-length(CAST(draft AS BLOB)))/2)),'0','x') || CASE WHEN (1048576-length(CAST(draft AS BLOB)))%2 THEN 'x' ELSE '' END) WHERE user_id='draft-alice'",
      );
      const canonical = await request("/api/owner/draft/recovery");
      const full = await request("validation-begin", { revision });
      const rejected = await validateUntilStop(full);
      assert.equal(rejected.issue.code, "invalid_destination");
      assert.equal(
        (
          await request(
            "validation-correct",
            {
              id: full.id,
              sequence: rejected.sequence,
              path: rejected.issue.path,
              value: `https://example.test/${"x".repeat(2048 - "https://example.test/".length)}`,
            },
            { status: 413 },
          )
        ).error,
        "byte_limit",
      );
      assert.deepEqual(await request("/api/owner/draft/recovery"), canonical);
      assert.equal(
        (await request("status", { id: full.id })).sequence,
        rejected.sequence,
      );
      await request("abort", { id: full.id });
      await request("cleanup");
    },
  );
  await check(
    "unsupported versions and stale legacy commits fail closed",
    async () => {
      for (const schemaVersion of [99, true, "2"]) {
        revision = await setDraft({ ...fixture, schemaVersion }, 0);
        assert.equal(
          (await request("/api/owner/draft", {}, { status: 409 })).error,
          "unsupported_version",
        );
        await request("validation-begin", { revision }, { status: 409 });
        assert.equal(
          (await request("/api/owner/draft/recovery")).draft.schemaVersion,
          schemaVersion,
        );
      }
      revision = await setDraft(fixture, 0);
      const attempt = await request("validation-begin", { revision }),
        result = await validateUntilStop(attempt);
      await sql(
        "UPDATE portfolio SET draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
      );
      await request(
        "commit",
        { id: attempt.id, sequence: result.sequence },
        { status: 409 },
      );
      assert.equal(
        (await request("/api/owner/draft", {}, { status: 409 })).error,
        "validation_required",
      );
      await clear();
    },
  );
  await check(
    "permanent handoff freezes setup while content and cleanup remain usable",
    async () => {
      const bob = await read("bob");
      const receipt = await request(
        "begin",
        {
          revision: bob.revision,
          context: "setup",
          progress,
        },
        { owner: "bob" },
      );
      const confirmed = await request(
        "commit",
        { id: receipt.id, sequence: 0 },
        { owner: "bob" },
      );
      await sql(
        "UPDATE portfolio SET first_editor_entered_at=?,draft_rev=draft_rev+1 WHERE user_id='draft-bob'",
        [Date.now()],
      );
      assert.deepEqual(
        await request(
          "commit",
          { id: receipt.id, sequence: 0 },
          { owner: "bob" },
        ),
        { ...confirmed, replayed: true },
      );
      await request("cleanup", {}, { owner: "bob" });
      revision = await setDraft(fixture);
      const attempt = await request("begin", {
        revision,
        context: "setup",
        progress,
      });
      await sql(
        "UPDATE portfolio SET first_editor_entered_at=?,draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
        [Date.now()],
      );
      const before = await read();
      revision = before.revision;
      await request("commit", { id: attempt.id, sequence: 0 }, { status: 409 });
      await request("progress", { revision, progress }, { status: 409 });
      await request(
        "patch",
        {
          revision,
          context: "setup",
          progress,
          change: { op: "set", path: ["profile", "name"], value: "Old setup" },
        },
        { status: 409 },
      );
      assert.equal((await pending()).context, "setup");
      await request("abort", { id: attempt.id });
      await request("cleanup");
      revision = (await patch(revision, ["profile", "name"], "Editor"))
        .revision;
      const content = await request("begin", { revision, context: "content" });
      await request("change", {
        id: content.id,
        sequence: 0,
        change: { op: "set", path: ["profile", "name"], value: "Content" },
      });
      revision = (await request("commit", { id: content.id, sequence: 1 }))
        .revision;
      const after = await read();
      assert.deepEqual(after.progress, before.progress);
      assert.equal(after.firstEditorEnteredAt, before.firstEditorEnteredAt);
      await request("cleanup");
    },
  );
  await check(
    "revocation at write, storage failures, expiry and owner-scoped cleanup",
    async () => {
      const before = await read();
      await patch(revision, ["profile", "name"], "Failure", {
        headers: { "X-Fixture-Fail": "true" },
        status: 503,
      });
      assert.deepEqual(await read(), before);
      const revoked = await read("revoked");
      await patch(revoked.revision, ["profile", "name"], "Revoked", {
        owner: "revoked",
        headers: { "X-Fixture-Revoke": "draft-session-revoked" },
        status: 401,
      });
      await request("/api/owner/draft", {}, { owner: "revoked", status: 401 });
      const attempt = await request("begin", { revision, context: "content" });
      await sql("UPDATE owner_save_attempt SET expires_at=1 WHERE id=?", [
        attempt.id,
      ]);
      await request("commit", { id: attempt.id, sequence: 0 }, { status: 409 });
      await request("cleanup");
      const fresh = await request("begin", { revision, context: "content" });
      await request("resume", { id: fresh.id }, { owner: "alice-other" });
      await sql("DELETE FROM session WHERE id='draft-session-alice-other'");
      await request("cleanup");
      assert.equal(await pending(), null);
      const bob = await read("bob");
      await patch(bob.revision, ["profile", "name"], "Deleted", {
        owner: "bob",
        headers: { "X-Fixture-Delete": "draft-bob" },
        status: 401,
      });
      await sql("UPDATE user SET deleting_at=NULL WHERE id='draft-bob'");
      assert.deepEqual(await read("bob"), bob);
    },
  );
  await check("candidate saves do not publish or reserve names", async () => {
    for (const owner of ["alice", "bob"]) {
      const saved = await read(owner);
      await patch(saved.revision, ["requestedSubdomain"], "same-candidate", {
        owner,
      });
    }
    const counts = await sql(
      "SELECT (SELECT count(*) FROM subdomain_claim) claims,(SELECT count(*) FROM publish_version) publications,(SELECT count(*) FROM asset) assets,(SELECT count(*) FROM github_connection) github",
    );
    assert.deepEqual(counts[0], {
      claims: 0,
      publications: 0,
      assets: 0,
      github: 0,
    });
  });
  await check(
    "address confirmations enforce real auth, immutable replay and atomic swaps",
    async () => {
      const initial = await read();
      const command = {
        id: crypto.randomUUID(),
        portfolioId: initial.portfolioId,
        context: "content",
        revision: initial.revision,
        name: "same-candidate",
      };
      assert.equal(await request("address-state"), null);
      assert.equal((await request("address", command)).state, "held");
      const replay = await request("address", command);
      assert.equal(replay.replayed, true);
      assert.equal(replay.revision, initial.revision + 1);
      assert.equal(
        (
          await request(
            "address",
            { ...command, name: "changed-command" },
            { status: 409 },
          )
        ).error,
        "command_conflict",
      );
      const current = await read();
      const before = await sql(
        "SELECT name,portfolio_id,state,held_at,claimed_at FROM subdomain_claim ORDER BY name",
      );
      const swap = {
        ...command,
        id: crypto.randomUUID(),
        revision: current.revision,
        name: "attempted-swap",
      };
      await request("address", swap, { owner: null, status: 401 });
      await request("address", swap, {
        headers: { "X-Expected-Owner-Id": "draft-bob" },
        status: 409,
      });
      await request("address", swap, {
        headers: { Origin: "https://foreign.invalid" },
        status: 403,
      });
      await request("address", swap, {
        headers: { "Content-Type": "text/plain" },
        status: 415,
      });
      await request("address", swap, { owner: "bob", status: 409 });
      assert.deepEqual(
        await sql(
          "SELECT name,portfolio_id,state,held_at,claimed_at FROM subdomain_claim ORDER BY name",
        ),
        before,
      );
      const bob = await read("bob");
      assert.equal(
        (
          await request(
            "address",
            {
              ...command,
              id: crypto.randomUUID(),
              portfolioId: bob.portfolioId,
              revision: bob.revision,
            },
            { owner: "bob", status: 409 },
          )
        ).error,
        "address_unavailable",
      );
      await sql(
        "INSERT INTO reserved_subdomain(name) VALUES('dynamic-address')",
      );
      assert.equal(
        (await request("address-availability", { name: "dynamic-address" }))
          .status,
        "reserved",
      );
      assert.equal(
        (
          await request(
            "address",
            { ...swap, name: "dynamic-address" },
            { status: 422 },
          )
        ).error,
        "address_reserved",
      );
      assert.equal(
        (
          await request(
            "address",
            { ...swap, revision: command.revision },
            { status: 409 },
          )
        ).error,
        "revision_conflict",
      );
      assert.deepEqual(await read(), current);
      assert.equal(
        (await request("address", swap)).revision,
        current.revision + 1,
      );
      assert.equal((await request("address-state")).name, "attempted-swap");
      assert.equal(
        (
          await request(
            "address-availability",
            { name: "same-candidate" },
            { owner: "bob" },
          )
        ).status,
        "available",
      );
      const latest = await read();
      assert.equal(
        (
          await patch(
            latest.revision,
            ["requestedSubdomain"],
            "generic-bypass",
            { status: 409 },
          )
        ).error,
        "address_locked",
      );
      await sql(
        "DELETE FROM subdomain_claim WHERE portfolio_id=? AND state='held'",
        [initial.portfolioId],
      );
      await sql("DELETE FROM reserved_subdomain WHERE name='dynamic-address'");
    },
  );
  await check(
    "saves preserve existing publications, assets and services",
    async () => {
      const { portfolioId } = await read();
      const now = Date.now();
      await sql(
        "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES('draft-asset',?,'avatar','image/webp',123,'ready',?,?)",
        [portfolioId, now, now],
      );
      await sql(
        "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,manifest,created_at,updated_at) VALUES('draft-publication',?,1,'live','fixture','{\"asset\":\"draft-asset\"}',?,?)",
        [portfolioId, now, now],
      );
      await sql(
        "INSERT INTO subdomain_claim(name,portfolio_id) VALUES('published-fixture',?)",
        [portfolioId],
      );
      await sql(
        "INSERT INTO github_connection(portfolio_id,login,github_user_id,status) VALUES(?,'fixture','fixture','disconnected')",
        [portfolioId],
      );
      await sql(
        "UPDATE portfolio SET subdomain='published-fixture',status='published',published_version=1 WHERE id=?",
        [portfolioId],
      );
      const records = async () =>
        Promise.all([
          sql("SELECT * FROM asset"),
          sql("SELECT * FROM publish_version"),
          sql("SELECT * FROM subdomain_claim"),
          sql("SELECT * FROM github_connection"),
          sql(
            "SELECT id,status,subdomain,published_version,setup_progress,first_editor_entered_at FROM portfolio WHERE id=?",
            [portfolioId],
          ),
        ]);
      const before = await records();
      revision = (
        await patch(
          (
            await read()
          ).revision,
          ["profile", "name"],
          "Private edit",
        )
      ).revision;
      const attempt = await request("begin", { context: "content", revision });
      const changed = await request("change", {
        id: attempt.id,
        sequence: attempt.sequence,
        change: {
          op: "set",
          path: ["profile", "bio"],
          value: "Private staged edit",
        },
      });
      revision = (
        await request("commit", { id: attempt.id, sequence: changed.sequence })
      ).revision;
      assert.deepEqual(await records(), before);
      await request("cleanup");
    },
  );
  if (!remote)
    await check(
      "confirmed values and progress survive runtime restart",
      async () => {
        const before = await read();
        await stop();
        await start();
        assert.deepEqual(await read(), before);
      },
    );
  if (!remote)
    await check("setup-aware entry and authoritative handoff", async () => {
      const { checkSetupEntry } = await import("./setup-entry-api.mjs");
      await checkSetupEntry({ request, sql, fixture, origin, cookie, secrets });
    });
  if (benchmark) {
    await clear();
    const preparation = (commands) => ({
      "X-Fixture-Prepare": JSON.stringify(commands),
    });
    const command = (query, values = []) => ({ query, values });
    const fillMax = async () => {
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio','') WHERE user_id='draft-alice'",
      );
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio',replace(hex(zeroblob((1048576-length(CAST(draft AS BLOB)))/2)),'0','x') || CASE WHEN (1048576-length(CAST(draft AS BLOB)))%2 THEN 'x' ELSE '' END) WHERE user_id='draft-alice'",
      );
    };
    revision = await setDraft(fixture);
    await fillMax();
    assert.equal(
      Buffer.byteLength(JSON.stringify((await read()).draft)),
      1048576,
    );
    const run = async (name, fn) => {
      const cases = process.argv
        .find((v) => v.startsWith("--cases="))
        ?.slice(8)
        .split(",");
      if (cases && !cases.includes(name)) return;
      for (let i = 0; i < warmupsCount; i++) await fn(i, `warmup-${name}`);
      const from = new Date().toISOString();
      for (let i = 0; i < samplesCount; i++) await fn(i, name);
      windows.push({
        name,
        from,
        to: new Date().toISOString(),
        clientCount: samplesCount,
      });
      console.log(`MEASURED ${name}`);
    };
    if (!process.argv.includes("--validation-benchmark")) {
      await run("read-max", (_i, name) =>
        request("/api/owner/draft", {}, { name }),
      );
      if (!readBenchmark) {
        await run("patch-max", async (_i, name) => {
          revision = (
            await patch(revision, ["profile", "name"], fixture.profile.name, {
              name,
            })
          ).revision;
        });
        await run("progress-read", (_i, name) =>
          request("/api/owner/progress", {}, { name }),
        );
        let bob = (await read("bob")).revision;
        await run("progress-save", async (_i, name) => {
          bob = (
            await request(
              "progress",
              { revision: bob, progress },
              { name, owner: "bob" },
            )
          ).revision;
        });
        await run("begin", (_i, name) =>
          request(
            "begin",
            { revision, context: "content" },
            {
              name,
              headers: preparation([
                command(
                  "DELETE FROM owner_save_attempt WHERE user_id='draft-alice'",
                ),
              ]),
            },
          ),
        );
        const attempt = await pending();
        const reset = (updates) =>
          command(`UPDATE owner_save_attempt SET ${updates} WHERE id=?`, [
            attempt.id,
          ]);
        await run("change", (_i, name) =>
          request(
            "change",
            {
              id: attempt.id,
              sequence: 0,
              change: {
                op: "set",
                path: ["profile", "name"],
                value: fixture.profile.name,
              },
            },
            {
              name,
              headers: preparation([reset("sequence=0,last_hash=NULL")]),
            },
          ),
        );
        await run("pending", (_i, name) => request("pending", {}, { name }));
        await run("status", (_i, name) =>
          request("status", { id: attempt.id }, { name }),
        );
        await run("commit-max", (_i, name) =>
          request(
            "commit",
            { id: attempt.id, sequence: 0 },
            {
              name,
              headers: preparation([
                reset(
                  "draft=(SELECT draft FROM portfolio WHERE user_id='draft-alice'),base_revision=(SELECT draft_rev FROM portfolio WHERE user_id='draft-alice'),state='open',sequence=0,last_hash=NULL",
                ),
              ]),
            },
          ),
        );
        await sql(
          "UPDATE owner_save_attempt SET draft=(SELECT draft FROM portfolio WHERE user_id='draft-alice'),state='open',sequence=0,last_hash=NULL WHERE id=?",
          [attempt.id],
        );
        await run("string-start", (_i, name) =>
          request(
            "string-start",
            { id: attempt.id, sequence: 0, path: ["profile", "bio"] },
            {
              name,
              headers: preparation([
                reset("state='open',sequence=0,last_hash=NULL"),
              ]),
            },
          ),
        );
        let sequence = (await request("status", { id: attempt.id })).sequence;
        await run("piece", async (_i, name) => {
          sequence = (
            await request(
              "piece",
              { id: attempt.id, sequence, text: "x".repeat(4000) },
              { name },
            )
          ).sequence;
        });
        await sql("DELETE FROM owner_save_piece WHERE attempt_id=?", [
          attempt.id,
        ]);
        await sql(
          "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE (i+1)*4000<(SELECT length(json_extract(draft,'$.profile.bio')) FROM portfolio WHERE user_id='draft-alice')) INSERT INTO owner_save_piece(attempt_id,n,data) SELECT ?,i,json_quote(substr(json_extract(p.draft,'$.profile.bio'),i*4000+1,4000)) FROM n,portfolio p WHERE p.user_id='draft-alice'",
          [attempt.id],
        );
        const stringPath = '$."profile"."bio"';
        await sql(
          "UPDATE owner_save_attempt SET string_path=?,string_minimum=0,piece_count=(SELECT count(*) FROM owner_save_piece WHERE attempt_id=?),string_chars=(SELECT length(json_extract(draft,'$.profile.bio')) FROM portfolio WHERE user_id='draft-alice'),string_bytes=(SELECT length(json_extract(draft,'$.profile.bio'))+2 FROM portfolio WHERE user_id='draft-alice') WHERE id=?",
          [stringPath, attempt.id, attempt.id],
        );
        await run("string-finish-max", (_i, name) =>
          request(
            "string-finish",
            { id: attempt.id, sequence: 0 },
            {
              name,
              headers: preparation([
                reset("state='string',sequence=0,last_hash=NULL"),
              ]),
            },
          ),
        );
        await sql(
          "INSERT OR IGNORE INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES('draft-session-alice-other',?,'draft-alice',?,1,1)",
          [tokens["alice-other"], Date.now() + 7200000],
        );
        await run("resume", (i, name) =>
          request(
            "resume",
            { id: attempt.id },
            { name, owner: i % 2 ? "alice" : "alice-other" },
          ),
        );
        await run("abort", (_i, name) =>
          request(
            "abort",
            { id: attempt.id },
            {
              name,
              headers: preparation([
                reset(`state='open',expires_at=${Date.now() + 3600000}`),
              ]),
            },
          ),
        );
        await sql("DROP TABLE IF EXISTS draft_api_attempt_template");
        await sql(
          "CREATE TABLE draft_api_attempt_template AS SELECT * FROM owner_save_attempt WHERE id=?",
          [attempt.id],
        );
        await sql("DROP TABLE IF EXISTS draft_api_piece_template");
        await sql(
          "CREATE TABLE draft_api_piece_template AS SELECT * FROM owner_save_piece WHERE attempt_id=? LIMIT 32",
          [attempt.id],
        );
        await sql("DELETE FROM owner_save_piece WHERE attempt_id=?", [
          attempt.id,
        ]);
        await run("cleanup", (_i, name) =>
          request(
            "cleanup",
            {},
            {
              name,
              headers: preparation([
                command(
                  "INSERT OR IGNORE INTO owner_save_attempt SELECT * FROM draft_api_attempt_template",
                ),
                command(
                  "INSERT OR IGNORE INTO owner_save_piece SELECT * FROM draft_api_piece_template",
                ),
              ]),
            },
          ),
        );
      }
    }
    if (!readBenchmark) {
      await clear();
      revision = await setDraft(fixture, 0);
      await fillMax();
      await run("validation-begin", (_i, name) =>
        request(
          "validation-begin",
          { revision },
          {
            name,
            headers: preparation([
              command(
                "DELETE FROM owner_save_attempt WHERE user_id='draft-alice'",
              ),
            ]),
          },
        ),
      );
      const legacy =
        (await pending()) ?? (await request("validation-begin", { revision }));
      const validationReset = (cursor) =>
        command(
          "UPDATE owner_save_attempt SET sequence=0,last_hash=NULL,validation_complete=0,validation_issue=NULL,validation_cursor=? WHERE id=?",
          [
            JSON.stringify({ ...cursor, frames: cursor.next.map(() => null) }),
            legacy.id,
          ],
        );
      await run("validation-step", (_i, name) =>
        request(
          "validation-step",
          { id: legacy.id, sequence: 0 },
          {
            name,
            headers: preparation([validationReset({ path: [], next: [-1] })]),
          },
        ),
      );
      await run("validation-free-text", (_i, name) =>
        request(
          "validation-step",
          { id: legacy.id, sequence: 0 },
          {
            name,
            headers: preparation([
              validationReset({ path: ["profile", "bio"], next: [3, 2, -1] }),
            ]),
          },
        ),
      );
      await run("validation-finish", (_i, name) =>
        request(
          "validation-step",
          { id: legacy.id, sequence: 0 },
          {
            name,
            headers: preparation([validationReset({ path: [], next: [] })]),
          },
        ),
      );
      await run("validation-commit", (_i, name) =>
        request(
          "commit",
          { id: legacy.id, sequence: 0 },
          {
            name,
            headers: preparation([
              command(
                "UPDATE portfolio SET draft_validation_version=0 WHERE user_id='draft-alice'",
              ),
              command(
                "UPDATE owner_save_attempt SET draft=(SELECT draft FROM portfolio WHERE user_id='draft-alice'),base_revision=(SELECT draft_rev FROM portfolio WHERE user_id='draft-alice'),state='open',sequence=0,validation_complete=1,validation_issue=NULL WHERE id=?",
                [legacy.id],
              ),
            ]),
          },
        ),
      );
      // Measure a real traversal through the deepest supported rich-text tree.
      // Unlike the fixed-state cases, these calls advance the server cursor.
      let deep = structuredClone(fixture),
        body = {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Deep",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: `https://example.test/${'"'.repeat(2048 - "https://example.test/".length)}`,
                  },
                },
              ],
            },
          ],
        };
      for (let depth = 0; depth < 30; depth++) {
        body = {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph" }, body] },
          ],
        };
        const candidate = structuredClone(fixture);
        candidate.components[3].data.body = { type: "doc", content: [body] };
        try {
          readDraft(candidate);
          deep = candidate;
        } catch {
          break;
        }
      }
      revision = await setDraft(deep, 0);
      const deepAttempt = await request("validation-begin", { revision });
      let deepResult = { sequence: 0 },
        completedTraversals = 0;
      await run("validation-deep", async (_i, name) => {
        const reset = deepResult.complete;
        deepResult = await request(
          "validation-step",
          {
            id: deepAttempt.id,
            sequence: reset ? 0 : deepResult.sequence,
          },
          {
            name,
            headers: reset
              ? preparation([
                  command(
                    "UPDATE owner_save_attempt SET sequence=0,last_hash=NULL,validation_complete=0,validation_cursor=? WHERE id=?",
                    [
                      JSON.stringify({ path: [], next: [-1], frames: [null] }),
                      deepAttempt.id,
                    ],
                  ),
                ])
              : {},
          },
        );
        assert.equal(deepResult.issue, null);
        assert.ok(
          deepResult.examined <= 16 && deepResult.validationBytes <= 4096,
        );
        if (deepResult.complete) completedTraversals++;
      });
      if (
        samplesCount >= 100 &&
        windows.some((v) => v.name === "validation-deep")
      )
        assert.ok(completedTraversals, "Deep measured traversal must finish");
      const deepWindow = windows.find((v) => v.name === "validation-deep");
      if (deepWindow) deepWindow.completedTraversals = completedTraversals;
      const rejected = structuredClone(fixture);
      rejected.links[1].value = "javascript:alert(1)";
      revision = await setDraft(rejected, 0);
      const correction = await request("validation-begin", { revision });
      await run("validation-correct", (_i, name) =>
        request(
          "validation-correct",
          {
            id: correction.id,
            sequence: 0,
            path: ["links", 1, "value"],
            value: `https://example.test/${"x".repeat(2048 - "https://example.test/".length)}`,
          },
          {
            name,
            headers: preparation([
              command(
                "UPDATE owner_save_attempt SET sequence=0,last_hash=NULL,validation_complete=0,validation_issue=? WHERE id=?",
                [
                  JSON.stringify({
                    path: ["links", 1, "value"],
                    code: "invalid_destination",
                  }),
                  correction.id,
                ],
              ),
            ]),
          },
        ),
      );
    }
  }
  if (process.argv.includes("--autosave")) {
    const { checkAutosave } = await import("./autosave-browser.mjs");
    await checkAutosave({
      root,
      origin,
      cookie,
      sql,
      fixture,
      esbuild,
      evidence,
      secrets,
      tokens,
    });
  }
  if (process.argv.includes("--editor")) {
    const { checkEditor } = await import("./editor-browser.mjs");
    await checkEditor({
      root,
      origin,
      cookie,
      sql,
      fixture,
      esbuild,
      evidence,
      secrets,
    });
  }
  await writeJsonEvidence(
    pathToFileURL(
      join(evidence, remote ? "deployed-requests.json" : "local-results.json"),
    ),
    { recordedAt: new Date().toISOString(), remote, checks, samples, windows },
  );
  console.log(`Passed ${checks.length} production API groups`);
} catch (error) {
  await writeJsonEvidence(
    pathToFileURL(
      join(evidence, remote ? "deployed-partial.json" : "local-partial.json"),
    ),
    {
      recordedAt: new Date().toISOString(),
      remote,
      checks,
      samples,
      windows,
      failure:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "integration failed",
    },
  );
  throw error;
} finally {
  await stop();
}
