import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Explicit remote execution against an isolated experiment database only.
// The operator must confirm the account plan and provision this config first.
const root = fileURLToPath(new URL("..", import.meta.url));
const configPath = process.argv[2];
const secretPath = process.argv[3];
assert.ok(
  configPath && secretPath,
  "Usage: node scripts/deployed-runtime-benchmark.mjs <ignored-config.json> <ignored-secrets.json>",
);
const config = JSON.parse(await readFile(configPath, "utf8"));
assert.equal(config.name, "hasaweb-s2-spike");
assert.equal(config.d1_databases[0].database_name, "hasaweb-s2-spike");
assert.ok(
  !config.routes?.length && !config.route,
  "S-2 does not change domain routing",
);
const secrets = JSON.parse(await readFile(secretPath, "utf8"));
const origin = config.vars.SPIKE_ORIGIN;
assert.match(origin, /^https:\/\/hasaweb-s2-spike\.[a-z0-9-]+\.workers\.dev$/);
const output = join(root, ".wrangler/s2-production");
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const runId = randomUUID();
const tokens = Object.fromEntries(
  ["owner-a", "owner-b", "expired", "deleting"].map((name) => [
    name,
    randomBytes(32).toString("hex"),
  ]),
);
function cookie(name) {
  const token = tokens[name];
  return `__Host-spike.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secrets.BETTER_AUTH_SECRET).update(token).digest("base64")}`)}`;
}
async function sql(command) {
  const path = join(output, "fixture.sql");
  await writeFile(path, command, { mode: 0o600 });
  try {
    const result = spawnSync(
      process.execPath,
      [
        wrangler,
        "d1",
        "execute",
        "DB",
        "--remote",
        "--config",
        configPath,
        "--file",
        path,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    assert.equal(
      result.status,
      0,
      "Remote isolated D1 operation failed; inspect Wrangler diagnostics privately",
    );
  } finally {
    await rm(path, { force: true });
  }
}
let fixture = await readFile(join(root, "apps/web/spike/fixture.sql"), "utf8");
fixture +=
  "\nDELETE FROM spike_session; DELETE FROM spike_owner; DELETE FROM spike_user;\n";
const now = Date.now();
for (const [name, token] of Object.entries(tokens)) {
  fixture += `INSERT INTO spike_user VALUES ('${name}', '${name}', '${name}@example.invalid', 1, NULL, ${now}, ${now});\n`;
  fixture += `INSERT INTO spike_session VALUES ('${name}', '${token}', '${name}', ${name === "expired" ? 0 : now + 86400000}, ${now}, ${now}, NULL, NULL);\n`;
  fixture += `INSERT INTO spike_owner (id, deleting) VALUES ('${name}', ${name === "deleting" ? 1 : 0});\n`;
}
await sql(fixture);
const samples = [];
async function request(test = {}, label = "check") {
  const begin = performance.now();
  const start = Date.now();
  const response = await fetch(
    `${origin}/api/runtime-spike?run=${runId}&case=${label}`,
    {
      method: test.method ?? "GET",
      body: test.body,
      headers: {
        Authorization: `Bearer ${secrets.SPIKE_KEY}`,
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: test.cookie ?? cookie("owner-a"),
        ...test.extra,
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  const text = await response.text();
  const sample = {
    case: label,
    at: start,
    elapsedMs: performance.now() - begin,
    status: response.status,
    ray: response.headers.get("cf-ray"),
  };
  samples.push(sample);
  assert.equal(
    response.status,
    test.status ?? 200,
    `${label}: status ${response.status}, ray ${sample.ray}, dependency ${JSON.parse(text)?.dependency ?? "unknown"}, upstream status ${JSON.parse(text)?.status ?? "unknown"}`,
  );
  return {
    data: JSON.parse(text),
    cookies: response.headers.getSetCookie(),
    sample,
  };
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
const recordedAt = new Date().toISOString();
const results = [];
let failure;
try {
  const first = await request({}, "first-candidate");
  const cached = [
    cookie("owner-a"),
    ...first.cookies.map((c) => c.split(";")[0]),
  ].join("; ");
  assert.ok(cached.includes("session_data="));
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
  for (const test of process.argv.includes("--checks-only")
    ? cases.filter((test) => test.name === "signed-out")
    : cases) {
    for (let i = 0; i < 10; i++)
      await request(test.options, `warmup-${test.name}`);
    const elapsed = [];
    for (let i = 0; i < 100; i++)
      elapsed.push((await request(test.options, test.name)).sample.elapsedMs);
    results.push({
      name: test.name,
      bodyBytes: Buffer.byteLength(test.options.body ?? ""),
      elapsedMs: summary(elapsed),
    });
    console.log(JSON.stringify(results.at(-1)));
  }
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
  for (const test of failures)
    await request({ method: "POST", body: "{}", ...test });
  assert.equal((await request()).data.writes, before);
  await request({
    method: "POST",
    body: JSON.stringify({ ownerId: "owner-b" }),
  });
  assert.equal((await request({ cookie: cookie("owner-b") })).data.writes, 0);
  await sql("DELETE FROM spike_session WHERE user_id = 'owner-a';");
  await request({ cookie: cached });
  await request({ status: 401 });
  await sql("UPDATE spike_owner SET deleting = 1 WHERE id = 'owner-a';");
  await request({ cookie: cached, status: 403 });
  await sql("DROP TABLE spike_owner;");
  await request({ cookie: cached, method: "POST", body: "{}", status: 503 });
} catch (error) {
  failure = String(error);
} finally {
  await writeFile(
    join(
      output,
      process.argv.includes("--checks-only")
        ? "requests-checks.json"
        : "requests.json",
    ),
    `${JSON.stringify({ recordedAt, runId, origin, node: process.version, method: "Deployed sequential HTTPS elapsed timing. Ten warmups and 100 samples per case. CPU must be joined from Cloudflare logs by run/case; response elapsed is not CPU. First candidate after deploy is not guaranteed isolate-cold.", results, samples, failure }, null, 2)}\n`,
  );
  // Tokens and owner data have no continuing use. Retain only measurements.
  await sql(
    "DELETE FROM spike_session; DELETE FROM spike_user; DELETE FROM spike_verification;",
  );
}
if (failure) throw new Error(failure);
console.log(`Deployed request evidence written to ${output}`);
