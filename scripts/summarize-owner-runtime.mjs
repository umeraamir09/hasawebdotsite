import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(
  new URL("../specs/2026-10-16-owner-api-runtime/", import.meta.url),
);
const read = async (name) =>
  JSON.parse(await readFile(join(directory, name), "utf8"));
const requests = await read("deployed-requests.json");
const recovery = await read("deployed-recovery.json");
const local = await read("local-results.json");
assert.ok(local.completed);
const tails = {
  jobs: await read("tail-jobs.json"),
  web: await read("tail-web.json"),
};
const cases = [];
function quantile(values, p) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * p) - 1] ?? null;
}
for (const [report, prefix] of [
  [requests, "analytics"],
  [recovery, "recovery-analytics"],
]) {
  const analytics = {
    jobs: await read(`${prefix}-jobs.json`),
    web: await read(`${prefix}-web.json`),
  };
  for (const name of [
    ...new Set(report.samples.map((sample) => sample.case)),
  ].filter(
    (name) =>
      !name.startsWith("warmup-") &&
      !["first-candidate", "check"].includes(name),
  )) {
    const samples = report.samples.filter((sample) => sample.case === name);
    const cpu = {};
    for (const worker of ["jobs", "web"]) {
      const data = analytics[worker];
      const index = data.windows.findIndex((window) => window.case === name);
      const rows = data.result.data.viewer.accounts[0][`c${index}`];
      cpu[worker] = rows.map((row) => ({
        colo: row.dimensions.coloCode,
        status: row.dimensions.status,
        requests: row.sum.requests,
        errors: row.sum.errors,
        sampleInterval: row.avg.sampleInterval,
        p50Ms: row.quantiles.cpuTimeP50 / 1000,
        p95Ms: row.quantiles.cpuTimeP95 / 1000,
        p99Ms: row.quantiles.cpuTimeP99 / 1000,
      }));
    }
    cases.push({
      name,
      reportCompleted: report.completed,
      clientCount: samples.length,
      failures: samples.filter((sample) => ![200, 401].includes(sample.status))
        .length,
      elapsedP50Ms: quantile(
        samples.map((sample) => sample.elapsedMs),
        0.5,
      ),
      elapsedP95Ms: quantile(
        samples.map((sample) => sample.elapsedMs),
        0.95,
      ),
      cpu,
    });
  }
}
const firstCandidates = tails.jobs.events.filter(
  (event) => new URL(event.url).searchParams.get("case") === "first-candidate",
);
const exceeded = tails.jobs.events.filter((event) => event.outcome !== "ok");
const startup = {};
for (const worker of ["jobs", "web"]) {
  const log = await readFile(join(directory, `deploy-${worker}.txt`), "utf8");
  startup[worker] = Number(log.match(/Worker Startup Time: (\d+) ms/)[1]);
}
const result = {
  recordedAt: new Date().toISOString(),
  decision:
    "Full-body validation/save rejected under the strict below-10-ms target. Bounded-save revision proposed; owner agreement and completion approval pending.",
  method:
    "Provider adaptive CPU quantiles per client-time workload window. Counts, sampling and clock/window boundaries differ from client responses. CPU is not client elapsed; quantiles across Workers are not additive. Tail retention is incomplete. First candidates are not guaranteed isolate-cold. The failed large-save distribution has fewer than 100 requests.",
  startupMs: startup,
  localChecks: local.checks,
  deployedChecks: requests.checks,
  recoveryChecks: recovery.checks,
  cases,
  firstCandidates,
  exceeded,
  tailRetained: Object.fromEntries(
    Object.entries(tails).map(([name, data]) => [name, data.events.length]),
  ),
  versions: Object.fromEntries(
    Object.entries(tails).map(([name, data]) => [
      name,
      [...new Set(data.events.map((event) => event.version))],
    ]),
  ),
};
await writeFile(
  join(directory, "summary.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    startup,
    cases: cases.map((row) => ({
      name: row.name,
      count: row.clientCount,
      failures: row.failures,
      jobsCpu: row.cpu.jobs,
      webCpu: row.cpu.web,
    })),
    exceeded,
  }),
);
