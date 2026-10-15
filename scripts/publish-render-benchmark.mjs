import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const output = join(root, ".wrangler/render-spike");
await mkdir(output, { recursive: true });
const build = spawnSync(
  process.execPath,
  [
    join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js"),
    "deploy",
    "--dry-run",
    "--config",
    "packages/render/spike/wrangler.jsonc",
    "--outdir",
    output,
  ],
  { env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, encoding: "utf8" },
);
assert.equal(build.status, 0, build.stdout + build.stderr);
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: join(output, "worker.js"),
    compatibilityDate: "2026-10-14",
    compatibilityFlags: ["nodejs_compat"],
    inspectorPort: 0,
  }),
);
let socket;
let nextId = 0;
const pending = new Map();
async function command(method, params = {}) {
  const id = ++nextId;
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Inspector command timed out: ${method}`));
    }, 10_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return reply;
}
function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1),
  };
}
try {
  await runtime.ready;
  const inspector = await runtime.getInspectorURL();
  inspector.protocol = "http:";
  const targets = await (
    await fetch(new URL("/json", inspector), {
      signal: AbortSignal.timeout(10_000),
    })
  ).json();
  assert.ok(
    targets[0]?.webSocketDebuggerUrl,
    "workerd inspector target required",
  );
  socket = new WebSocket(targets[0].webSocketDebuggerUrl);
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
  const results = [];
  for (const kind of ["portfolio", "case-study", "resume"]) {
    for (const mode of ["page", "fragment", "prepare"]) {
      async function run(repeats) {
        const response = await runtime.dispatchFetch(
          `http://spike.test/?kind=${kind}&mode=${mode}&repeats=${repeats}`,
        );
        assert.equal(response.status, 200);
        return response.json();
      }
      const first = await run(1);
      await run(10);
      const warm = await run(50);
      await command("Profiler.start");
      const profiled = await run(50);
      const { profile } = await command("Profiler.stop");
      await writeFile(
        join(output, `${kind}-${mode}.cpuprofile`),
        JSON.stringify(profile),
      );
      const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
      let activeUs = 0;
      let activeSamples = 0;
      for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
        const name = nodes.get(profile.samples[i])?.callFrame.functionName;
        if (["(idle)", "(program)", "(root)"].includes(name)) continue;
        activeUs += profile.timeDeltas[i];
        activeSamples++;
      }
      const result = {
        kind,
        mode,
        inputBytes: warm.inputBytes,
        outputBytes: warm.outputBytes,
        nodes: warm.nodes,
        fragments: warm.fragments,
        firstMs: summary(first.samples),
        warmMs: summary(warm.samples),
        sampledCpu: {
          activeSamples,
          activeMsPerUnit: activeUs / 1000 / profiled.samples.length,
          units: profiled.samples.length,
        },
        firstSamplesMs: first.samples,
        warmSamplesMs: warm.samples,
      };
      results.push(result);
      console.log(
        JSON.stringify({
          kind,
          mode,
          warmMs: result.warmMs,
          sampledCpu: result.sampledCpu,
        }),
      );
    }
  }
  for (const kind of ["portfolio", "case-study", "resume"]) {
    const pair = results.filter(
      (result) => result.kind === kind && result.mode !== "prepare",
    );
    assert.equal(
      pair[0].outputBytes,
      pair[1].outputBytes,
      "fragment output size must match whole page",
    );
  }
  const report = {
    recordedAt: new Date().toISOString(),
    node: process.version,
    wrangler: require("wrangler/package.json").version,
    miniflare: wranglerRequire("miniflare/package.json").version,
    workerd: wranglerRequire("workerd/package.json").version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    method:
      "Local workerd, production React. Synchronous parse + element creation + static markup + UTF-8 encoding. 10 warmup and 50 measured repeats. Separate 100us V8 sampled profiles; active estimate excludes idle/program/root. Preparation measured separately as full snapshot parse + partition + encoding. No R2, Workflow persistence or production enforcement. First sample is first use per shape/mode in one shared isolate, not nine isolate-cold starts.",
    results,
  };
  await writeFile(
    join(output, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`Evidence written to ${output}`);
} finally {
  socket?.close();
  await runtime.dispose();
}
