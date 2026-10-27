import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const [providerPath, tailPath, localPath, outputPath, ...inventoryPaths] =
  process.argv.slice(2);
assert.ok(
  outputPath,
  "Use: publication-dispatch-merge.mjs provider.json tail.json local.json output.json [inventory.json ...]",
);
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const [report, tail, local] = await Promise.all([
  read(providerPath),
  read(tailPath),
  read(localPath),
]);
for (const run of report.runs) {
  if (!Number.isFinite(run.inputBytes)) continue;
  assert.equal(
    run.status,
    "ready",
    "Only complete candidates may enter the ledger",
  );
  assert.ok(run.finishedAt && run.cleanupStartedAt && run.cleanupFinishedAt);
  const events = tail.events.filter(
    (event) =>
      event.quota?.some((row) => row.candidateId === run.id) &&
      (!event.at || event.at <= Date.parse(run.finishedAt)),
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
  run.cleanup = tail.events
    .filter(
      (event) =>
        event.quota?.some((row) => row.candidateId === run.id) &&
        event.at >= Date.parse(run.cleanupStartedAt),
    )
    .flatMap((event) =>
      event.quota
        .filter((row) => row.candidateId === run.id)
        .map((row) => row.counts),
    );
  assert.ok(
    run.cleanup.length,
    `Deployed cleanup tail missing for ${run.kind}`,
  );
  run.quotaMethod =
    "Provider D1 meta and instrumented Queue/R2 calls, including named private source";
}
const inventories = [local, ...(await Promise.all(inventoryPaths.map(read)))];
for (const run of report.runs.filter((row) =>
  Number.isFinite(row.inputBytes),
)) {
  const inventory = inventories
    .flatMap((entry) => entry.runs)
    .find(
      (entry) =>
        entry.kind === run.kind &&
        entry.inputBytes === run.inputBytes &&
        entry.privateAssetInventory &&
        entry.retained &&
        JSON.stringify(entry.assets.map((asset) => asset.asset_id).sort()) ===
          JSON.stringify(run.assets.map((asset) => asset.asset_id).sort()),
    );
  assert.ok(inventory, `Full-size storage inventory required for ${run.kind}`);
  const pageSizes = (entry) =>
    entry.pages.map(({ path, bytes }) => ({ path, bytes }));
  assert.deepEqual(
    pageSizes(inventory),
    pageSizes(run),
    "Storage pages differ",
  );
  assert.deepEqual(inventory.retained.sites, run.retained.sites);
  assert.equal(inventory.retained.assets.objects, run.retained.assets.objects);
  assert.equal(
    inventory.retained.assets.bytes,
    inventory.assets.reduce((total, asset) => total + asset.bytes, 0),
  );
  run.providerTransferInventory = {
    assets: run.assets,
    privateAssetInventory: run.privateAssetInventory,
    retained: run.retained,
  };
  run.privateAssetInventory = inventory.privateAssetInventory;
  run.retained = inventory.retained;
  run.storageInventoryMethod =
    "Full-size local inventory matched by fixture kind, input bytes, page paths/byte lengths, site inventory and asset IDs/counts. Both reports independently verified exact output against the full renderer. Their hashes differ because URLs contain different candidate UUIDs. Provider transfer counts use the separately retained 128-byte binary inventory.";
}
report.sweeps = inventories.flatMap((entry) => entry.sweeps ?? []);
assert.ok(report.sweeps.length, "Measured sweep reserve required");
const cleanup = local.runs.find((run) => run.kind === "recovery-cleanup");
assert.ok(cleanup?.cleanup.length, "Local cleanup evidence required");
report.runs.push(cleanup);
report.providerOutcomes = tail.events.reduce((counts, event) => {
  const outcome = event.outcome ?? "unknown";
  counts[outcome] = (counts[outcome] ?? 0) + 1;
  return counts;
}, {});
report.quotaSources = {
  providerPath,
  tailPath,
  localCleanupPath: localPath,
  localInventoryPaths: [localPath, ...inventoryPaths],
};
report.limitations.push(
  "Per-case cleanup counters are deployed observations. Recovery and sweep reserves and full-size storage inventories are local workerd observations; provider ordinary-batch counters are separate from native CPU measurements.",
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
