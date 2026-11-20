// The CI e2e plan. Writes `matrix=<json>` for the workflow.
//
//   node scripts/ci-plan.mjs   (in a job on the same kind of runner)
//
// Every code change runs every e2e project, on any runner. GitHub-hosted
// runners split them into seven parallel one-worker jobs. A self-hosted
// runner takes jobs one at a time, so it runs them all in a single job with
// two Playwright workers instead, which saves six rounds of job setup.
//
// Each entry also names its runner and timeout. The e2e job reads them from
// here rather than from the CI_RUNNER variable, because a queued job resolves
// `vars` when it starts: if the variable changes in between, a self-hosted
// plan would otherwise run on a hosted runner with the hosted time limit.
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projects } from "./verify.mjs";

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

export function ciMatrix({ selfHosted }) {
  if (selfHosted)
    return [
      {
        name: "all projects",
        args: args(projects),
        workers: "2",
        // Only runners labelled `e2e` take it, so one machine never runs two
        // full e2e jobs at once.
        runsOn: ["self-hosted", "e2e"],
        timeout: 60,
        selfHosted: true,
      },
    ];
  return hostedGroups.map((group) => ({
    name: group.name,
    args: args(group.projects, group.shard),
    workers: "1",
    runsOn: "ubuntu-latest",
    timeout: 15,
    selfHosted: false,
  }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const matrix = ciMatrix({
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
