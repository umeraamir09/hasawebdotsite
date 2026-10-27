import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createWriteStream, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const allApps = ["web", "site", "jobs"];
const suites = {
  renderer: ["test:renderer", "test:editor"],
  editor: ["test:editor"],
  drafts: ["test:draft-api", "test:autosave", "test:editor"],
  auth: ["test:auth:browser", "test:draft-api", "test:autosave", "test:editor"],
  persistence: ["test:persistence"],
  uploads: ["test:uploads"],
  publication: ["test:publication-dispatch", "test:publication-serving"],
  full: [
    "test:renderer",
    "test:auth:browser",
    "test:persistence",
    "test:uploads",
    "test:publication-dispatch",
    "test:publication-serving",
    "test:draft-api",
    "test:autosave",
    "test:editor",
    "test:runtime",
    "test:runtime:smoke",
    "spike:routing",
  ],
};

export function verificationCommands(profile = "full", builds) {
  if (profile === "runtime") profile = "full";
  if (!["docs", "checks", ...Object.keys(suites)].includes(profile))
    throw new Error(`Unknown verification profile: ${profile}`);
  if (
    builds &&
    (!builds.length || builds.some((app) => !allApps.includes(app)))
  )
    throw new Error("--build must list web, site and/or jobs");
  if (builds && ["docs", "checks", "full"].includes(profile))
    throw new Error(
      "Build overrides apply only to ordinary application profiles",
    );
  if (profile === "docs") return [["git", "diff", "--check", "HEAD"]];
  const commands = [["pnpm", "check"]];
  if (profile === "checks") return commands;
  const apps =
    builds ??
    (["renderer", "editor", "auth", "drafts"].includes(profile)
      ? ["web", "jobs"]
      : allApps);
  commands.push(
    apps.length === allApps.length
      ? ["pnpm", "build"]
      : [
          "pnpm",
          "exec",
          "turbo",
          "run",
          "build",
          ...apps.map((app) => `--filter=@hasaweb/${app}`),
        ],
  );
  commands.push(...suites[profile].map((suite) => ["pnpm", suite]));
  return commands;
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || "Cannot inspect Git state");
  return result.stdout;
}

async function sourceState(root) {
  const hash = createHash("sha256");
  hash.update(git(root, ["diff", "--binary", "HEAD"]));
  const untracked = git(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(Boolean);
  for (const path of untracked) {
    hash
      .update(path)
      .update("\0")
      .update(await readFile(join(root, path)));
  }
  return {
    revision: git(root, ["rev-parse", "HEAD"]).trim(),
    status: git(root, ["status", "--porcelain=v1"]),
    workingChangesSha256: hash.digest("hex"),
  };
}

function descendants(pid) {
  const result = spawnSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error("ps is required for verification cleanup");
  const rows = result.stdout
    .trim()
    .split("\n")
    .map((row) => row.trim().split(/\s+/).map(Number));
  const owned = new Set([pid]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [child, parent] of rows) {
      if (owned.has(parent) && !owned.has(child)) {
        owned.add(child);
        changed = true;
      }
    }
  }
  return [...owned].reverse();
}

function signalOwned(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

export async function runVerification({
  root,
  commands,
  profile,
  dryRun = false,
  lockPath = join(
    process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
    "hasaweb/verification.lock",
  ),
}) {
  if (dryRun) {
    console.log(JSON.stringify({ profile, commands, lockPath }, null, 2));
    return 0;
  }
  const source = await sourceState(root);
  const parent = join(root, ".wrangler/verification");
  await mkdir(parent, { recursive: true });
  const output = await mkdtemp(
    join(parent, `${new Date().toISOString().replaceAll(":", "-")}-`),
  );
  const report = {
    profile,
    source,
    startedAt: new Date().toISOString(),
    commands: [],
    status: "running",
  };
  let lock;
  let child;
  let interrupted;
  let cleanup;
  const terminate = (signal) => {
    if (interrupted) return;
    interrupted = signal;
    if (!child?.pid) return;
    const pids = descendants(child.pid);
    signalOwned(pids, "SIGTERM");
    cleanup = (async () => {
      for (let i = 0; i < 25 && pids.some(alive); i++) await delay(200);
      signalOwned(pids.filter(alive), "SIGKILL");
    })();
  };
  const onInt = () => terminate("SIGINT");
  const onTerm = () => terminate("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  let exitCode = 1;
  try {
    if (profile !== "docs") {
      await mkdir(dirname(lockPath), { recursive: true });
      lock = openSync(lockPath, "a", 0o600);
      const attempt = spawnSync("flock", ["-n", "3"], {
        stdio: ["ignore", "ignore", "pipe", lock],
      });
      if (attempt.error)
        throw new Error("Linux/WSL flock is required for heavy verification");
      if (attempt.status !== 0) {
        if (attempt.status !== 1)
          throw new Error("Cannot acquire verification lock");
        console.log(`Waiting for another verification run: ${lockPath}`);
        child = spawn("flock", ["3"], {
          stdio: ["ignore", "inherit", "inherit", lock],
        });
        const code = await new Promise((done, reject) => {
          child.once("error", reject);
          child.once("exit", done);
        });
        if (interrupted)
          throw new Error("Interrupted while waiting for verification lock");
        if (code !== 0) throw new Error("Cannot acquire verification lock");
        child = undefined;
      }
    }
    console.log(`Verification output: ${output}`);
    for (const [index, command] of commands.entries()) {
      if (interrupted) break;
      const log = createWriteStream(join(output, `${index + 1}.log`));
      const entry = { command, startedAt: new Date().toISOString() };
      report.commands.push(entry);
      const begin = performance.now();
      console.log(`Running ${command.join(" ")}`);
      const suite = join(output, `suite-${index + 1}`);
      child = spawn(command[0], command.slice(1), {
        cwd: root,
        detached: true,
        env: {
          ...process.env,
          DRAFT_API_EVIDENCE: process.env.DRAFT_API_EVIDENCE ?? suite,
          BOUNDED_SAVE_EVIDENCE: process.env.BOUNDED_SAVE_EVIDENCE ?? suite,
          OWNER_RUNTIME_EVIDENCE: process.env.OWNER_RUNTIME_EVIDENCE ?? suite,
          RENDERER_EVIDENCE: process.env.RENDERER_EVIDENCE ?? suite,
          S8_EVIDENCE: process.env.S8_EVIDENCE ?? suite,
          AUTH_EVIDENCE: process.env.AUTH_EVIDENCE ?? suite,
          RUNTIME_EVIDENCE: process.env.RUNTIME_EVIDENCE ?? suite,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (data) => {
          log.write(data);
          process.stdout.write(data);
        });
      const result = await new Promise((done) => {
        child.once("error", (error) => {
          log.write(`${error.message}\n`);
          done({ code: 1 });
        });
        child.once("close", (code, signal) => done({ code, signal }));
      });
      await new Promise((done) => log.end(done));
      await cleanup;
      child = undefined;
      entry.durationMs = Math.round(performance.now() - begin);
      entry.exitCode = result.code;
      entry.signal = result.signal;
      if (interrupted || result.code !== 0) {
        exitCode = result.code || 1;
        break;
      }
      exitCode = 0;
    }
    if (interrupted) exitCode = interrupted === "SIGINT" ? 130 : 143;
    report.status = interrupted
      ? "interrupted"
      : exitCode === 0
        ? "passed"
        : "failed";
  } catch (error) {
    report.status = interrupted ? "interrupted" : "failed";
    report.error = error.message;
    console.error(error.message);
    exitCode = interrupted ? (interrupted === "SIGINT" ? 130 : 143) : 1;
  } finally {
    await cleanup;
    if (lock !== undefined) closeSync(lock);
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    report.finishedAt = new Date().toISOString();
    report.finalSource = await sourceState(root);
    await writeFile(
      join(output, "summary.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      `Verification ${report.status}: ${join(output, "summary.json")}`,
    );
  }
  return exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    for (const arg of args)
      if (arg !== "--dry-run" && !/^--(profile|build)=.+$/.test(arg))
        throw new Error(`Unknown argument: ${arg}`);
    const profile =
      args.find((arg) => arg.startsWith("--profile="))?.slice(10) ?? "full";
    const builds = args
      .find((arg) => arg.startsWith("--build="))
      ?.slice(8)
      .split(",");
    process.exitCode = await runVerification({
      root: fileURLToPath(new URL("..", import.meta.url)),
      profile,
      commands: verificationCommands(profile, builds),
      dryRun: args.includes("--dry-run"),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
