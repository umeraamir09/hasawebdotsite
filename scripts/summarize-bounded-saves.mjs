import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const directory = "specs/2026-10-16-free-owner-saves";
const json = async (path) =>
  JSON.parse(await readFile(`${directory}/${path}`, "utf8"));
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const runs = [];
for (const name of ["bounded", "final", "operations"]) {
  const requests = await json(`${name}/deployed-requests.json`);
  assert.equal(requests.completed, true);
  const cases = [];
  for (const worker of ["jobs", "web"]) {
    const data = await json(`${name}/analytics-${worker}.json`);
    assert.ok(!data.result.errors?.length);
    for (const [index, window] of data.windows.entries()) {
      const rows = data.result.data.viewer.accounts[0][`c${index}`];
      assert.ok(
        rows.length > 0,
        `${name}/${worker}/${window.case} has no telemetry`,
      );
      for (const row of rows) {
        cases.push({
          worker,
          case: window.case,
          colo: row.dimensions.coloCode,
          status: row.dimensions.status,
          clientCount: window.clientCount,
          adaptiveCount: row.sum.requests,
          sampleInterval: row.avg.sampleInterval,
          errors: row.sum.errors,
          p50Ms: row.quantiles.cpuTimeP50 / 1000,
          p95Ms: row.quantiles.cpuTimeP95 / 1000,
          p99Ms: row.quantiles.cpuTimeP99 / 1000,
        });
      }
    }
  }
  runs.push({
    name,
    correctnessGroups: requests.checks.length,
    clientResponses: requests.samples.length,
    cases,
  });
}
const tails = [];
for (const worker of ["jobs", "web"]) {
  const data = await json(`final/tail-${worker}.json`);
  const events = data.events.filter((event) =>
    event.url?.includes("/api/owner/bounded/"),
  );
  const names = [
    ...new Set(
      events.map((event) => new URL(event.url).searchParams.get("case")),
    ),
  ];
  const cases = names
    .filter((name) => name !== "check" && !name.startsWith("warmup-"))
    .map((name) => {
      const rows = events.filter(
        (event) => new URL(event.url).searchParams.get("case") === name,
      );
      const cpu = rows
        .map((row) => row.cpuTime)
        .filter((value) => typeof value === "number");
      return {
        case: name,
        count: rows.length,
        p95Ms: percentile(cpu, 0.95),
        p99Ms: percentile(cpu, 0.99),
        maxMs: Math.max(...cpu),
      };
    });
  const failures = events.filter((event) => event.outcome !== "ok");
  tails.push({
    worker,
    count: events.length,
    firstEvents: events.slice(0, 4),
    firstSuccessfulMutation: events.find(
      (event) => event.status === 200 && event.url.includes("/patch?"),
    ),
    failures,
    cases,
  });
}
const startup = {};
for (const worker of ["jobs", "web"]) {
  const text = await readFile(
    `${directory}/final/deploy-${worker}.txt`,
    "utf8",
  );
  startup[worker] = Number(text.match(/Worker Startup Time: (\d+) ms/)[1]);
}
const operationsDeploy = await readFile(
  `${directory}/operations/deploy-jobs.txt`,
  "utf8",
);
startup.operationsJobs = Number(
  operationsDeploy.match(/Worker Startup Time: (\d+) ms/)[1],
);
const all = runs.flatMap((run) => run.cases);
const passed =
  all.every(
    (row) => row.p95Ms < 10 && row.errors === 0 && row.status === "success",
  ) &&
  Object.values(startup).every((ms) => ms < 1000) &&
  tails.every((tail) => tail.failures.length === 0);
const report = {
  recordedAt: new Date().toISOString(),
  passedWarmTarget: passed,
  target:
    "Provider warm per-class p95 <10 ms per Worker; startup <1,000 ms. This is not an all-invocation/cold guarantee or an overall application quota claim.",
  maximumMeasuredWarmP95Ms: Math.max(...all.map((row) => row.p95Ms)),
  startupMs: startup,
  runs,
  finalTails: tails,
  storage: await json("bounded/storage-capacity.json"),
  limitations:
    "Adaptive provider quantiles use client-time windows and approximate counts. Tail CPU is coarsely rounded and may sample. First trace candidates are not verified isolate-cold requests. Keyed benchmark preparation is included in measured CPU for begin, commit, string-start, string-finish, abort and cleanup. Client elapsed is never used as CPU.",
};
await writeFile(
  `${directory}/summary.json`,
  `${JSON.stringify(report, null, 2)}\n`,
);
for (const run of runs)
  for (const row of run.cases.filter((row) => row.worker === "jobs"))
    console.log(
      `${run.name} ${row.case}: p95 ${row.p95Ms} ms; p99 ${row.p99Ms} ms; adaptive ${row.adaptiveCount}/${row.clientCount}; errors ${row.errors}`,
    );
console.log(
  JSON.stringify({
    passedWarmTarget: passed,
    maximumMeasuredWarmP95Ms: report.maximumMeasuredWarmP95Ms,
    startupMs: startup,
  }),
);
assert.ok(
  passed,
  "One or more measured warm CPU/startup/outcome checks failed",
);
