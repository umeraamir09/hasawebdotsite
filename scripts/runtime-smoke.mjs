import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const port = 8799;
const base = `http://127.0.0.1:${port}`;
const seed = spawnSync("pnpm", ["local:seed"], { stdio: "inherit" });
assert.equal(seed.status, 0, "local seed must succeed");

async function json(path, options) {
  const response = await fetch(`${base}${path}`, options);
  assert.equal(response.status, options?.method === "POST" ? 202 : 200, path);
  return response.json();
}
async function eventually(check) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
    }
    await setTimeout(500);
  }
  throw lastError;
}
function start() {
  const child = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "-c",
      "apps/web/wrangler.jsonc",
      "-c",
      "apps/site/wrangler.jsonc",
      "-c",
      "apps/jobs/wrangler.jsonc",
      "--persist-to",
      ".wrangler/state",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
    ],
    {
      detached: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(-16_000);
  });
  child.stderr.on("data", (chunk) => {
    output = (output + chunk).slice(-16_000);
  });
  return { child, output: () => output };
}
async function stop(runtime) {
  if (runtime.child.exitCode !== null || runtime.child.signalCode !== null)
    return;
  const exited = new Promise((resolve) => runtime.child.once("exit", resolve));
  process.kill(-runtime.child.pid, "SIGTERM");
  await Promise.race([exited, setTimeout(5_000, undefined, { ref: false })]);
  if (runtime.child.exitCode === null && runtime.child.signalCode === null)
    process.kill(-runtime.child.pid, "SIGKILL");
}
let runtime;
try {
  runtime = start();
  await eventually(async () =>
    assert.equal((await json("/api/health")).app, "web"),
  );
  assert.equal(
    (await fetch(`${base}/api/runtime-spike`)).status,
    404,
    "S-2 probe must be disabled by default",
  );
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /hasaweb.site/);
  for (const app of ["site", "jobs"]) {
    assert.equal((await json(`/api/dev-runtime/${app}/health`)).app, app);
  }
  const web = await json("/api/dev-runtime/web/resources");
  assert.equal(web.row.value, "local fixture");
  assert.equal(web.draft, "local draft fixture\n");
  const site = await json("/api/dev-runtime/site/resources");
  assert.equal(site.row.value, "local fixture");
  assert.equal(site.site, "local site fixture\n");
  assert.equal(site.asset, "local asset fixture\n");
  const { id } = await json("/api/dev-runtime/web/run", { method: "POST" });
  async function verifyResults() {
    const result = await json("/api/dev-runtime/jobs/results");
    assert.equal(result.site, "local site fixture\n");
    assert.equal(result.asset, "local asset fixture\n");
    for (const kind of [
      "hasaweb-contact-local",
      "hasaweb-github-local",
      "workflow",
    ]) {
      assert.ok(
        result.rows.some(
          (row) => row.key === `${kind}:${id}` && row.value === "complete",
        ),
        kind,
      );
    }
  }
  await eventually(verifyResults);
  await stop(runtime);
  runtime = start();
  await eventually(verifyResults);
  assert.equal((await json("/api/dev-runtime/web/resources")).draft, web.draft);
  assert.equal((await json("/api/dev-runtime/site/resources")).site, site.site);
  console.log(
    "PASS: three Workers, D1, three R2 buckets, services, Queue, Workflow, and restart persistence",
  );
} catch (error) {
  if (runtime) console.error(runtime.output());
  throw error;
} finally {
  if (runtime) await stop(runtime);
}
