import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const input = process.argv[2];
const output = process.argv[3];
assert.ok(
  input && output,
  "Use: node scripts/publication-dispatch-costs.mjs quota-results.json output.json",
);
const report = JSON.parse(await readFile(resolve(input), "utf8"));
const platformInventory = JSON.parse(
  await readFile(
    new URL(
      "../specs/2026-10-24-s8-dispatch-feasibility/evidence/platform-artifacts.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const platformBytes = platformInventory.artifacts.reduce(
  (n, item) => n + item.bytes,
  0,
);
const platformObjects = platformInventory.artifacts.length;
const fields = [
  "reads",
  "writes",
  "queries",
  "r2Reads",
  "r2Writes",
  "r2Lists",
  "r2Deletes",
  "queueWrites",
  "sourceCalls",
  "platformCalls",
  "sourceReads",
  "sourceWrites",
  "sourceQueries",
  "sourceR2Reads",
];
const zero = () => Object.fromEntries(fields.map((key) => [key, 0]));
function sum(rows) {
  const result = zero();
  for (const row of rows) {
    assert.ok(row, "Quota instrumentation must be enabled");
    for (const key of fields) {
      const value = row[key] ?? 0;
      assert.ok(
        Number.isFinite(value) && value >= 0,
        `Invalid counter: ${key}`,
      );
      result[key] += value;
    }
  }
  return result;
}
const budget = {
  requests: 100000,
  reads: 5000000,
  writes: 100000,
  queueOperations: 10000,
  r2ClassA: 1000000,
  r2ClassB: 10000000,
  d1Bytes: 500000000,
  r2Bytes: 10000000000,
};
// The old 52,400/68,000/1.5M model included a 2,000-write and
// 50,000-read non-save allowance. Replace those allowances, rather than
// counting them twice, with the explicit shared forecasts below.
const owner = { requests: 52400, reads: 1450000, writes: 66000 };
const shared = {
  requests: 3588,
  reads: 100000,
  writes: 6000,
  queueOperations: 2910,
  r2ClassA: 4800 + 288 * 4 * 2 * 30,
  r2ClassB: 1080000,
};
const publicationsPerDay = 30;
// One full static-library refresh per day is a conservative forecast. Retained
// hashed files are shared, rather than copied 100 times in the storage model.
shared.requests += platformObjects + Math.ceil(platformObjects / 4);
shared.queueOperations += 3 * Math.ceil(platformObjects / 4);
shared.r2ClassA += platformObjects * 30;
shared.r2ClassB += platformObjects * 30 * publicationsPerDay;
const cleanupRun = report.runs.find((run) => run.kind === "recovery-cleanup");
const fallbackCleanupRows = cleanupRun?.cleanup ?? [];
const observedSweeps = report.sweeps ?? [];
const sweepReadReserve =
  288 * Math.max(0, ...observedSweeps.map((row) => row.reads));
const sweepWriteReserve =
  288 * Math.max(0, ...observedSweeps.map((row) => row.writes));
shared.reads += sweepReadReserve;
shared.writes += sweepWriteReserve;
const scenarios = [];
for (const run of report.runs.filter((run) =>
  Number.isFinite(run.inputBytes),
)) {
  const cleanupRows = run.cleanup?.length ? run.cleanup : fallbackCleanupRows;
  const cleanup = sum(cleanupRows);
  const steps = run.invocations;
  assert.ok(steps?.length, "Use a quota-instrumented completion report");
  const totals = sum([run.creation, ...steps]);
  assert.ok(
    totals.sourceCalls === totals.sourceR2Reads,
    "Private-source R2 counters are missing or transfers were rejected",
  );
  assert.ok(
    totals.sourceCalls === 0 || totals.sourceQueries > 0,
    "Private-source D1 counters are missing",
  );
  const combined = steps.map((row) => ({
    reads: row.reads + row.sourceReads,
    writes: row.writes + row.sourceWrites,
    requests: 1 + row.sourceCalls,
    queueOperations: 3 * Math.max(1, row.queueWrites),
    r2ClassA: row.r2Writes + row.r2Lists,
    r2ClassB: row.r2Reads + row.sourceR2Reads,
  }));
  const per = {
    requests: 2 + steps.length + totals.sourceCalls,
    reads: totals.reads + totals.sourceReads,
    writes: totals.writes + totals.sourceWrites,
    queueOperations:
      3 * (1 + steps.reduce((total, row) => total + row.queueWrites, 0)),
    r2ClassA: totals.r2Writes + totals.r2Lists,
    r2ClassB: totals.r2Reads + totals.sourceR2Reads,
  };
  const measuredPerPublication = { ...per };
  const pollingCalls = Math.max(
    60,
    Math.ceil((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 5000),
  );
  const snapshotBytes = run.privateWorkingState?.sourceBytes ?? run.inputBytes;
  const snapshotParts = Math.ceil(snapshotBytes / 131072);
  let snapshotAssembly = 0,
    parts = snapshotParts;
  while (parts > 1) {
    parts = Math.ceil(parts / 16);
    snapshotAssembly += parts;
  }
  const pageCount = run.pages?.length ?? 1;
  const manifestBytes =
    4096 + (run.assets?.length ?? 0) * 768 + pageCount * 256;
  const manifestParts = Math.ceil(manifestBytes / 16384);
  const fixedFileParts = Math.ceil((4096 + pageCount * 256) / 16384);
  const deliveryTasks =
    snapshotParts +
    snapshotAssembly +
    pageCount +
    manifestParts +
    fixedFileParts +
    1;
  const deliveryForecast = {
    snapshotBytes,
    snapshotChunkBytes: 131072,
    snapshotParts,
    snapshotAssembly,
    shellCopies: pageCount,
    manifestBytes,
    manifestParts,
    fixedFileParts,
    generatedStyleTasks: 1,
    totalTasks: deliveryTasks,
    note: "Unimplemented bounded delivery forecast. Includes snapshot.json, complete document shells, manifest, 404/robots/sitemap and generated style retention. Exact CPU, packing and counters require future implementation. Does not assert one whole-document parse fits a Worker.",
  };
  const publicationForecast = {
    requests: 2 * pollingCalls + deliveryTasks,
    reads:
      10 * pollingCalls + deliveryTasks * 6 + snapshotParts + manifestParts * 4,
    writes: deliveryTasks * 4 + 3,
    queueOperations: deliveryTasks * 3,
    r2ClassA:
      snapshotParts +
      snapshotAssembly +
      pageCount +
      manifestParts +
      3 * fixedFileParts +
      1,
    r2ClassB: 2 * (snapshotParts + snapshotAssembly - 1) + pageCount + 1,
  };
  if (run.manifest) {
    for (const key of Object.keys(publicationForecast))
      publicationForecast[key] = 0;
    publicationForecast.requests = 2 * pollingCalls;
    publicationForecast.reads = 10 * pollingCalls;
    publicationForecast.writes = 3;
    deliveryForecast.totalTasks = 0;
    deliveryForecast.note =
      "Phase 24 complete delivery is included in observed counters. Only later owner polling and commit accounting are forecast separately; no duplicate delivery reserve is added.";
  }
  for (const key of Object.keys(per)) per[key] += publicationForecast[key];
  const futureWake = {
    requests: 1,
    reads: 10,
    writes: 4,
    queueOperations: 3,
    r2ClassA: 3,
    r2ClassB: 32,
  };
  const replayCosts = [
    ...combined,
    ...Array.from({ length: deliveryForecast.totalTasks }, () => futureWake),
  ];
  const replayBatches = Math.ceil(replayCosts.length * 0.1);
  const replay = {};
  for (const key of Object.keys(per))
    replay[key] = replayCosts
      .map((row) => row[key])
      .sort((a, b) => b - a)
      .slice(0, replayBatches)
      .reduce((total, value) => total + value, 0);
  const replayWithReplacementUpper = Object.fromEntries(
    Object.keys(per).map((key) => [
      key,
      replayBatches * Math.max(...replayCosts.map((row) => row[key])),
    ]),
  );
  const cleanupBatches = run.cleanup?.length
    ? cleanupRows.length
    : Math.max(cleanupRows.length, Math.ceil(totals.r2Writes / 16) + 1);
  const extraCleanup = cleanupBatches - cleanupRows.length;
  const cleanupCost = {
    requests: cleanupBatches + cleanup.sourceCalls,
    reads:
      cleanup.reads +
      cleanup.sourceReads +
      extraCleanup * Math.max(0, ...cleanupRows.map((row) => row.reads)),
    writes:
      cleanup.writes +
      cleanup.sourceWrites +
      extraCleanup * Math.max(0, ...cleanupRows.map((row) => row.writes)),
    queueOperations:
      3 * (cleanupBatches ? 1 + cleanup.queueWrites + extraCleanup : 0),
    r2ClassA: cleanup.r2Writes + cleanup.r2Lists + 2 * extraCleanup,
    r2ClassB: cleanup.r2Reads + cleanup.sourceR2Reads,
  };
  const failed = {};
  for (const key of Object.keys(per))
    failed[key] =
      per[key] +
      cleanupCost[key] +
      4 * Math.max(...replayCosts.map((row) => row[key]));
  const projected = {};
  for (const key of ["requests", "reads", "writes", "queueOperations"])
    projected[key] =
      (owner[key] ?? 0) +
      shared[key] +
      publicationsPerDay * (per[key] + replay[key] + cleanupCost[key]) +
      failed[key];
  for (const key of ["r2ClassA", "r2ClassB"])
    projected[key] =
      shared[key] +
      30 *
        (publicationsPerDay * (per[key] + replay[key] + cleanupCost[key]) +
          failed[key]);
  const maxParentCalls = Math.max(
    ...steps.map(
      (row) =>
        row.queries +
        row.r2Reads +
        row.r2Writes +
        row.r2Lists +
        row.r2Deletes +
        row.queueWrites +
        row.sourceCalls +
        (row.platformCalls ?? 0),
    ),
  );
  const maxParentQueries = Math.max(
    run.creation.queries,
    ...steps.map((row) => row.queries),
  );
  const exceeded = Object.keys(projected).filter(
    (key) => projected[key] > budget[key],
  );
  scenarios.push({
    kind: run.kind,
    inputBytes: run.inputBytes,
    pages: run.pages?.length ?? 1,
    completedBatches: steps.length,
    measuredPerPublication,
    publicationForecast,
    deliveryForecast,
    pollingCalls,
    perPublication: per,
    replayBatches,
    futureWakeReplayForecast: futureWake,
    replayReserve: replay,
    replayWithReplacementUpper,
    cleanup: cleanupCost,
    failedCandidate: failed,
    projected,
    remaining: Object.fromEntries(
      Object.entries(projected).map(([key, value]) => [
        key,
        budget[key] - value,
      ]),
    ),
    maxParentCalls,
    maxParentQueries,
    sourceQueries: Math.max(0, ...steps.map((row) => row.sourceQueries)),
    externalSubrequests: 0,
    simultaneousStorageStreams: 2,
    retained: run.retained ?? null,
    storageForecast:
      run.privateAssetInventory && run.retained
        ? {
            privateBytesPerPortfolio: run.privateAssetInventory.bytes,
            finalHtmlBytesPerPortfolio: (run.pages ?? []).reduce(
              (n, page) => n + page.bytes,
              0,
            ),
            publicAssetBytesPerPortfolio: run.retained.assets.bytes,
            platformBytesSharedOnce: platformBytes,
            additionalSnapshotAndStyleBytesPerPortfolio:
              snapshotBytes + 16384 + 4096,
            steadyAt100Portfolios:
              100 *
              (run.privateAssetInventory.bytes +
                run.retained.assets.bytes +
                (run.pages ?? []).reduce((n, page) => n + page.bytes, 0)),
            candidateTemporaryPeakAtFourSources:
              4 * (run.retained.sites.bytes + run.retained.assets.bytes),
            totalWithDeliveryAndFourCandidatePeaksAndOneDayOrphans:
              platformBytes +
              100 *
                (run.privateAssetInventory.bytes +
                  run.retained.assets.bytes +
                  (run.pages ?? []).reduce((n, page) => n + page.bytes, 0) +
                  snapshotBytes +
                  16384 +
                  4096) +
              4 * (run.retained.sites.bytes + run.retained.assets.bytes) +
              60 * 5242880,
            oneDayOfSixtyMaximumImageOrphans: 60 * 5242880,
            note: "Storage forecast uses measured object inventories. Retained public output, orphan collection and a 24-hour orphan window are future assumptions, not a measured collector. Separate private and public copies can fail the shared storage allowance.",
          }
        : null,
    privateWorkingState: run.privateWorkingState ?? null,
    retryStorm: Object.fromEntries(
      [1, 3, 10].map((replays) => [
        replays,
        Object.fromEntries(
          Object.keys(per).map((key) => [key, replays * per[key]]),
        ),
      ]),
    ),
    exceeded,
    publicationCapacity: Object.fromEntries(
      ["requests", "reads", "writes", "queueOperations"].map((key) => [
        key,
        Math.max(
          0,
          Math.floor(
            (budget[key] - (owner[key] ?? 0) - shared[key] - failed[key]) /
              (per[key] + replay[key] + cleanupCost[key]),
          ),
        ),
      ]),
    ),
  });
  const scenario = scenarios[scenarios.length - 1];
  if (scenario.storageForecast) {
    scenario.storageRemaining = {
      steady: budget.r2Bytes - scenario.storageForecast.steadyAt100Portfolios,
      withDeliveryAndRetentionForecast:
        budget.r2Bytes -
        scenario.storageForecast
          .totalWithDeliveryAndFourCandidatePeaksAndOneDayOrphans,
    };
    if (scenario.storageRemaining.steady < 0)
      scenario.exceeded.push("r2StorageSteadyProjection");
    if (scenario.storageRemaining.withDeliveryAndRetentionForecast < 0)
      scenario.exceeded.push("r2StorageWithRetentionForecast");
  }
}
assert.ok(scenarios.length);
const result = {
  recordedAt: new Date().toISOString(),
  input: resolve(input),
  budget,
  owner,
  shared,
  measuredSweepReserve: {
    invocationsPerDay: 288,
    reads: sweepReadReserve,
    writes: sweepWriteReserve,
    samples: observedSweeps.length,
    requestsAlreadyInShared: true,
    r2ListsAlreadyInShared: true,
  },
  publicationsPerDay,
  method:
    "Observed counters plus explicit workload forecasts. Daily and monthly units remain separate. Each ordinary wake uses three Queue operations. Replay allowances cover one extra complete wake for the most expensive distinct 10% of logical batches per resource; the failed-candidate allowance includes full work, cleanup and four maximum-cost extra invocations.",
  assumptions: [
    "100 portfolios, 30 editing sessions, 30 publishes per day, 50 views per portfolio, 50 GitHub-enabled portfolios.",
    "GitHub: 200 visit refreshes and 50 private daily sweeps, with three extra Queue reads per message in the retry scenario.",
    "Contact: 90 accepted messages with all five delivery attempts; ten verification/notice jobs with three extra reads each.",
    "Shared request forecast adds 2500 graph requests, 250 GitHub jobs, 450 contact attempts, ten notice jobs, 90 submissions and 288 shared sweeps.",
    "Shared R2 forecast assumes 60 uploads and 100 orphan-list calls daily, plus 36000 reads daily with no public edge-cache savings. Add the bounded maximum four two-bucket tombstone checks per five-minute sweep.",
    "The future contact/GitHub handlers retain a separate forecast of 100000 reads and 6000 writes daily. Measured worst-case S-8 sweeper D1 work is reserved additionally for all 288 daily shared sweeps; their Worker requests and maximum eight R2 lists per sweep are already counted in shared forecasts.",
    "Ten percent replay selects distinct logical batches once, including forecast delivery tasks. Each future task has a conservative replay envelope of one wake, ten reads, four writes, three R2 Class A calls and 32 R2 Class B calls for bounded sixteen-input head/read assembly. The previous repeated-maximum-with-replacement upper bound is retained separately; repeated storms also have explicit one/three/ten full-publication replay forecasts.",
    "The publication start request conservatively counts both web and jobs. Provider fixture seeding and control polling are excluded from measured counters.",
    "Publication forecast keeps owner polling every five seconds for at least five minutes, two Workers and ten D1 reads per poll. Historical scaffold inputs separately reserve bounded snapshot/manifest/document delivery. Inputs containing a Phase 24 manifest already measure that work and do not add a duplicate delivery reserve. Each future task reserves six reads, four writes and one complete Queue wake. These are forecasts, not implemented CPU proof.",
    "Existing art/style/font hashes have a measured inventory. The model conservatively reserves one complete static-library refresh daily plus per-publication existence reads; those bytes are retained once globally in the storage forecast.",
  ],
  storage: {
    platformInventory: {
      objects: platformObjects,
      bytes: platformBytes,
      method:
        "Static artifact inventory; forecast retention is shared globally",
    },
    d1ExistingMeasuredLocalAllocation: 426217472,
    d1RemainingBeforeCandidates: budget.d1Bytes - 426217472,
    sourceAdmissionLimit: 4,
    pendingCandidateAdmissionLimit: 128,
    sourcePayloadOnlyAtFourCandidates:
      Math.max(
        0,
        ...report.runs.map((run) => run.privateWorkingState?.sourceBytes ?? 0),
      ) * 4,
    model:
      "Baseline is the historical local page-allocation measurement, not current production usage. Candidate payload is a lower bound; row/index pages, transfer/page receipts and retained tombstones add storage. Admission bounds sources to four and pending candidates to 128. Referenced retained versions release their slots and require separate storage capacity accounting. Deleting references restores cleanup tickets, which can temporarily exceed 128 and block new admission. Unreferenced ready sources expire after one hour. Cleaned rows physically retire after at least 24 hours and confirmed absence; failed output cleanup keeps a scrubbed ticket until explicit retry. Measured allocation/churn remains a separate provider check.",
    r2MaximumAssetForecast: {
      portfolios: 100,
      privateBytesPerPortfolio: 30 * 1024 * 1024,
      publicBytesPerVersion: 25 * 1024 * 1024,
      withOneVersion: 100 * 55 * 1024 * 1024,
      withTwoVersions: 100 * 80 * 1024 * 1024,
      withThreeVersions: 100 * 105 * 1024 * 1024,
      sixtyMaximumImageReplacementsPerDayForThirtyDays: 60 * 5242880 * 30,
      caveat:
        "Asset-only forecast excludes HTML/assembly copies, additional project/case images, platform assets and fragmentation. Measured object inventories accompany cases when present. Replaced private assets must be collected while protecting active sealed sources.",
    },
    tombstoneSweepUpperForecastPerMonth: { r2Lists: 288 * 4 * 2 * 30 },
  },
  scenarios,
  limitations: [
    "No CPU verdict follows from operation counters. Native warm/cold provider evidence is a separate gate.",
    "Future shared-job estimates are forecasts, not measurements of unimplemented consumers.",
    "Storage requires separate measured allocation, inventory, retention and cleanup assumptions; operation headroom alone cannot establish storage feasibility.",
    ...(fallbackCleanupRows.length
      ? []
      : [
          "Cleanup evidence is missing; this ledger cannot approve the prerequisite.",
        ]),
  ],
  verified: false,
};
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(resolve(output), `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify(
    scenarios.map((row) => ({
      kind: row.kind,
      batches: row.completedBatches,
      queueOperations: row.projected.queueOperations,
      exceeded: row.exceeded,
    })),
  ),
);
