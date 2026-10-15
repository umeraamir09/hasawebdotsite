import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const account = "b6f9a87e6702c76c45a8d61744826e0f";
const saved = await readFile(
  join(
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone operator script outside Turbo tasks
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    ".wrangler/config/default.toml",
  ),
  "utf8",
);
const token = saved.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
assert.ok(token, "Run wrangler whoami first");
const name = "hasaweb-s8-spike";
const runId = Date.now().toString(36);
const candidateIds = [`live-a-${runId}`, `live-b-${runId}`];
const siteId = `race-${runId}`;
const reuseFixtures = process.argv.includes("--reuse-fixtures");
const small = process.argv.includes("--small");
const output = join(root, ".wrangler/workflow-live");
await mkdir(output, { recursive: true });
const report = {
  recordedAt: new Date().toISOString(),
  worker: name,
  mode: small ? "small-completion" : "near-limit-stress",
  statuses: [],
  siteId,
  limitations: [
    "Provider status is not a per-step CPU trace",
    small
      ? "Shortened three-fragment pages do not prove worst-case CPU or quota headroom"
      : "Synthetic near-limit input for each page overstates the total portfolio draft limit",
    "No paid-plan upgrade or production route changes",
  ],
};
async function raw(path, init = {}) {
  return fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.timeout(30000),
    },
  );
}
async function api(path, method = "GET", body) {
  const response = await raw(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  assert.ok(
    response.ok && data.success,
    `${method} ${path}: ${JSON.stringify(data.errors)}`,
  );
  return data.result;
}
try {
  const databases = await api("/d1/database");
  let db = databases.find((database) => database.name === name);
  if (!db) db = await api("/d1/database", "POST", { name });
  report.database = db.uuid;
  const buckets = await api("/r2/buckets");
  if (!buckets.buckets.some((bucket) => bucket.name === name))
    await api("/r2/buckets", "POST", { name });
  report.bucket = name;
  const config = join(output, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name,
      account_id: account,
      main: join(root, "packages/render/workflow-spike/worker.ts"),
      compatibility_date: "2026-10-14",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      preview_urls: false,
      vars: { APP_ENV: "local" },
      d1_databases: [
        { binding: "DB", database_name: name, database_id: db.uuid },
      ],
      r2_buckets: [{ binding: "BUCKET", bucket_name: name }],
      workflows: [{ binding: "FLOW", name, class_name: "PublishSpike" }],
    }),
  );
  const deployment = spawnSync(
    process.execPath,
    [
      join(
        dirname(require.resolve("wrangler/package.json")),
        "bin/wrangler.js",
      ),
      "deploy",
      "-c",
      config,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      timeout: 120000,
    },
  );
  await writeFile(
    join(output, "deploy.txt"),
    deployment.stdout + deployment.stderr,
  );
  assert.equal(deployment.status, 0, deployment.stdout + deployment.stderr);
  console.log("Deployed isolated Workflow with no public routes");
  await api(`/d1/database/${db.uuid}/query`, "POST", {
    sql: "CREATE TABLE IF NOT EXISTS sites(id TEXT PRIMARY KEY, version TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, count INTEGER NOT NULL);",
  });
  await api(`/d1/database/${db.uuid}/query`, "POST", {
    sql: "INSERT INTO sites VALUES (?, 'old')",
    params: [siteId],
  });
  await createRequire(require.resolve("wrangler"))("esbuild").build({
    stdin: {
      contents:
        'export * from "./packages/render/spike/fixtures"; export * from "./packages/render/spike/render";',
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(output, "fixtures.cjs"),
  });
  const { makeFixture, fragments, renderFixture, renderAtoms, prefix, suffix } =
    await import(pathToFileURL(join(output, "fixtures.cjs")));
  const records = [];
  const pages = [];
  for (const kind of ["portfolio", "case-study", "resume"]) {
    const allParts = fragments(makeFixture(kind));
    const parts = small ? allParts.slice(0, 3) : allParts;
    pages.push({ name: kind, fragments: parts.length });
    for (let index = 0; index < parts.length; index++)
      records.push({ kind, index, body: parts[index] });
  }
  // Shared inputs are intentionally duplicated by version to match the local candidate contract.
  for (const id of reuseFixtures ? [] : candidateIds) {
    for (let offset = 0; offset < records.length; offset += 8) {
      await Promise.all(
        records.slice(offset, offset + 8).map(async (record) => {
          const response = await raw(
            `/r2/buckets/${name}/objects/input/${id}/${record.kind}/${record.index}`,
            { method: "PUT", body: record.body },
          );
          assert.ok(response.ok, `R2 fixture upload HTTP ${response.status}`);
        }),
      );
    }
    console.log(`Uploaded ${records.length} bounded records for ${id}`);
  }
  report.pages = pages;
  report.startedAt = new Date().toISOString();
  for (const id of candidateIds)
    await api(`/workflows/${name}/instances`, "POST", {
      instance_id: id,
      params: {
        id,
        site: siteId,
        base: "old",
        pages,
        ...(reuseFixtures
          ? { source: id.startsWith("live-a") ? "live-a" : "live-b" }
          : {}),
      },
    });
  const deadline = Date.now() + 900000;
  while (Date.now() < deadline) {
    report.statuses = await Promise.all(
      candidateIds.map(async (id) => ({
        id,
        ...(await api(`/workflows/${name}/instances/${id}`)),
      })),
    );
    console.log(
      report.statuses
        .map((status) => `${status.id}: ${status.status}`)
        .join(", "),
    );
    if (
      report.statuses.every((status) =>
        ["complete", "errored", "terminated"].includes(status.status),
      )
    )
      break;
    await setTimeout(10000);
  }
  report.finishedAt = new Date().toISOString();
  if (report.statuses.some((status) => status.status !== "complete"))
    process.exitCode = 1;
  report.databaseState = await api(`/d1/database/${db.uuid}/query`, "POST", {
    sql: "SELECT * FROM sites",
  });
  report.pagesVerified = [];
  for (const status of report.statuses.filter(
    (status) => status.status === "complete",
  )) {
    const response = await raw(
      `/r2/buckets/${name}/objects/candidate/${status.id}/manifest.json`,
    );
    assert.ok(response.ok);
    const manifest = await response.json();
    for (let index = 0; index < manifest.length; index++) {
      const object = await raw(
        `/r2/buckets/${name}/objects/${manifest[index].key}`,
      );
      const fixture = makeFixture(pages[index].name);
      const expected = small
        ? prefix +
          fragments(fixture)
            .slice(0, 3)
            .map((part) => renderAtoms(JSON.parse(part)))
            .join("") +
          suffix
        : renderFixture(fixture);
      const matches = object.ok && (await object.text()) === expected;
      report.pagesVerified.push({
        id: status.id,
        page: pages[index].name,
        matches,
      });
      assert.ok(matches, "Deployed HTML mismatch");
    }
  }
  const outputs = report.statuses.map((status) =>
    typeof status.output === "string"
      ? JSON.parse(status.output)
      : status.output,
  );
  report.checks = [
    {
      name: "both deployed candidates complete",
      passed: report.statuses.every((status) => status.status === "complete"),
    },
    {
      name: "six deployed page bodies match expected HTML",
      passed:
        report.pagesVerified.length === 6 &&
        report.pagesVerified.every((page) => page.matches),
    },
    {
      name: "exactly one deployed candidate commits",
      passed: outputs.filter((value) => value?.committed).length === 1,
    },
  ];
  if (report.checks.some((check) => !check.passed)) process.exitCode = 1;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(
    join(
      root,
      `specs/2026-10-15-workflow-assets/${small ? "workflow-smoke-evidence" : "workflow-live-evidence"}.json`,
    ),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      output,
      error: report.error,
      statuses: report.statuses.map((s) => ({
        id: s.id,
        status: s.status,
        error: s.error,
      })),
    }),
  );
}
