import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
const output = join(root, ".wrangler/email-delivery");
const state = join(output, "state");
const evidence = join(root, "specs/2026-10-15-email-delivery/evidence.json");
const config = join(output, "wrangler.json");
const port = 8807;
let child;
let logs = "";
await mkdir(output, { recursive: true });
await rm(evidence, { force: true });
await rm(state, { recursive: true, force: true });
await writeFile(
  config,
  JSON.stringify({
    name: "hasaweb-email-delivery-local",
    main: join(root, "packages/email/spike/worker.ts"),
    compatibility_date: "2026-10-14",
    workers_dev: false,
    d1_databases: [
      {
        binding: "DB",
        database_name: "email-delivery-local",
        database_id: "00000000-0000-0000-0000-000000000007",
      },
    ],
  }),
);
try {
  child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--config",
      config,
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
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      logs = (logs + data).slice(-12000);
    });
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await setTimeout(100);
  }
  assert.ok(ready, logs);
  const response = await fetch(`http://127.0.0.1:${port}/run`, {
    method: "POST",
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const result = await response.json();
  assert.ok(result.checks.length >= 60);
  assert.ok(result.checks.every((check) => check.passed));
  await writeFile(evidence, `${JSON.stringify(result, null, 2)}\n`);
  for (const check of result.checks) console.log(`PASS ${check.name}`);
  console.log(`${result.checks.length} checks passed in ${result.runtime}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    process.kill(-child.pid, "SIGTERM");
    await Promise.race([exited, setTimeout(5000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid, "SIGKILL");
  }
  await rm(state, { recursive: true, force: true });
}
