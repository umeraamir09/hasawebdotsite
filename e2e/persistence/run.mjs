import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { freePort } from "../support/ports.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const output = join(root, ".wrangler/persistence-integration");
const state = join(output, "state");
const config = join(output, "wrangler.json");
const legacyMigrations = join(output, "legacy-migrations");
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
let runtime;
let logs = "";
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" };
await mkdir(output, { recursive: true });
await rm(state, { recursive: true, force: true });
await rm(legacyMigrations, { recursive: true, force: true });
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
      if (
        (await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) }))
          .ok
      )
        return;
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
  // Upgrade an existing 11B/11D database with a retained staged draft/piece.
  for (const name of await readdir(join(root, "packages/db/migrations")))
    if (/^000[3-4]_.*\.sql$/.test(name))
      await copyFile(
        join(root, "packages/db/migrations", name),
        join(legacyMigrations, name),
      );
  command(["d1", "migrations", "apply", "persistence-integration"]);
  command([
    "d1",
    "execute",
    "DB",
    "--command",
    `INSERT INTO owner_save_attempt(id,user_id,session_id,base_revision,draft,progress,expires_at) SELECT 'migration-attempt',user_id,'migration-session',draft_rev,draft,setup_progress,9999999999999 FROM portfolio WHERE id='local-portfolio'; INSERT INTO owner_save_piece(attempt_id,n,data) VALUES('migration-attempt',0,'"retained piece"');`,
  ]);
  // Upgrade an existing Phase 24 database containing both retained and pending
  // candidates. The admission migration must preserve their different lifetimes.
  for (const name of await readdir(join(root, "packages/db/migrations")))
    if (/\.sql$/.test(name) && name < "0012_")
      await copyFile(
        join(root, "packages/db/migrations", name),
        join(legacyMigrations, name),
      );
  command(["d1", "migrations", "apply", "persistence-integration"]);
  command([
    "d1",
    "execute",
    "DB",
    "--command",
    `INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,status,cursor,next_attempt_at,deadline_at,created_at,updated_at) VALUES
      ('migration-retained','local-portfolio','local-user',0,'{}','ready','[]',0,0,1,1),
      ('migration-pending','local-portfolio','local-user',0,NULL,'cleaned','[]',0,0,1,1);
     INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) VALUES('migration-version','local-portfolio',1,'superseded','publication-v1','migration-retained',1,1);`,
  ]);
  configuration.d1_databases[0].migrations_dir = join(
    root,
    "packages/db/migrations",
  );
  await writeFile(config, JSON.stringify(configuration));
  command(["d1", "migrations", "apply", "persistence-integration"]);
  const admission = command([
    "d1",
    "execute",
    "DB",
    "--command",
    "SELECT candidate_id FROM publication_candidate_pending ORDER BY candidate_id",
    "--json",
  ]);
  assert.deepEqual(
    JSON.parse(admission.slice(admission.indexOf("[")))[0].results,
    [{ candidate_id: "migration-pending" }],
  );
  command([
    "d1",
    "execute",
    "DB",
    "--command",
    "DELETE FROM publish_version WHERE id='migration-version'; DELETE FROM publication_candidate WHERE id IN ('migration-retained','migration-pending');",
  ]);
  const staged = command([
    "d1",
    "execute",
    "DB",
    "--command",
    "SELECT context,validation_complete,(SELECT data FROM owner_save_piece WHERE attempt_id='migration-attempt') AS piece FROM owner_save_attempt WHERE id='migration-attempt'",
    "--json",
  ]);
  const preserved = JSON.parse(staged.slice(staged.indexOf("[")))[0].results[0];
  assert.deepEqual(preserved, {
    context: "setup",
    validation_complete: 0,
    piece: '"retained piece"',
  });
  command([
    "d1",
    "execute",
    "DB",
    "--command",
    "DELETE FROM owner_save_attempt WHERE id='migration-attempt'",
  ]);
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
    migrationAttemptPreserved: true,
    candidateAdmissionBackfillPreserved: true,
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
