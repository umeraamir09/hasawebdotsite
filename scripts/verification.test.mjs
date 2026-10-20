import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { createEvidenceDirectory } from "./lib/evidence-directory.mjs";

const runner = new URL("./verify.mjs", import.meta.url).href;
const temporary = [];
const processes = [];

it("CLI exposes affected builds and rejects unknown profiles or weakened full gates", () => {
  const invoke = (...args) =>
    spawnSync(process.execPath, [fileURLToPath(runner), ...args, "--dry-run"], {
      encoding: "utf8",
    });
  const drafts = invoke("--profile=drafts", "--build=web,jobs");
  expect(drafts.status, drafts.stderr).toBe(0);
  const plan = JSON.parse(drafts.stdout);
  expect(plan.commands.flat()).toContain("--filter=@hasaweb/jobs");
  expect(plan.commands.flat()).not.toContain("--filter=@hasaweb/site");
  expect(invoke("--profile=unknown").status).toBe(1);
  expect(invoke("--profile=full", "--build=web").status).toBe(1);
  expect(invoke("--profile=runtime", "--build=web").status).toBe(1);
});

afterEach(async () => {
  for (const child of processes.splice(0))
    if (child.exitCode === null) child.kill("SIGKILL");
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "hasaweb-verification-"));
  temporary.push(root);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  };
  git("init", "--quiet");
  await writeFile(join(root, ".gitignore"), ".wrangler/\n");
  git("add", ".gitignore");
  git(
    "-c",
    "user.name=Verification",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  return { root, git, lock: join(root, ".wrangler/shared.lock") };
}

function start(root, commands, lock, dryRun = false) {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { runVerification } from ${JSON.stringify(runner)};
     process.exitCode = await runVerification(${JSON.stringify({ root, commands, profile: "fixture", lockPath: lock, dryRun })});`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  processes.push(child);
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      output += data;
    });
  const done = new Promise((resolve) =>
    child.once("close", (code, signal) => resolve({ code, signal, output })),
  );
  return { child, done, output: () => output };
}

async function eventually(action) {
  for (let i = 0; i < 100; i++) {
    try {
      return await action();
    } catch {
      await delay(50);
    }
  }
  return action();
}

async function summary(root) {
  const parent = join(root, ".wrangler/verification");
  const [directory] = await readdir(parent);
  return JSON.parse(
    await readFile(join(parent, directory, "summary.json"), "utf8"),
  );
}

it("dry run prints commands without executing them or creating evidence", async () => {
  const { root, lock } = await repository();
  const run = start(
    root,
    [[process.execPath, "-e", "process.exit(9)"]],
    lock,
    true,
  );
  expect((await run.done).code).toBe(0);
  expect(run.output()).toContain("process.exit(9)");
  await expect(readdir(join(root, ".wrangler"))).rejects.toThrow();
});

it("failed commands stop the gate, retain logs and return the failing status", async () => {
  const { root, lock } = await repository();
  const run = start(
    root,
    [
      [
        process.execPath,
        "-e",
        "console.error('fixture failure'); process.exit(7)",
      ],
      [process.execPath, "-e", "console.log('must not execute')"],
    ],
    lock,
  );
  expect((await run.done).code).toBe(7);
  expect(run.output()).not.toContain("must not execute");
  const report = await summary(root);
  expect(report.status).toBe("failed");
  expect(report.commands).toHaveLength(1);
  expect(report.commands[0].exitCode).toBe(7);
  expect(report.source.revision).toMatch(/^[a-f0-9]{40}$/);
  const [directory] = await readdir(join(root, ".wrangler/verification"));
  expect(
    await readFile(
      join(root, ".wrangler/verification", directory, "1.log"),
      "utf8",
    ),
  ).toContain("fixture failure");
});

it("separate Git worktrees wait for the same lock and execute sequentially", async () => {
  const { root, git, lock } = await repository();
  const second = `${root}-worktree`;
  temporary.push(second);
  git("worktree", "add", "--quiet", "--detach", second, "HEAD");
  const first = start(
    root,
    [
      [
        process.execPath,
        "-e",
        "console.log('holding lock'); setTimeout(() => {}, 700)",
      ],
    ],
    lock,
  );
  await eventually(() => expect(first.output()).toContain("holding lock"));
  const next = start(
    second,
    [[process.execPath, "-e", "console.log('second started')"]],
    lock,
  );
  await eventually(() =>
    expect(next.output()).toContain("Waiting for another verification run"),
  );
  expect(next.output()).not.toContain("second started");
  expect((await first.done).code).toBe(0);
  expect((await next.done).code).toBe(0);
  expect((await summary(second)).status).toBe("passed");
});

it("interruption stops detached descendants and releases the lock for the next gate", async () => {
  const { root, lock } = await repository();
  const fixture = `
    const { spawn } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    writeFileSync('.wrangler/worker.pid', String(worker.pid));
    setInterval(() => {}, 1000);
  `;
  const run = start(root, [[process.execPath, "-e", fixture]], lock);
  const worker = await eventually(async () =>
    Number(await readFile(join(root, ".wrangler/worker.pid"), "utf8")),
  );
  run.child.kill("SIGTERM");
  expect((await run.done).code).toBe(143);
  const state = spawnSync("ps", ["-o", "stat=", "-p", String(worker)], {
    encoding: "utf8",
  }).stdout.trim();
  expect(state === "" || state.startsWith("Z")).toBe(true);
  expect((await summary(root)).status).toBe("interrupted");
  const next = start(root, [[process.execPath, "-e", "process.exit(0)"]], lock);
  expect((await next.done).code).toBe(0);
}, 15000);

it("records untracked and working changes so an unchanged revision cannot disguise edited code", async () => {
  const { root, lock } = await repository();
  await writeFile(join(root, "new-source.mjs"), "export const value = 1;\n");
  const run = start(root, [[process.execPath, "-e", "process.exit(0)"]], lock);
  expect((await run.done).code).toBe(0);
  const report = await summary(root);
  expect(report.source.status).toContain("new-source.mjs");
  expect(report.source.workingChangesSha256).toBe(
    report.finalSource.workingChangesSha256,
  );
});

it("standalone evidence defaults are unique and explicit relative/absolute overrides still work", async () => {
  const { root } = await repository();
  const first = await createEvidenceDirectory(root, "draft");
  await writeFile(join(first, "receipt.json"), "original");
  const second = await createEvidenceDirectory(root, "draft");
  expect(second).not.toBe(first);
  expect(await readFile(join(first, "receipt.json"), "utf8")).toBe("original");
  expect(
    await createEvidenceDirectory(root, "draft", ".wrangler/selected"),
  ).toBe(join(root, ".wrangler/selected"));
  expect(await createEvidenceDirectory(root, "draft", first)).toBe(first);
});
