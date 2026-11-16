import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "playwright/test";
import { createEditorHarness } from "../editor/harness.mjs";
import { startOwnerRuntime } from "./owner-runtime.mjs";

export { expect } from "playwright/test";

export const root = fileURLToPath(new URL("../../", import.meta.url));

// Scratch state for one worker: a fresh D1/R2 store and bundles.
export const workDirectory = (info, name) =>
  join(
    root,
    ".wrangler/e2e",
    `${info.project.name}-${name}-${info.parallelIndex}`,
  );

// Failure screenshots, DOM and JSON reports. Lives under test-results, which
// CI uploads when a job fails.
export const evidenceDirectory = (info, name) =>
  join(info.project.outputDir, "evidence", `${name}-${info.parallelIndex}`);

// Passes test.step as the group runner's step, so groups show by name.
export const step = (name, body) => base.step(name, body);

export const test = base.extend({
  // Runs a standalone suite script under node and fails with its output tail.
  // The script's process group is killed if the test ends early.
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature.
  nodeSuite: async ({}, use, info) => {
    const running = new Set();
    await use(async (script, { args = [], env = {} } = {}) => {
      const child = spawn(process.execPath, [join(root, script), ...args], {
        cwd: root,
        detached: true,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      running.add(child);
      let output = "";
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (chunk) => {
          output = (output + chunk).slice(-64_000);
          process.stdout.write(chunk);
        });
      const code = await new Promise((resolve) => child.once("close", resolve));
      running.delete(child);
      await info.attach("output", { body: output, contentType: "text/plain" });
      if (code !== 0)
        throw new Error(
          `${script} exited with ${code}:\n${output.slice(-6000)}`,
        );
    });
    for (const child of running)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
  },
  // One owner runtime (built web Worker + jobs owner router in workerd) per
  // worker, shared by the tests that worker runs.
  ownerRuntime: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature.
    async ({}, use, info) => {
      const runtime = await startOwnerRuntime({
        directory: workDirectory(info, "owner"),
        evidence: evidenceDirectory(info, "owner"),
      });
      await use(runtime);
      await runtime.close();
      // workerd output explains storage errors and crashed requests.
      const evidence = evidenceDirectory(info, "owner");
      await mkdir(evidence, { recursive: true });
      await writeFile(join(evidence, "runtime.log"), runtime.logs());
    },
    { scope: "worker", timeout: 180_000 },
  ],
  editor: [
    async ({ ownerRuntime }, use, info) => {
      const harness = await createEditorHarness({
        ...ownerRuntime,
        workDirectory: workDirectory(info, "editor"),
      });
      await use(harness);
      await harness.close();
    },
    { scope: "worker", timeout: 180_000 },
  ],
});
