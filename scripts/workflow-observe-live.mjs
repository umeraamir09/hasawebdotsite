import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resume observation after a client timeout without spending more Workflow steps.
const root = fileURLToPath(new URL("..", import.meta.url));
const evidencePath = join(
  root,
  "specs/2026-10-15-workflow-assets/workflow-live-evidence.json",
);
const report = JSON.parse(await readFile(evidencePath, "utf8"));
const saved = await readFile(
  join(homedir(), ".config/.wrangler/config/default.toml"),
  "utf8",
);
const token = saved.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
assert.ok(token);
const account = "b6f9a87e6702c76c45a8d61744826e0f";
const ids = report.statuses.map((status) => status.id);
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
async function api(path, init) {
  const response = await raw(path, init);
  const data = await response.json();
  assert.ok(response.ok && data.success, JSON.stringify(data.errors));
  return data.result;
}
try {
  const deadline = Date.now() + 900000;
  while (Date.now() < deadline) {
    report.statuses = await Promise.all(
      ids.map(async (id) => ({
        id,
        ...(await api(`/workflows/${report.worker}/instances/${id}`)),
      })),
    );
    console.log(
      report.statuses
        .map(
          (s) =>
            `${s.id}: ${s.status}, ${s.steps.filter((step) => step.success).length} completed steps`,
        )
        .join("; "),
    );
    if (
      report.statuses.every((s) =>
        ["complete", "errored", "terminated"].includes(s.status),
      )
    )
      break;
    await setTimeout(10000);
  }
  report.finishedAt = new Date().toISOString();
  const require = createRequire(import.meta.url);
  const output = join(root, ".wrangler/workflow-live/fixtures.cjs");
  await createRequire(require.resolve("wrangler"))("esbuild").build({
    stdin: {
      contents:
        'export * from "./packages/render/spike/fixtures"; export * from "./packages/render/spike/render";',
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: output,
  });
  const { makeFixture, renderFixture } = await import(pathToFileURL(output));
  report.pagesVerified = [];
  for (const status of report.statuses.filter((s) => s.status === "complete")) {
    const response = await raw(
      `/r2/buckets/${report.bucket}/objects/candidate/${status.id}/manifest.json`,
    );
    assert.ok(response.ok);
    const manifest = await response.json();
    for (let index = 0; index < manifest.length; index++) {
      const object = await raw(
        `/r2/buckets/${report.bucket}/objects/${manifest[index].key}`,
      );
      const matches =
        object.ok &&
        (await object.text()) ===
          renderFixture(makeFixture(report.pages[index].name));
      report.pagesVerified.push({
        id: status.id,
        page: report.pages[index].name,
        matches,
      });
      assert.ok(matches, "Deployed output mismatch");
    }
  }
  report.databaseState = await api(`/d1/database/${report.database}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: "SELECT * FROM sites" }),
  });
  const outputs = report.statuses.map((s) =>
    typeof s.output === "string" ? JSON.parse(s.output) : s.output,
  );
  report.checks = [
    {
      name: "both deployed candidates complete",
      passed: report.statuses.every((s) => s.status === "complete"),
    },
    {
      name: "six deployed page bodies match expected HTML",
      passed:
        report.pagesVerified.length === 6 &&
        report.pagesVerified.every((p) => p.matches),
    },
    {
      name: "exactly one deployed candidate commits",
      passed: outputs.filter((o) => o?.committed).length === 1,
    },
  ];
  if (report.checks.some((check) => !check.passed)) process.exitCode = 1;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ checks: report.checks, error: report.error }));
}
