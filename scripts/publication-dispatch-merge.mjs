import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const [providerPath, tailPath, localPath, outputPath] = process.argv.slice(2);
assert.ok(
  outputPath,
  "Use: publication-dispatch-merge.mjs provider.json tail.json local.json output.json",
);
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const [report, tail, local] = await Promise.all([
  read(providerPath),
  read(tailPath),
  read(localPath),
]);
for (const run of report.runs) {
  if (!Number.isFinite(run.inputBytes)) continue;
  const events = tail.events.filter((event) =>
    event.quota?.some((row) => row.candidateId === run.id),
  );
  run.invocations = events.flatMap((event) =>
    event.quota
      .filter((row) => row.candidateId === run.id)
      .map((row) => row.counts),
  );
  assert.ok(
    run.invocations.length >= run.dispatchCheckpoints,
    `Incomplete tail for ${run.kind}: ${run.invocations.length}/${run.dispatchCheckpoints}`,
  );
  assert.ok(
    run.invocations.every(
      (row) =>
        Number.isFinite(row.r2Reads) && Number.isFinite(row.sourceR2Reads),
    ),
    "R2 counters missing",
  );
  run.quotaMethod =
    "Provider D1 meta and instrumented Queue/R2 calls, including named private source";
}
const cleanup = local.runs.find((run) => run.kind === "recovery-cleanup");
assert.ok(cleanup?.cleanup.length, "Local cleanup evidence required");
report.runs.push(cleanup);
report.quotaSources = { providerPath, tailPath, localCleanupPath: localPath };
report.limitations.push(
  "Cleanup counters are local workerd observations; provider ordinary-batch counters are separate from native CPU measurements.",
);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    report.runs.map((run) => ({
      kind: run.kind,
      invocations: run.invocations.length,
    })),
  ),
);
