import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const output = join(root, ".wrangler/persistence-integration");
const state = join(output, "state");
const config = join(output, "wrangler.json");
const legacyMigrations = join(output, "legacy-migrations");
const port = 8810;
const base = `http://127.0.0.1:${port}`;
let runtime;
let logs = "";
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" };
await mkdir(output, { recursive: true });
await rm(state, { recursive: true, force: true });
await mkdir(legacyMigrations, { recursive: true });
for (const name of await readdir(join(root, "packages/db/migrations")))
  if (/^000[0-2]_.*\.sql$/.test(name))
    await copyFile(
      join(root, "packages/db/migrations", name),
      join(legacyMigrations, name),
    );
const configuration = {
  name: "hasaweb-persistence-integration",
  main: join(root, "packages/db/integration/worker.ts"),
  compatibility_date: "2026-10-14",
  compatibility_flags: ["nodejs_compat"],
  vars: { APP_ENV: "local" },
  d1_databases: [
    {
      binding: "DB",
      database_name: "persistence-integration",
      database_id: "00000000-0000-0000-0000-000000000010",
      migrations_dir: legacyMigrations,
    },
  ],
};
await writeFile(config, JSON.stringify(configuration));
function command(args) {
  const result = spawnSync(
    process.execPath,
    [wrangler, ...args, "--config", config, "--local", "--persist-to", state],
    { cwd: root, env, encoding: "utf8", timeout: 60_000 },
  );
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return result.stdout;
}
async function start() {
  logs = "";
  const child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--config",
      config,
      "--persist-to",
      state,
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
    ],
    { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  runtime = child;
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      logs = (logs + chunk).slice(-16_000);
    });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* Wait for local workerd. */
    }
    if (child.exitCode !== null) throw new Error(logs);
    await setTimeout(300);
  }
  throw new Error(`Local runtime did not start. ${logs}`);
}
async function stop() {
  if (!runtime || runtime.exitCode !== null || runtime.signalCode !== null)
    return;
  const exited = new Promise((resolve) => runtime.once("exit", resolve));
  process.kill(-runtime.pid, "SIGTERM");
  await Promise.race([exited, setTimeout(5_000, undefined, { ref: false })]);
  if (runtime.exitCode === null && runtime.signalCode === null)
    process.kill(-runtime.pid, "SIGKILL");
}
try {
  // Populate the deployed v1 schema before applying the additive setup migration.
  command(["d1", "migrations", "apply", "persistence-integration"]);
  command([
    "d1",
    "execute",
    "DB",
    "--file",
    join(root, "scripts/fixtures/persistence.sql"),
  ]);
  command([
    "d1",
    "execute",
    "DB",
    "--command",
    `
    UPDATE portfolio SET draft=json_set(draft,'$.profile.name','Migration content','$.samples',json('{"profile.name":true}')) WHERE id='local-portfolio';
    INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES('migration-asset','local-portfolio','avatar','image/webp',10,'ready',1,1);
    INSERT INTO subdomain_claim(name,portfolio_id) VALUES('migration-site','local-portfolio');
    INSERT INTO github_connection(portfolio_id,login,github_user_id,token_enc,scopes,private_enabled,status) VALUES('local-portfolio','legacy-fixture','legacy-id','legacy-encrypted-fixture','read:user',1,'ok');
    INSERT INTO github_activity(portfolio_id,public_days,private_counts) VALUES('local-portfolio','[{"count":2}]','[{"count":8}]');
  `,
  ]);
  configuration.d1_databases[0].migrations_dir = join(
    root,
    "packages/db/migrations",
  );
  await writeFile(config, JSON.stringify(configuration));
  command(["d1", "migrations", "apply", "persistence-integration"]);
  const reapplied = command([
    "d1",
    "migrations",
    "apply",
    "persistence-integration",
  ]);
  assert.match(reapplied, /No migrations to apply/);
  for (let repeat = 0; repeat < 2; repeat++)
    command([
      "d1",
      "execute",
      "DB",
      "--file",
      join(root, "scripts/fixtures/persistence.sql"),
    ]);
  await start();
  const response = await fetch(`${base}/run`, { method: "POST" });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result, null, 2));
  await stop();
  await start();
  const persisted = await (await fetch(`${base}/persist`)).json();
  assert.deepEqual(persisted, {
    portfolio: "portfolio-a",
    asset: "ready",
    counter: 8,
    claim: "alice-site",
    githubCleanup: {
      persisted: "pending",
      ownerRemoved: true,
      retried: true,
      tokenCleared: true,
    },
    provision: {
      status: "draft",
      revision: 1,
      step: "profile",
      name: "Resume after restart",
      firstEditorEnteredAt: null,
      noClaim: true,
    },
  });
  const evidence = {
    checkedAt: new Date().toISOString(),
    runtime: "local workerd / D1",
    migrationsReapplied: true,
    fixturesReapplied: true,
    ...result,
    restartPersistence: persisted,
  };
  await writeFile(
    join(output, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(
    `PASS: ${result.passed} persistence/access checks, tracked migrations, repeatable fixtures, and restart persistence`,
  );
  console.log(`Evidence: ${join(output, "evidence.json")}`);
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await stop();
}
