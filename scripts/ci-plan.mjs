// The CI e2e plan. Writes `matrix=<json>` for the workflow.
//
//   node scripts/ci-plan.mjs
//
// Every code change runs every e2e project, split into seven parallel
// one-worker jobs. The two setup guide tests are the slowest editor tests, so
// they get a job of their own and the other editor tests split in two.
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const guide = "setup guide";

const groups = [
  { name: "editor setup guide", projects: ["editor"], grep: guide },
  { name: "editor 1/2", projects: ["editor"], invert: guide, shard: "1/2" },
  { name: "editor 2/2", projects: ["editor"], invert: guide, shard: "2/2" },
  { name: "autosave", projects: ["autosave"] },
  { name: "uploads and auth", projects: ["uploads", "auth"] },
  { name: "renderer and runtime", projects: ["renderer", "runtime"] },
  { name: "publication and api", projects: ["publication", "api"] },
];

// The workflow pastes `args` into a shell command, so grep patterns are quoted.
const args = ({ projects, grep, invert, shard }) =>
  [
    ...projects.map((name) => `--project=${name}`),
    ...(grep ? [`--grep="${grep}"`] : []),
    ...(invert ? [`--grep-invert="${invert}"`] : []),
    ...(shard ? [`--shard=${shard}`] : []),
  ].join(" ");

export function ciMatrix() {
  return groups.map((group) => ({ name: group.name, args: args(group) }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const matrix = ciMatrix();
  console.log(JSON.stringify(matrix, null, 2));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `matrix=${JSON.stringify(matrix)}\n`,
    );
}
