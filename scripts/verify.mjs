// `pnpm verify`: unit checks, then the build and the e2e projects that the
// changes against the base branch can affect. `--all` runs every project.
//
//   pnpm verify                 # check + affected e2e projects
//   pnpm verify --all           # check + build + every e2e project
//   pnpm verify --base=<ref>    # compare against another ref (default origin/main)
//   pnpm verify --dry-run       # print the plan only
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projects = [
  "editor",
  "autosave",
  "api",
  "auth",
  "renderer",
  "publication",
  "runtime",
];

// Paths that cannot change runtime behavior.
const inert = [
  /\.md$/,
  /^docs\//,
  /^\.github\//,
  /^\.agents\//,
  /^\.claude\//,
  /^biome\.json$/,
  /^\.gitignore$/,
  /\.test\.[cm]?[jt]sx?$/,
];

// Paths whose effect is everywhere.
const shared = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^turbo\.json$/,
  /^\.node-version$/,
  /^playwright\.config\.mjs$/,
  /^e2e\/support\//,
  /^packages\/(schema|db|config)\//,
  /^apps\/[^/]+\/(package\.json|wrangler\.jsonc|tsconfig\.json)$/,
  /^scripts\/build-publication-platform\.mjs$/,
];

const areas = [
  [/^apps\/web\//, ["editor", "autosave", "api", "auth", "renderer"]],
  [/^apps\/jobs\//, ["editor", "autosave", "api", "auth", "publication"]],
  [/^apps\/site\//, ["publication", "runtime", "editor"]],
  [/^packages\/auth\//, ["auth", "api"]],
  [
    /^packages\/(components|render|theme)\//,
    ["editor", "renderer", "publication"],
  ],
  [/^packages\/github\//, ["editor", "api"]],
  [/^packages\/email\//, ["api"]],
  [/^e2e\/editor\//, ["editor"]],
  [/^e2e\/autosave\//, ["autosave"]],
  [/^e2e\/(draft-api|persistence|uploads)\//, ["api"]],
  [/^e2e\/auth\//, ["auth"]],
  [/^e2e\/renderer\//, ["renderer"]],
  [/^e2e\/publication\//, ["publication"]],
  [/^e2e\/runtime\//, ["runtime"]],
  [/^e2e\/editor\.spec\.mjs$/, ["editor"]],
  [/^e2e\/autosave\.spec\.mjs$/, ["autosave"]],
  [/^e2e\/(draft-api|persistence|uploads)\.spec\.mjs$/, ["api"]],
  [/^e2e\/(auth|renderer|publication|runtime)\.spec\.mjs$/, null],
  [/^scripts\/(seed\.mjs|fixtures\/)/, ["runtime", "api"]],
];

// Returns the e2e projects to run for a list of changed paths. Unknown
// paths select everything, so an unmapped change is never silently skipped.
export function affectedProjects(paths) {
  const selected = new Set();
  for (const path of paths) {
    if (inert.some((pattern) => pattern.test(path))) continue;
    if (shared.some((pattern) => pattern.test(path))) return [...projects];
    const area = areas.find(([pattern]) => pattern.test(path));
    if (!area) return [...projects];
    const names = area[1] ?? [path.match(/^e2e\/([a-z-]+)\.spec/)[1]];
    for (const name of names) selected.add(name);
  }
  return projects.filter((name) => selected.has(name));
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "git failed");
  return result.stdout.split("\n").filter(Boolean);
}

function changedPaths(root, base) {
  const [mergeBase] = git(root, ["merge-base", "HEAD", base]);
  return [
    ...new Set([
      ...git(root, ["diff", "--name-only", mergeBase]),
      ...git(root, ["ls-files", "--others", "--exclude-standard"]),
    ]),
  ];
}

function run(root, command) {
  console.log(`\n$ ${command.join(" ")}`);
  const started = performance.now();
  const result = spawnSync(command[0], command.slice(1), {
    cwd: root,
    stdio: "inherit",
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(0);
  return { command: command.join(" "), seconds, ok: result.status === 0 };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const args = process.argv.slice(2);
  for (const arg of args)
    if (!/^--(all|dry-run|base=.+)$/.test(arg))
      throw new Error(`Unknown argument: ${arg}`);
  const base =
    args.find((arg) => arg.startsWith("--base="))?.slice(7) ?? "origin/main";
  const selected = args.includes("--all")
    ? [...projects]
    : affectedProjects(changedPaths(root, base));
  const plan = [["pnpm", "check"]];
  if (selected.length)
    plan.push(
      ["pnpm", "build"],
      [
        "pnpm",
        "exec",
        "playwright",
        "test",
        ...selected.map((name) => `--project=${name}`),
      ],
    );
  console.log(
    selected.length
      ? `e2e projects: ${selected.join(", ")}`
      : "No e2e project is affected; running unit checks only.",
  );
  if (args.includes("--dry-run")) {
    for (const command of plan) console.log(command.join(" "));
  } else {
    const results = [];
    for (const command of plan) {
      const result = run(root, command);
      results.push(result);
      if (!result.ok) break;
    }
    console.log("\nSummary");
    for (const { command, seconds, ok } of results)
      console.log(`  ${ok ? "pass" : "FAIL"} ${seconds}s  ${command}`);
    process.exitCode = results.every((result) => result.ok) ? 0 : 1;
  }
}
