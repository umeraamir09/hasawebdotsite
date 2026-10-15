import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const output = join(root, ".wrangler/app-spike");
const state = join(output, "state");
const port = 8803;
const inspectorPort = 9233;
const origin = `http://127.0.0.1:${port}`;
const key = randomBytes(32).toString("hex");
const secret = randomBytes(32).toString("hex");
const tokens = Object.fromEntries(
  ["owner-a", "owner-b", "expired", "deleting"].map((name) => [
    name,
    randomBytes(32).toString("hex"),
  ]),
);
function cookie(name) {
  const token = tokens[name];
  return `__Host-spike.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`)}`;
}
function scrub(text) {
  let safe = text;
  for (const value of [key, secret, ...Object.values(tokens)])
    safe = safe.replaceAll(value, "[redacted]");
  return safe;
}
function cli(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  assert.equal(result.status, 0, scrub(result.stdout + result.stderr));
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}
await mkdir(output, { recursive: true });
const config = {
  name: "hasaweb-app-spike-local",
  main: join(root, "apps/web/.open-next/worker.js"),
  compatibility_date: "2026-10-14",
  compatibility_flags: ["nodejs_compat"],
  workers_dev: false,
  assets: {
    directory: join(root, "apps/web/.open-next/assets"),
    binding: "ASSETS",
  },
  d1_databases: [
    {
      binding: "DB",
      database_name: "app-spike-local",
      database_id: "00000000-0000-0000-0000-000000000003",
    },
  ],
  services: [
    { binding: "WORKER_SELF_REFERENCE", service: "hasaweb-app-spike-local" },
  ],
  vars: { APP_ENV: "local", SPIKE_ENABLED: "true", SPIKE_ORIGIN: origin },
};
const configPath = join(output, "wrangler.json");
await writeFile(configPath, JSON.stringify(config));
await writeFile(
  join(output, ".dev.vars"),
  `SPIKE_KEY=${key}\nBETTER_AUTH_SECRET=${secret}\n`,
  { mode: 0o600 },
);
let sql = await readFile(join(root, "apps/web/spike/fixture.sql"), "utf8");
sql +=
  "\nDELETE FROM spike_session; DELETE FROM spike_owner; DELETE FROM spike_user;\n";
const now = Date.now();
for (const [name, token] of Object.entries(tokens)) {
  sql += `INSERT INTO spike_user VALUES ('${name}', '${name}', '${name}@example.invalid', 1, NULL, ${now}, ${now});\n`;
  sql += `INSERT INTO spike_session VALUES ('${name}', '${token}', '${name}', ${name === "expired" ? 0 : now + 86400000}, ${now}, ${now}, NULL, NULL);\n`;
  sql += `INSERT INTO spike_owner (id, deleting) VALUES ('${name}', ${name === "deleting" ? 1 : 0});\n`;
}
const fixturePath = join(output, "fixture.sql");
await writeFile(fixturePath, sql, { mode: 0o600 });
cli([
  "d1",
  "execute",
  "DB",
  "--local",
  "--config",
  configPath,
  "--persist-to",
  state,
  "--file",
  fixturePath,
]);
await rm(fixturePath);
let child;
let logs = "";
let socket;
let nextId = 0;
const pending = new Map();
async function command(method, params = {}) {
  const id = ++nextId;
  const promise = new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Inspector timeout: ${method}`));
    }, 10000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject,
    });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return promise;
}
async function start() {
  logs = "";
  const begin = performance.now();
  child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--config",
      configPath,
      "--persist-to",
      state,
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--ip",
      "127.0.0.1",
    ],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
    },
  );
  child.stdout.on("data", (data) => {
    logs = (logs + data).slice(-32000);
  });
  child.stderr.on("data", (data) => {
    logs = (logs + data).slice(-32000);
  });
  for (let i = 0; i < 600; i++) {
    const ready = await new Promise((resolve) => {
      const connection = net.connect(port, "127.0.0.1");
      connection.once("connect", () => {
        connection.destroy();
        resolve(true);
      });
      connection.once("error", () => resolve(false));
    });
    if (ready) return performance.now() - begin;
    if (child.exitCode !== null) throw new Error(scrub(logs));
    await setTimeout(100);
  }
  throw new Error(scrub(logs));
}
async function stop() {
  socket?.close();
  socket = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = new Promise((resolve) => child.once("exit", resolve));
  process.kill(-child.pid, "SIGTERM");
  await Promise.race([exit, setTimeout(5000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null)
    process.kill(-child.pid, "SIGKILL");
}
async function request({
  cookie: sessionCookie = cookie("owner-a"),
  method = "GET",
  body,
  status = 200,
  extra = {},
} = {}) {
  const begin = performance.now();
  const response = await fetch(`${origin}/api/runtime-spike`, {
    method,
    body,
    headers: {
      Authorization: `Bearer ${key}`,
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: sessionCookie,
      ...extra,
    },
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status,
    `unexpected status ${response.status} ${scrub(JSON.stringify(data))}; logs: ${scrub(logs)}`,
  );
  return {
    ms: performance.now() - begin,
    data,
    cookies: response.headers.getSetCookie(),
  };
}
try {
  const cold = [];
  for (let i = 0; i < 3; i++) {
    const readyMs = await start();
    const first = await request();
    cold.push({
      localProcessReadyMs: readyMs,
      firstSessionRequestElapsedMs: first.ms,
    });
    if (i < 2) await stop();
  }
  const first = await request();
  const cached = [
    cookie("owner-a"),
    ...first.cookies.map((c) => c.split(";")[0]),
  ].join("; ");
  assert.ok(
    cached.includes("session_data="),
    "Better Auth must emit a real cache cookie",
  );
  for (const value of first.cookies) {
    assert.ok(!/;\s*domain=/i.test(value));
    assert.match(value, /Secure/i);
  }
  const cases = [
    { name: "session-d1", options: {} },
    { name: "session-cache", options: { cookie: cached } },
    {
      name: "write-small-d1",
      options: {
        method: "POST",
        body: JSON.stringify({ text: "x".repeat(1000) }),
      },
    },
    {
      name: "write-small-cache",
      options: {
        method: "POST",
        cookie: cached,
        body: JSON.stringify({ text: "x".repeat(1000) }),
      },
    },
    {
      name: "write-limit-cache",
      options: {
        method: "POST",
        cookie: cached,
        body: JSON.stringify({ text: "x".repeat(1048576 - 11) }),
      },
    },
    { name: "signed-out", options: { cookie: "", status: 401 } },
  ];
  // Inspector attaches only after unprofiled cold and warm timings.
  const results = [];
  for (const test of cases) {
    for (let i = 0; i < 10; i++) await request(test.options);
    const samples = [];
    for (let i = 0; i < 100; i++)
      samples.push((await request(test.options)).ms);
    results.push({
      name: test.name,
      bodyBytes: Buffer.byteLength(test.options.body ?? ""),
      warmElapsedMs: summary(samples),
      samplesMs: samples,
    });
  }
  const targets = await (
    await fetch(`http://127.0.0.1:${inspectorPort}/json`)
  ).json();
  const target =
    targets.find(
      (t) => t.id?.includes(config.name) || t.title?.includes(config.name),
    ) ?? targets[0];
  assert.ok(target?.webSocketDebuggerUrl);
  const inspectorURL = new URL(target.webSocketDebuggerUrl);
  inspectorURL.hostname = "127.0.0.1";
  console.log(
    JSON.stringify({
      inspectorTarget: target.id,
      inspectorTitle: target.title,
      inspectorURL: inspectorURL.href,
    }),
  );
  const InspectorWebSocket = wranglerRequire("ws");
  socket = new InspectorWebSocket(inspectorURL, { origin: "http://localhost" });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  await command("Profiler.enable");
  await command("Profiler.setSamplingInterval", { interval: 100 });
  for (let index = 0; index < cases.length; index++) {
    const test = cases[index];
    await command("Profiler.start");
    for (let i = 0; i < 50; i++) await request(test.options);
    const { profile } = await command("Profiler.stop");
    await writeFile(
      join(output, `${test.name}.cpuprofile.gz`),
      gzipSync(JSON.stringify(profile)),
    );
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    let activeUs = 0;
    for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
      if (
        ["(idle)", "(program)", "(root)"].includes(
          nodes.get(profile.samples[i])?.callFrame.functionName,
        )
      )
        continue;
      activeUs += profile.timeDeltas[i];
    }
    results[index].sampledCpu = {
      requests: 50,
      activeMsPerRequest: activeUs / 1000 / 50,
    };
    console.log(
      JSON.stringify({
        name: test.name,
        warmElapsedMs: results[index].warmElapsedMs,
        sampledCpu: results[index].sampledCpu,
      }),
    );
  }
  // Assert failure paths do not increment writes. Owner B remains untouched.
  const before = (await request()).data.writes;
  const failures = [
    { cookie: "", status: 401 },
    { cookie: `${cookie("owner-a")}tampered`, status: 401 },
    { cookie: cookie("expired"), status: 401 },
    { cookie: cookie("deleting"), status: 403 },
    { extra: { Origin: "https://attacker.invalid" }, status: 403 },
    { extra: { Origin: "" }, status: 403 },
    { extra: { "Content-Type": "text/plain" }, status: 415 },
    { body: "{", status: 400 },
    { body: `"${"x".repeat(1048576)}"`, status: 413 },
    { extra: { Authorization: "" }, status: 404 },
  ];
  for (const failure of failures)
    await request({ method: "POST", body: "{}", ...failure });
  assert.equal((await request()).data.writes, before);
  assert.equal((await request({ cookie: cookie("owner-b") })).data.writes, 0);
  await request({
    method: "POST",
    body: JSON.stringify({ ownerId: "owner-b" }),
  });
  assert.equal((await request({ cookie: cookie("owner-b") })).data.writes, 0);
  // A removed D1 session still validates through the issued cache cookie.
  // This proves the cache path is exercised, not just that a cookie was emitted.
  const cachePath = join(output, "cache-proof.sql");
  await writeFile(
    cachePath,
    "DELETE FROM spike_session WHERE user_id = 'owner-a';",
  );
  cli([
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    state,
    "--file",
    cachePath,
  ]);
  await request({ cookie: cached });
  await request({ status: 401 });
  await rm(cachePath);
  // Mark owner A deleting after caching its session. The cache must not bypass denial.
  const deletePath = join(output, "delete.sql");
  await writeFile(
    deletePath,
    "UPDATE spike_owner SET deleting = 1 WHERE id = 'owner-a';",
  );
  cli([
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    state,
    "--file",
    deletePath,
  ]);
  await request({ cookie: cached, status: 403 });
  await rm(deletePath);
  const failurePath = join(output, "failure.sql");
  await writeFile(failurePath, "DROP TABLE spike_owner;");
  cli([
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    state,
    "--file",
    failurePath,
  ]);
  await request({ cookie: cached, method: "POST", body: "{}", status: 503 });
  await rm(failurePath);
  const report = {
    recordedAt: new Date().toISOString(),
    node: process.version,
    versions: Object.fromEntries(
      await Promise.all(
        ["better-auth", "drizzle-orm", "next", "@opennextjs/cloudflare"].map(
          async (name) => [
            name,
            JSON.parse(
              await readFile(
                join(root, "apps/web/node_modules", name, "package.json"),
                "utf8",
              ),
            ).version,
          ],
        ),
      ),
    ),
    wrangler: require("wrangler/package.json").version,
    workerd: wranglerRequire("workerd/package.json").version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    method:
      "Compiled OpenNext Worker in local workerd. Three fresh process/isolate first-session requests, persisted local D1. Ten warmups then 100 sequential unprofiled HTTP requests per case. Elapsed includes client, network loopback, framework, auth and D1 I/O. Separate 50-request V8 profiles at requested 100us sampling interval, active leaf deltas excluding idle/program/root divided by 50. Profiles may include GC, framework and unrelated runtime work; no exact CPU percentile. No deployed CPU or startup_time_ms.",
    cold,
    results,
    checks: {
      failureCases: failures.length,
      ownerIsolation: true,
      cachedDeletionDenied: true,
      cacheHitProvenBySessionRemoval: true,
      d1FailureReturns503: true,
      cookieCacheIssued: true,
      hostOnlySecureCookie: true,
    },
    deployed: {
      status: "not-collected",
      reason: "This harness is local; see separate deployed evidence",
    },
  };
  await writeFile(
    join(output, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`Evidence written to ${output}`);
} catch (error) {
  console.error(scrub(logs.slice(-2000)));
  throw error;
} finally {
  await stop();
  await rm(join(output, ".dev.vars"), { force: true });
}
