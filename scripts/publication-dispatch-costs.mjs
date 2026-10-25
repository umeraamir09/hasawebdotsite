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
const cleanupRun = report.runs.find((run) => run.kind === "recovery-cleanup");
const cleanupRows = cleanupRun?.cleanup ?? [];
const cleanup = sum(cleanupRows);
const scenarios = [];
for (const run of report.runs.filter((run) =>
  Number.isFinite(run.inputBytes),
)) {
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
  const publicationForecast = {
    requests: 2 * pollingCalls + 2,
    reads: 10 * pollingCalls + 4,
    writes: 3,
    queueOperations: 6,
    r2ClassA: 2,
    r2ClassB: 2,
  };
  for (const key of Object.keys(per)) per[key] += publicationForecast[key];
  const replayBatches = Math.ceil(steps.length * 0.1);
  const replay = {};
  for (const key of Object.keys(per))
    replay[key] = replayBatches * Math.max(...combined.map((row) => row[key]));
  const cleanupBatches = Math.max(
    cleanupRows.length,
    Math.ceil(totals.r2Writes / 16) + 1,
  );
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
      4 * Math.max(...combined.map((row) => row[key]));
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
        row.sourceCalls,
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
    pollingCalls,
    perPublication: per,
    replayBatches,
    replayReserve: replay,
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
}
assert.ok(scenarios.length);
const result = {
  recordedAt: new Date().toISOString(),
  input: resolve(input),
  budget,
  owner,
  shared,
  publicationsPerDay,
  method:
    "Observed counters plus explicit workload forecasts. Daily and monthly units remain separate. Each ordinary wake uses three Queue operations. Replay allowances conservatively include an extra complete wake; the failed-candidate allowance includes full work, cleanup and four maximum-cost extra invocations.",
  assumptions: [
    "100 portfolios, 30 editing sessions, 30 publishes per day, 50 views per portfolio, 50 GitHub-enabled portfolios.",
    "GitHub: 200 visit refreshes and 50 private daily sweeps, with three extra Queue reads per message in the retry scenario.",
    "Contact: 90 accepted messages with all five delivery attempts; ten verification/notice jobs with three extra reads each.",
    "Shared request forecast adds 2500 graph requests, 250 GitHub jobs, 450 contact attempts, ten notice jobs, 90 submissions and 288 shared sweeps.",
    "Shared R2 forecast assumes 60 uploads and 100 orphan-list calls daily, plus 36000 reads daily with no public edge-cache savings. Add the bounded maximum four two-bucket tombstone checks per five-minute sweep.",
    "The future contact/GitHub handlers must validate the reserved shared D1 allowance of 100000 reads and 6000 writes daily.",
    "The publication start request conservatively counts both web and jobs. Provider fixture seeding and control polling are excluded from measured counters.",
    "Publication forecast adds owner polling every five seconds for at least five minutes, conservatively two Worker requests and ten D1 reads per poll, plus two snapshot/manifest invocations, six Queue operations, four reads, three writes and two R2 reads/writes. These later-phase operations are unimplemented and require measurement.",
  ],
  storage: {
    d1ExistingMeasuredLocalAllocation: 426217472,
    d1RemainingBeforeCandidates: budget.d1Bytes - 426217472,
    sourcePayloadOnlyAt100Candidates:
      Math.max(
        0,
        ...report.runs.map((run) => run.privateWorkingState?.sourceBytes ?? 0),
      ) * 100,
    model:
      "Baseline is the historical local page-allocation measurement, not current production usage. Candidate payload is a lower bound; row/index pages, transfer/page receipts and retained tombstones add storage. Admission and physical retention are not yet bounded.",
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
    ...(cleanupRows.length
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
