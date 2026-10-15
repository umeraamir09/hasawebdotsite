import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const output = join(root, ".wrangler/workflow-assets");
await mkdir(output, { recursive: true });
const state = join(output, "state");
await rm(state, { recursive: true, force: true });
await wranglerRequire("esbuild").build({
  stdin: {
    contents:
      'export * from "./packages/render/spike/fixtures"; export * from "./packages/render/spike/render";',
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(output, "fixtures.cjs"),
});
const { makeFixture, fragments, renderFixture } = await import(
  pathToFileURL(join(output, "fixtures.cjs"))
);
const config = join(output, "wrangler.json");
await writeFile(
  config,
  JSON.stringify({
    name: "hasaweb-workflow-assets-local",
    main: join(root, "packages/render/workflow-spike/worker.ts"),
    compatibility_date: "2026-10-14",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    vars: { APP_ENV: "local" },
    d1_databases: [
      {
        binding: "DB",
        database_name: "workflow-assets-local",
        database_id: "00000000-0000-0000-0000-000000000008",
      },
    ],
    r2_buckets: [{ binding: "BUCKET", bucket_name: "workflow-assets-local" }],
    workflows: [
      {
        binding: "FLOW",
        name: "workflow-assets-local",
        class_name: "PublishSpike",
      },
    ],
  }),
);
const base = "http://127.0.0.1:8808";
let logs = "";
const child = spawn(
  process.execPath,
  [
    join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js"),
    "dev",
    "-c",
    config,
    "--persist-to",
    state,
    "--port",
    "8808",
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
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (data) => {
    logs = (logs + data).slice(-18000);
  });
const checks = [];
function check(name, condition) {
  assert.ok(condition, name);
  checks.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function call(path, data, method = "POST") {
  const response = await fetch(base + path, {
    method,
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
async function put(key, value) {
  const response = await fetch(
    `${base}/object?key=${encodeURIComponent(key)}`,
    { method: "PUT", body: value },
  );
  assert.ok(response.ok);
}
async function get(key) {
  return fetch(`${base}/object?key=${encodeURIComponent(key)}`);
}
async function seed(id, pages) {
  const result = [];
  for (const name of pages) {
    const fixture = makeFixture(name);
    const records = fragments(fixture);
    for (let index = 0; index < records.length; index++)
      await put(`input/${id}/${name}/${index}`, records[index]);
    result.push({ name, fragments: records.length });
  }
  return result;
}
async function wait(id) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const status = await call(`/status?id=${id}`, undefined, "GET");
    if (["complete", "errored", "terminated"].includes(status.status))
      return status;
    await setTimeout(250);
  }
  throw new Error(`Workflow timed out: ${id}\n${logs}`);
}
const started = Date.now();
try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    try {
      ready = (await fetch(`${base}/health`)).ok;
    } catch {}
    if (ready) break;
    await setTimeout(100);
  }
  assert.ok(ready, logs);
  await call("/init");
  await call("/site", { site: "race" });
  await call("/site", { site: "failure" });
  await call("/site", { site: "retry" });
  const pagesA = await seed("candidate-a", [
    "portfolio",
    "case-study",
    "resume",
  ]);
  const pagesB = await seed("candidate-b", [
    "portfolio",
    "case-study",
    "resume",
  ]);
  const failurePages = await seed("candidate-fail", ["portfolio"]);
  await put(
    "input/candidate-retry/portfolio/0",
    fragments(makeFixture("portfolio"))[0],
  );
  await Promise.all([
    call("/start", {
      id: "candidate-a",
      site: "race",
      base: "old",
      pages: pagesA,
    }),
    call("/start", {
      id: "candidate-b",
      site: "race",
      base: "old",
      pages: pagesB,
    }),
    call("/start", {
      id: "candidate-retry",
      site: "retry",
      base: "old",
      pages: [{ name: "portfolio", fragments: 1 }],
      fault: "retry",
    }),
    call("/start", {
      id: "candidate-fail",
      site: "failure",
      base: "old",
      pages: failurePages,
      fault: "permanent",
    }),
  ]);
  const statuses = await Promise.all([
    wait("candidate-a"),
    wait("candidate-b"),
    wait("candidate-fail"),
    wait("candidate-retry"),
  ]);
  check(
    "both concurrent multi-page Workflows complete",
    statuses[0].status === "complete" && statuses[1].status === "complete",
  );
  check(
    "permanent post-write failure exhausts retries",
    statuses[2].status === "errored",
  );
  check(
    "exactly one competing commit wins",
    statuses.slice(0, 2).filter((s) => s.output.committed).length === 1,
  );
  const snapshots = await call("/state", undefined, "GET");
  check(
    "failed candidate preserves prior pointer",
    snapshots.sites.find((s) => s.id === "failure").version === "old",
  );
  check(
    "transient post-write fault retries once",
    snapshots.attempts.find((s) => s.id === "candidate-retry").count === 2,
  );
  check(
    "transient retry candidate completes",
    statuses[3].status === "complete",
  );
  check(
    "failed candidate has no complete manifest",
    (await get("candidate/candidate-fail/manifest.json")).status === 404,
  );
  const winner = statuses.slice(0, 2).find((status) => status.output.committed);
  check(
    "D1 pointer identifies the complete winning manifest",
    winner.output.manifest ===
      `candidate/${snapshots.sites.find((site) => site.id === "race").version}/manifest.json`,
  );
  check(
    "durable step results remain below 1 MiB",
    statuses
      .slice(0, 2)
      .every((status) =>
        status.__LOCAL_DEV_STEP_OUTPUTS.every(
          (value) => Buffer.byteLength(JSON.stringify(value)) < 1048576,
        ),
      ),
  );
  for (const status of statuses.slice(0, 2)) {
    check("Workflow stays within 1024 step limit", status.output.steps < 1024);
    const manifest = await (await get(status.output.manifest)).json();
    check("complete immutable manifest persisted", manifest.length === 3);
    for (let index = 0; index < manifest.length; index++) {
      const actual = await (await get(manifest[index].key)).text();
      const expected = renderFixture(makeFixture(pagesA[index].name));
      check(
        `${status.output.manifest} ${pagesA[index].name} exact ordered output`,
        actual === expected,
      );
    }
  }
  // The same adapter is unit-tested for purge failure and retry. Here exercise real R2 deletion.
  await put("private/face.webp", "synthetic private image");
  await put("public/face.webp", "synthetic private image");
  await fetch(`${base}/object?key=public%2Fface.webp`, { method: "DELETE" });
  check(
    "withdrawn public origin returns 404",
    (await get("public/face.webp")).status === 404,
  );
  check(
    "private original survives withdrawal",
    (await (await get("private/face.webp")).text()) ===
      "synthetic private image",
  );
  await fetch(`${base}/object?key=public%2Fface.webp`, { method: "DELETE" });
  check(
    "repeated public deletion is idempotent",
    (await get("public/face.webp")).status === 404,
  );
  const result = {
    recordedAt: new Date().toISOString(),
    runtime: "Wrangler local workerd, actual Workflows/D1/R2",
    elapsedMs: Date.now() - started,
    checks,
    pages: pagesA,
    statuses,
    snapshots,
    limitations: [
      "Local runtime does not enforce deployed Free CPU quotas",
      "Pre-normalized input records stand in for future transactional draft normalization",
      "Near-limit fixture per page intentionally overstates the total 1 MiB portfolio draft",
      "Local R2 deletion does not prove CDN purge or multiple edge locations",
    ],
  };
  await writeFile(
    join(root, "specs/2026-10-15-workflow-assets/evidence.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(`${checks.length} checks passed`);
} catch (error) {
  console.error(error);
  console.error(logs);
  process.exitCode = 1;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    process.kill(-child.pid, "SIGTERM");
    await Promise.race([exited, setTimeout(5000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid, "SIGKILL");
  }
}
