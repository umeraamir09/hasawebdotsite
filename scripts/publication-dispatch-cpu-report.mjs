import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareToken } from "./lib/cloudflare-token.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const [input, output, revision] = process.argv.slice(2);
assert.ok(
  input && output && revision,
  "Use: cpu-report.mjs native-results.json output.json tested-revision",
);
const state = JSON.parse(
  await readFile(join(root, ".wrangler/s8-provider/state.json"), "utf8"),
);
assert.equal(
  state.mode,
  "native",
  "Quota instrumentation is not native CPU evidence",
);
const require = createRequire(import.meta.url);
const token = await cloudflareToken(
  join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js"),
);
const report = JSON.parse(await readFile(input, "utf8"));
const query = `query($account:String!,$start:Time!,$end:Time!,$script:String!){viewer{accounts(filter:{accountTag:$account}){workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$start,datetime_leq:$end,scriptName:$script}){dimensions{scriptName status coloCode scriptVersion}sum{requests errors}quantiles{cpuTimeP50 cpuTimeP95 cpuTimeP99}}}}}`;
const runs = [];
for (const run of report.runs.filter(
  (run) =>
    Number.isFinite(run.inputBytes) && run.status === "ready" && run.finishedAt,
)) {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        account: state.account,
        start: run.startedAt,
        end: run.finishedAt,
        script: state.jobs,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json();
  assert.ok(response.ok && !body.errors, JSON.stringify(body.errors));
  const groups = body.data.viewer.accounts.flatMap(
    (account) => account.workersInvocationsAdaptive,
  );
  runs.push({
    kind: run.kind,
    candidateId: run.id,
    start: run.startedAt,
    end: run.finishedAt,
    expectedCheckpoints: run.dispatchCheckpoints,
    observedRequests: groups.reduce((n, row) => n + row.sum.requests, 0),
    groups,
  });
}
await writeFile(
  output,
  JSON.stringify(
    {
      revision,
      recordedAt: new Date().toISOString(),
      units:
        "GraphQL CPU quantiles are microseconds; divide by 1000 for milliseconds",
      method:
        "Native Queue Worker only. Per-candidate completion windows. Provider adaptive analytics can omit observations; compare expected and observed counts. Repeated execution does not label individual cold isolates. Do not average regional percentiles.",
      excludedIncompleteCandidates: report.runs
        .filter((run) => Number.isFinite(run.inputBytes) && !run.finishedAt)
        .map((run) => ({
          kind: run.kind,
          candidateId: run.id,
          start: run.startedAt,
        })),
      runs,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    runs.map((run) => ({
      kind: run.kind,
      expected: run.expectedCheckpoints,
      observed: run.observedRequests,
      groups: run.groups.map((row) => ({
        location: row.dimensions.coloCode,
        status: row.dimensions.status,
        p95Ms: row.quantiles.cpuTimeP95 / 1000,
        errors: row.sum.errors,
      })),
    })),
  ),
);
