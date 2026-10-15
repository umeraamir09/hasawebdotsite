import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const directory = process.argv[2] ?? ".wrangler/s2-production";
const requests = JSON.parse(
  await readFile(`${directory}/requests.json`, "utf8"),
);
const tail = JSON.parse(await readFile(`${directory}/tail.json`, "utf8"));
const deploy = await readFile(`${directory}/deploy.txt`, "utf8");
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return {
    count: sorted.length,
    min: sorted[0],
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}
const startupTimeMs = Number(
  deploy.match(/Worker Startup Time: ([\d.]+) ms/)?.[1],
);
assert.ok(Number.isFinite(startupTimeMs));
const groups = requests.results.map((result) => {
  const samples = tail.events.filter(
    (event) =>
      event.url && new URL(event.url).searchParams.get("case") === result.name,
  );
  const numeric = samples.filter((event) => typeof event.cpuTime === "number");
  const cpuMs = summary(numeric.map((event) => event.cpuTime));
  const complete = numeric.length === 100;
  return {
    ...result,
    cloudflareCpuMs: cpuMs,
    cloudflareWallMs: summary(
      samples
        .map((event) => event.wallTime)
        .filter((value) => typeof value === "number"),
    ),
    completeCpuSamples: complete,
    under10ms: complete && cpuMs.p95 < 10,
    outcomes: Object.fromEntries(
      [...new Set(samples.map((event) => event.outcome))].map((outcome) => [
        outcome,
        samples.filter((event) => event.outcome === outcome).length,
      ]),
    ),
  };
});
const report = {
  recordedAt: requests.recordedAt,
  origin: requests.origin,
  version: deploy.match(/Current Version ID: ([a-z0-9-]+)/)?.[1],
  startupTimeMs,
  startupPass: startupTimeMs < 1000,
  method:
    "Cloudflare real-time tail cpuTime/wallTime in milliseconds. Matched by case label on isolated Worker and controlled run interval. Warmups excluded. Nearest-rank p95 from 100 observations per case. Tail may sample; completeCpuSamples requires all 100 measured requests. Query run IDs are redacted by Cloudflare. Client elapsed timings remain separate.",
  firstCandidate: tail.events.filter(
    (event) =>
      event.url &&
      new URL(event.url).searchParams.get("case") === "first-candidate",
  ),
  groups,
  requestCpuPass: groups.every((group) => group.under10ms),
  clientFailure: requests.failure ?? null,
};
await writeFile(
  `${directory}/summary.json`,
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
