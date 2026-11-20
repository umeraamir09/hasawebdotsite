// The CI e2e plan. Writes `matrix=<json>` for the workflow.
//
//   node scripts/ci-plan.mjs
//
// Every code change runs every e2e project, split into seven parallel
// one-worker jobs.
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const groups = [
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

export function ciMatrix() {
  return groups.map((group) => ({
    name: group.name,
    args: args(group.projects, group.shard),
  }));
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
