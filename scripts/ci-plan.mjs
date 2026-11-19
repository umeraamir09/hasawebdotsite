// The CI e2e plan: which jobs run which projects, from the same affected-path
// rules as `pnpm verify`. Writes `matrix=<json>` for the workflow.
//
//   BASE=<sha> node scripts/ci-plan.mjs   (in a job on the same kind of runner)
//
// GitHub-hosted runners get one job per group so they run in parallel. One
// self-hosted runner takes jobs one at a time, so it gets a single job that
// runs every affected project with two Playwright workers, which saves the
// per-job setup. An unknown base runs every project.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { affectedProjects, projects } from "./verify.mjs";

const hostedGroups = [
  { name: "editor 1/3", projects: ["editor"], shard: "1/3" },
  { name: "editor 2/3", projects: ["editor"], shard: "2/3" },
  { name: "editor 3/3", projects: ["editor"], shard: "3/3" },
  { name: "autosave", projects: ["autosave"] },
  { name: "uploads and auth", projects: ["uploads", "auth"] },
  { name: "renderer and runtime", projects: ["renderer", "runtime"] },
  { name: "publication and api", projects: ["publication", "api"] },
];

const args = (names, shard) =>
  [
    ...names.map((name) => `--project=${name}`),
    ...(shard ? [`--shard=${shard}`] : []),
  ].join(" ");

export function ciMatrix({ affected, selfHosted }) {
  if (!affected.length) return [];
  if (selfHosted)
    return [{ name: affected.join(", "), args: args(affected), workers: "2" }];
  return hostedGroups.flatMap((group) => {
    const names = group.projects.filter((name) => affected.includes(name));
    return names.length
      ? [{ name: group.name, args: args(names, group.shard), workers: "1" }]
      : [];
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const base = process.env.BASE ?? "";
  const known =
    /^[0-9a-f]{40}$/.test(base) &&
    spawnSync("git", ["cat-file", "-e", `${base}^{commit}`]).status === 0;
  const paths = known
    ? spawnSync("git", ["diff", "--name-only", base, "HEAD"], {
        encoding: "utf8",
      })
        .stdout.split("\n")
        .filter(Boolean)
    : null;
  const matrix = ciMatrix({
    affected: paths ? affectedProjects(paths) : [...projects],
    // The runner sets RUNNER_ENVIRONMENT to github-hosted or self-hosted.
    selfHosted: process.env.RUNNER_ENVIRONMENT === "self-hosted",
  });
  console.log(JSON.stringify(matrix, null, 2));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `matrix=${JSON.stringify(matrix)}\n`,
    );
}
