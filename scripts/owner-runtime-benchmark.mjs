import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const remote = process.argv.includes("--remote");
const recovery = process.argv.includes("--recovery");
const sampleCount = Number(process.env.OWNER_RUNTIME_SAMPLES ?? 100);
const warmupCount = Number(process.env.OWNER_RUNTIME_WARMUPS ?? 10);
const selectedCases = process.env.OWNER_RUNTIME_CASES?.split(",");
const output = join(
  root,
  remote ? ".wrangler/owner-runtime-remote" : ".wrangler/owner-runtime-local",
);
const evidencePath = join(
  root,
  process.env.OWNER_RUNTIME_EVIDENCE ?? "specs/2026-10-16-owner-api-runtime",
  remote
    ? recovery
      ? "deployed-recovery.json"
      : "deployed-requests.json"
    : "local-results.json",
);
const port = 8821;
const origin = remote
  ? "https://hasaweb-owner-runtime-web.umerthepro2009.workers.dev"
  : `http://127.0.0.1:${port}`;
const dbName = remote ? "hasaweb-owner-runtime-spike" : "owner-runtime-local";
const jobsConfig = join(output, "jobs.json");
const webConfig = join(output, "web.json");
const state = join(output, "state");
let child;
let logs = "";
let stopped = false;
const checks = [];
const samples = [];
const windows = [];
const secrets = remote
  ? JSON.parse(await readFile(join(output, "secrets.json"), "utf8"))
  : {
      RUNTIME_KEY: randomBytes(32).toString("hex"),
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    };
const tokens = Object.fromEntries(
  ["alice", "bob", "expired", "deleting", "revoked"].map((id) => [
    id,
    randomBytes(32).toString("hex"),
  ]),
);
function cookie(id = "alice") {
  const token = tokens[id];
  const signature = createHmac("sha256", secrets.BETTER_AUTH_SECRET)
    .update(token)
    .digest("base64");
  return `__Host-hasaweb.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}
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
async function sql(source) {
  const file = join(output, "query.sql");
  await writeFile(file, source);
  const result = cli([
    "d1",
    "execute",
    dbName,
    "-c",
    jobsConfig,
    remote ? "--remote" : "--local",
    ...(!remote ? ["--persist-to", state] : []),
    ...(remote && /^SELECT\b/i.test(source.trim())
      ? ["--command", source]
      : ["--file", file]),
    "--json",
  ]);
  await rm(file);
  return JSON.parse(result.slice(result.indexOf("[\n")));
}
async function start() {
  child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "-c",
      webConfig,
      "-c",
      jobsConfig,
      "--persist-to",
      state,
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
    },
  );
  child.stdout.on("data", (chunk) => {
    logs = (logs + chunk).slice(-8000);
  });
  child.stderr.on("data", (chunk) => {
    logs = (logs + chunk).slice(-8000);
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
  throw new Error("Local runtime did not start");
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  process.kill(-child.pid, "SIGTERM");
  await Promise.race([exited, setTimeout(5000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null)
    process.kill(-child.pid, "SIGKILL");
  child = undefined;
}
async function request({
  path = "/api/owner",
  id = "alice",
  body,
  headers = {},
  status = 200,
  name = "check",
  method,
  record = true,
} = {}) {
  const at = Date.now();
  const started = performance.now();
  const response = await fetch(`${origin}${path}?case=${name}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      "X-Runtime-Key": secrets.RUNTIME_KEY,
      Cookie: id ? cookie(id) : "",
      ...(body !== undefined
        ? { Origin: origin, "Content-Type": "application/json" }
        : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: typeof body === "string" ? body : JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  const row = {
    case: name,
    at,
    elapsedMs: +(performance.now() - started).toFixed(3),
  };
  Object.assign(row, {
    status: response.status,
    colo: response.headers.get("cf-ray")?.split("-")[1] ?? null,
  });
  if (record) samples.push(row);
  assert.ok(
    (Array.isArray(status) ? status : [status]).includes(response.status),
    `${name} ${path}: ${response.status} ${raw.slice(0, 200)}`,
  );
  if (path.startsWith("/api/owner")) {
    assert.match(
      response.headers.get("Cache-Control") ?? "",
      /private.*no-store/,
    );
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
  }
  return raw ? JSON.parse(raw) : null;
}
async function check(name, run) {
  await run();
  checks.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
const progress = { step: "profile", enteredEditor: false };
const save = (draft, revision, extra = {}) => ({
  path: "/api/owner/runtime/save",
  body: { revision, progress, draft },
  ...extra,
});

await mkdir(output, { recursive: true });
if (!remote) {
  await rm(state, { recursive: true, force: true });
  const base = {
    compatibility_date: "2026-10-14",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
  };
  await writeFile(
    jobsConfig,
    JSON.stringify({
      ...base,
      name: "owner-runtime-jobs-local",
      main: join(root, "apps/jobs/integration/owner-runtime.ts"),
      d1_databases: [
        {
          binding: "DB",
          database_name: dbName,
          database_id: "00000000-0000-0000-0000-000000000011",
        },
      ],
      vars: {
        APP_ENV: "test",
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
    webConfig,
    JSON.stringify({
      ...base,
      name: "owner-runtime-web-local",
      main: join(root, "apps/web/integration/owner-runtime-gateway.ts"),
      services: [
        {
          binding: "OWNER_API",
          service: "owner-runtime-jobs-local",
          entrypoint: "RuntimeOwnerApi",
        },
        { binding: "JOBS", service: "owner-runtime-jobs-local" },
      ],
      vars: { RUNTIME_ORIGIN: origin, RUNTIME_ENABLED: "true" },
    }),
  );
  await writeFile(
    join(output, ".dev.vars"),
    Object.entries(secrets)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  for (const file of (await readdir(join(root, "packages/db/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await sql(
      await readFile(join(root, "packages/db/migrations", file), "utf8"),
    );
}
try {
  const now = Date.now();
  await sql(`CREATE TABLE IF NOT EXISTS owner_runtime_fixture (user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, draft TEXT NOT NULL CHECK(json_valid(draft)), progress TEXT NOT NULL CHECK(json_valid(progress)), revision INTEGER NOT NULL DEFAULT 0);
    DELETE FROM user WHERE id LIKE 'runtime-%';
    ${Object.keys(tokens)
      .map(
        (
          id,
        ) => `INSERT INTO user (id,name,email,email_verified,created_at,updated_at,deleting_at) VALUES ('runtime-${id}','${id}','${id}@runtime.example.test',1,${now},${now},${id === "deleting" ? now : "NULL"});
    INSERT INTO session (id,token,user_id,expires_at,created_at,updated_at) VALUES ('runtime-session-${id}','${tokens[id]}','runtime-${id}',${id === "expired" ? 1 : now + 3600000},${now},${now});
    INSERT INTO owner_runtime_fixture (user_id,draft,progress) VALUES ('runtime-${id}','{}','${JSON.stringify(progress)}');`,
      )
      .join("\n")}
    DELETE FROM session WHERE id = 'runtime-session-revoked';`);
  if (!remote) await start();
  await request({ name: "first-candidate" });
  const recoveryDraft = {
    schemaVersion: 1,
    profile: { name: "عمر Example", bio: "", faceReveal: { enabled: false } },
    links: [],
    components: [],
    appearance: {
      themeId: "fixture-theme",
      fontId: "fixture-font",
      colorMode: "system",
    },
    seo: {},
    samples: {},
  };
  const { small, large } = recovery
    ? { small: recoveryDraft, large: recoveryDraft }
    : await request({ path: "/__fixture/drafts", record: false });
  if (!recovery)
    assert.equal(Buffer.byteLength(JSON.stringify(large)), 1048576);
  const smallBytes = Buffer.byteLength(JSON.stringify(small));
  console.log(
    `Fixture sizes: ${smallBytes} and ${Buffer.byteLength(JSON.stringify(large))} UTF-8 bytes`,
  );
  await check("default jobs HTTP entry cannot invoke owner APIs", async () => {
    await request({ path: "/__fixture/direct-owner", status: 404 });
  });
  await check("real signed session and private owner response", async () =>
    assert.equal((await request()).user.id, "runtime-alice"),
  );
  await check(
    "missing, tampered, expired, revoked and deleting sessions fail",
    async () => {
      for (const id of [null, "expired", "revoked", "deleting"])
        await request({ id, status: 401 });
      await request({
        headers: { Cookie: `${cookie()}tampered` },
        status: 401,
      });
    },
  );
  await check("exact Origin, JSON type and method checks", async () => {
    for (const value of [
      "",
      "https://evil.test",
      "https://alice.hasaweb.site",
      `${origin}/`,
    ])
      await request(
        save(small, 0, { headers: { Origin: value }, status: 403 }),
      );
    await request(
      save(small, 0, {
        headers: { "Content-Type": "text/plain" },
        status: 415,
      }),
    );
    await request({ method: "PATCH", status: 405 });
    await request({ body: {}, status: 405 });
  });
  if (!recovery)
    await check(
      "malformed, unsafe, unknown and oversized drafts do not write",
      async () => {
        await request({
          path: "/api/owner/runtime/save",
          body: "{",
          status: 400,
        });
        await request(
          save({ ...small, ownerId: "runtime-bob" }, 0, { status: 422 }),
        );
        await request({
          path: "/api/owner/runtime/save",
          body: { ...save(small, 0).body, ownerId: "runtime-bob" },
          status: 422,
        });
        const unsafe = structuredClone(small);
        unsafe.links[0].value = "javascript:alert(1)";
        await request(save(unsafe, 0, { status: 422 }));
        const oversized = structuredClone(large);
        oversized.profile.bio += "ع";
        await request(save(oversized, 0, { status: 422 }));
        await request({
          path: "/api/owner/runtime/save",
          body: " ".repeat(1048576 + 4097),
          status: 413,
        });
        const rows = await sql(
          "SELECT SUM(revision) AS n FROM owner_runtime_fixture;",
        );
        assert.equal(rows[0].results[0].n, 0);
      },
    );
  await check(
    "atomic content and private progress, stale revision and owner isolation",
    async () => {
      assert.equal((await request(save(small, 0))).revision, 1);
      await request(save(large, 0, { status: 409 }));
      const rows = (
        await sql(
          "SELECT user_id, json_extract(draft,'$.profile.name') AS name, json_extract(progress,'$.step') AS step, revision FROM owner_runtime_fixture ORDER BY user_id;",
        )
      )[0].results;
      assert.deepEqual(
        rows.find((row) => row.user_id === "runtime-alice"),
        {
          user_id: "runtime-alice",
          name: small.profile.name,
          step: "profile",
          revision: 1,
        },
      );
      assert.equal(
        rows.find((row) => row.user_id === "runtime-bob").revision,
        0,
      );
    },
  );
  await check(
    "parallel identities and conflicting saves remain request scoped",
    async () => {
      await Promise.all(
        Array.from({ length: 16 }, async (_, i) => {
          const id = i % 2 ? "alice" : "bob";
          assert.equal((await request({ id })).user.id, `runtime-${id}`);
        }),
      );
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          request(save(small, 1, { status: [200, 409] })),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1);
    },
  );
  let revision = 2;
  if (!recovery)
    await check("exact 1 MiB draft saves with envelope overhead", async () => {
      const result = await request(save(large, revision));
      revision = result.revision;
    });
  await check("permanent fixture milestone cannot be reset", async () => {
    await request({
      path: "/api/owner/runtime/save",
      body: {
        draft: small,
        revision,
        progress: { step: "review", enteredEditor: true },
      },
    });
    revision++;
    await request(save(small, revision, { status: 409 }));
    await sql(
      `UPDATE owner_runtime_fixture SET progress = '${JSON.stringify(progress)}' WHERE user_id = 'runtime-alice';`,
    );
  });
  const cases = [
    ["owner-read", null, null],
    ["validate-1m", "validate", large],
    ["save-small", "save", small],
    ["save-1m", "save", large],
    ["signed-out", null, null],
  ];
  for (const [name, operation, draft] of cases.filter(
    ([name]) =>
      (!recovery || name === "signed-out") &&
      (!selectedCases || selectedCases.includes(name)),
  )) {
    const start = new Date().toISOString();
    for (let i = 0; i < sampleCount + warmupCount; i++) {
      const measured = i >= warmupCount;
      const data = await request({
        name: `${measured ? "" : "warmup-"}${name}`,
        ...(name === "signed-out" ? { id: null, status: 401 } : {}),
        ...(operation
          ? {
              path: `/api/owner/runtime/${operation}`,
              body: { draft, revision, progress },
            }
          : {}),
      });
      if (operation === "save") revision = data.revision;
    }
    windows.push({
      name,
      from: start,
      to: new Date().toISOString(),
      clientCount: sampleCount + warmupCount,
    });
    console.log(`Measured ${name}`);
  }
  await check(
    "persisted revocation and deletion invalidate existing signed cookies",
    async () => {
      await sql(
        "DELETE FROM session WHERE id = 'runtime-session-bob'; UPDATE user SET deleting_at = 1 WHERE id = 'runtime-alice';",
      );
      await request({ id: "bob", status: 401 });
      await request({ status: 401 });
      await request(save(small, revision, { status: 401 }));
    },
  );
  await check(
    "revocation between validation and write blocks mutation",
    async () => {
      await sql(
        "UPDATE user SET deleting_at = NULL WHERE id = 'runtime-alice';",
      );
      const before = (
        await sql(
          "SELECT revision FROM owner_runtime_fixture WHERE user_id = 'runtime-alice';",
        )
      )[0].results[0].revision;
      await request(
        save(small, before, {
          headers: { "X-Runtime-Revoke-At-Write": "true" },
          status: 409,
        }),
      );
      assert.equal(
        (
          await sql(
            "SELECT revision FROM owner_runtime_fixture WHERE user_id = 'runtime-alice';",
          )
        )[0].results[0].revision,
        before,
      );
      await request({ status: 401 });
    },
  );
  if (!remote) {
    await check("D1 write failure returns private 503", async () => {
      const now = Date.now();
      await sql(`UPDATE user SET deleting_at = NULL WHERE id = 'runtime-alice';
        INSERT INTO session (id,token,user_id,expires_at,created_at,updated_at) VALUES ('runtime-session-alice','${tokens.alice}','runtime-alice',${now + 3600000},${now},${now});
        DROP TABLE owner_runtime_fixture;`);
      await request(save(small, revision, { status: 503 }));
    });
  }
  stopped = true;
} finally {
  await stop();
  // Never persist cookie, body, session token or secret in evidence.
  await writeFile(
    evidencePath,
    `${JSON.stringify({ recordedAt: new Date().toISOString(), completed: stopped, recovery, sampleCount, warmupCount, method: remote ? "HTTPS to isolated web experiment using the actual web Worker adapter and named jobs service binding. Real Better Auth and persisted session/deletion checks. Elapsed is client wall time, never CPU. First candidate is not guaranteed isolate-cold. Ten warmups and 100 samples per workload." : "Local workerd runs the actual web Worker adapter and named jobs binding with real Better Auth, D1 migrations and draft validation. Client elapsed time is not CPU or deployed startup.", fixtureBytes: recovery ? null : { draft: 1048576 }, checks, windows, samples }, null, 2)}\n`,
  );
  await sql("DELETE FROM user WHERE id LIKE 'runtime-%';");
  if (!remote) await rm(join(output, ".dev.vars"), { force: true });
  if (!stopped)
    console.error(
      logs
        .replaceAll(secrets.RUNTIME_KEY, "[redacted]")
        .replaceAll(secrets.BETTER_AUTH_SECRET, "[redacted]"),
    );
}
console.log(`Evidence: ${evidencePath}`);
