// Actual production router through the built web Worker and named jobs binding.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EMAIL_FROM,
  RESEND_FIXTURE_KEY,
  startEmailFixture,
} from "./email-fixture.mjs";
import {
  ACTIVITY_CLIENT_ID,
  ACTIVITY_CLIENT_SECRET,
  ACTIVITY_KEY,
  PLATFORM_TOKEN,
  startGitHubFixture,
} from "./github-fixture.mjs";
import { freePort } from "./ports.mjs";
import {
  startTurnstileFixture,
  TURNSTILE_FIXTURE_SECRET,
  TURNSTILE_FIXTURE_SITE_KEY,
} from "./turnstile-fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url)),
  require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const esbuild = createRequire(require.resolve("wrangler"))("esbuild");

// Starts the built web Worker and the real jobs owner router in workerd with
// a fresh local D1/R2 state, seeds synthetic owners and sessions, and returns
// the helpers the draft API, autosave and editor suites share.
export async function startOwnerRuntime({ directory, evidence }) {
  const port = await freePort(),
    inspectorPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const database = "owner-draft-api";
  const secrets = {
    RUNTIME_KEY: randomBytes(32).toString("hex"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  };
  const state = join(directory, "state"),
    configs = {
      jobs: join(directory, "jobs.json"),
      web: join(directory, "web.json"),
    };
  const tokens = Object.fromEntries(
    [
      "alice",
      "alice-other",
      "bob",
      "revoked",
      "expired",
      "deleting",
      "fresh",
    ].map((id) => [id, randomBytes(24).toString("hex")]),
  );
  const checks = [],
    samples = [];
  let child,
    logs = "";
  await mkdir(directory, { recursive: true });
  await mkdir(evidence, { recursive: true });
  function cli(args) {
    const result = spawnSync(process.execPath, [wrangler, ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  }
  // Test-only SQL against the fixture D1. Miniflare occasionally drops the
  // connection to its D1 service under CI load ("Network connection lost").
  // Reads are safe to repeat, so retry them; writes fail loudly because a
  // dropped write may already have applied.
  const readOnly = /^\s*(select|with|pragma)\b/i;
  async function sql(query, values = []) {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${origin}/__fixture/sql`, {
        method: "POST",
        headers: {
          "X-Runtime-Key": secrets.RUNTIME_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, values }),
        signal: AbortSignal.timeout(30000),
      });
      if (response.status === 200) return (await response.json()).results;
      const text = await response.text();
      if (
        attempt < 4 &&
        response.status === 500 &&
        readOnly.test(query) &&
        text.includes("Network connection lost")
      ) {
        await setTimeout(250 * attempt);
        continue;
      }
      assert.fail(`fixture sql ${response.status}: ${text}`);
    }
  }
  function cookie(id) {
    const token = tokens[id];
    return `__Host-hasaweb.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secrets.BETTER_AUTH_SECRET).update(token).digest("base64")}`)}`;
  }
  async function request(action, body = {}, options = {}) {
    const path = action.startsWith("/") ? action : `/api/owner/draft/${action}`;
    const method = options.method ?? (action.startsWith("/") ? "GET" : "POST");
    const at = Date.now(),
      start = performance.now();
    const response = await fetch(
      `${origin}${path}?case=${options.name ?? "check"}`,
      {
        method,
        headers: {
          "X-Runtime-Key": secrets.RUNTIME_KEY,
          Origin: origin,
          "Content-Type": "application/json",
          Cookie:
            options.owner === null ? "" : cookie(options.owner ?? "alice"),
          "X-Expected-Owner-Id": `draft-${(options.owner ?? "alice").replace("-other", "")}`,
          ...options.headers,
        },
        ...(method === "GET"
          ? {}
          : {
              body:
                typeof body === "string" || body instanceof Uint8Array
                  ? body
                  : JSON.stringify(body),
            }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const text = await response.text(),
      elapsedMs = +(performance.now() - start).toFixed(3);
    assert.ok(
      (Array.isArray(options.status)
        ? options.status
        : [options.status ?? 200]
      ).includes(response.status),
      `${action}: ${response.status} ${text.slice(0, 200)}`,
    );
    assert.match(
      response.headers.get("Cache-Control") ?? "",
      /private.*no-store/,
    );
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
    assert.match(response.headers.get("Vary") ?? "", /Cookie/);
    if (response.headers.has("X-Fixture-Queries"))
      assert.ok(
        Number(response.headers.get("X-Fixture-Queries")) <= 50,
        "Free invocation query limit",
      );
    const result = text ? JSON.parse(text) : null;
    if (action === "validation-step" && response.ok) {
      assert.ok(result.examined === undefined || result.examined <= 16);
      assert.ok(
        result.validationBytes === undefined || result.validationBytes <= 4096,
      );
    }
    samples.push({
      case: options.name ?? "check",
      at,
      elapsedMs,
      status: response.status,
      rowsRead: response.headers.has("X-Fixture-Rows-Read")
        ? Number(response.headers.get("X-Fixture-Rows-Read"))
        : null,
      rowsWritten: response.headers.has("X-Fixture-Rows-Written")
        ? Number(response.headers.get("X-Fixture-Rows-Written"))
        : null,
      queries: response.headers.has("X-Fixture-Queries")
        ? Number(response.headers.get("X-Fixture-Queries"))
        : null,
      colo: response.headers.get("cf-ray")?.split("-")[1] ?? null,
      ...(response.headers.has("X-Fixture-Same-Environment")
        ? {
            sameEnvironment:
              response.headers.get("X-Fixture-Same-Environment") === "true",
            sameDatabase:
              response.headers.get("X-Fixture-Same-Database") === "true",
          }
        : {}),
      ...(action === "validation-step" && response.ok
        ? {
            examined: result.examined ?? 0,
            validationBytes: result.validationBytes ?? 0,
            complete: result.complete,
          }
        : {}),
      ...(action === "cleanup" && response.ok
        ? {
            cleanupReceipt: {
              pieces: result.pieces,
              attempts: result.attempts,
            },
          }
        : {}),
    });
    return result;
  }
  async function check(name, action) {
    await action();
    checks.push({ name, passed: true });
  }
  async function start() {
    child = spawn(
      process.execPath,
      [
        wrangler,
        "dev",
        "-c",
        configs.web,
        "-c",
        configs.jobs,
        "--persist-to",
        state,
        "--port",
        String(port),
        "--ip",
        "127.0.0.1",
        "--inspector-port",
        String(inspectorPort),
      ],
      {
        cwd: root,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          WRANGLER_SEND_METRICS: "false",
          BROWSER: "none",
        },
      },
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        logs = (logs + chunk).slice(-200_000);
      });
    for (let i = 0; i < 150; i++) {
      try {
        if (
          (
            await fetch(`${origin}/health`, {
              headers: { "X-Runtime-Key": secrets.RUNTIME_KEY },
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        )
          return;
      } catch {}
      if (child.exitCode !== null) throw new Error(logs);
      await setTimeout(200);
    }
    throw new Error(`Runtime did not start. ${logs}`);
  }
  // A local stand-in for GitHub's public endpoints (no real account or token).
  const github = await startGitHubFixture(await freePort());
  // A local stand-in for Resend (Phase 43 recipient confirmation).
  const email = await startEmailFixture(await freePort());
  const turnstile = await startTurnstileFixture(await freePort());
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((r) => child.once("exit", r));
    process.kill(-child.pid, "SIGTERM");
    await Promise.race([exited, setTimeout(5000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid, "SIGKILL");
    child = undefined;
  }
  await rm(state, { recursive: true, force: true });
  const base = {
    compatibility_date: "2026-10-14",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
  };
  await writeFile(
    configs.jobs,
    JSON.stringify({
      ...base,
      name: "draft-api-jobs-local",
      main: join(root, "apps/jobs/integration/draft-api-worker.ts"),
      d1_databases: [
        {
          binding: "DB",
          database_name: database,
          database_id: "00000000-0000-0000-0000-000000000013",
          migrations_dir: join(root, "packages/db/migrations"),
        },
      ],
      assets: {
        directory: join(root, "apps/jobs/dist/platform"),
        binding: "PLATFORM_ASSETS",
        run_worker_first: true,
      },
      r2_buckets: [
        { binding: "SITES_BUCKET", bucket_name: "draft-api-sites" },
        {
          binding: "PUBLIC_ASSETS_BUCKET",
          bucket_name: "draft-api-public-assets",
        },
      ],
      services: [
        {
          binding: "PRIVATE_SOURCE",
          service: "draft-api-web-local",
          entrypoint: "PublicationAssets",
        },
      ],
      queues: {
        producers: [
          { binding: "PUBLICATION_QUEUE", queue: "hasaweb-publication-local" },
          // Phase 42 GitHub refresh (visits, status reads, daily sweep).
          { binding: "GITHUB_QUEUE", queue: "hasaweb-github-local" },
          // Phase 45 first delivery attempts. The visitor fixture binds it
          // only for posts that ask for it (`queue: true`).
          { binding: "CONTACT_QUEUE", queue: "hasaweb-contact-local" },
        ],
        consumers: [
          {
            queue: "hasaweb-contact-local",
            max_batch_size: 1,
            max_batch_timeout: 1,
          },
          {
            queue: "hasaweb-publication-local",
            max_batch_size: 1,
            max_batch_timeout: 1,
            max_retries: 4,
          },
          {
            queue: "hasaweb-github-local",
            max_batch_size: 1,
            max_batch_timeout: 1,
          },
        ],
      },
      vars: {
        ASSET_ORIGIN: "https://assets.hasaweb.site",
        APP_ENV: "test",
        MEASURE_DB: "true",
        APP_ORIGIN: "https://hasaweb.site",
        RUNTIME_ENABLED: "true",
        GITHUB_CLIENT_ID: "fixture",
        GITHUB_CLIENT_SECRET: "fixture",
        GOOGLE_CLIENT_ID: "fixture",
        GOOGLE_CLIENT_SECRET: "fixture",
        // Public graph setup reads this local stand-in, never GitHub.
        GITHUB_SERVICE_TOKEN: PLATFORM_TOKEN,
        GITHUB_API_ORIGIN: github.origin,
        // The separate private-activity app, served by the same stand-in.
        GITHUB_ACTIVITY_CLIENT_ID: ACTIVITY_CLIENT_ID,
        GITHUB_ACTIVITY_CLIENT_SECRET: ACTIVITY_CLIENT_SECRET,
        GITHUB_ACTIVITY_KEY: ACTIVITY_KEY,
        // The real Resend adapter, sending to the local stand-in.
        RESEND_API_KEY: RESEND_FIXTURE_KEY,
        EMAIL_FROM,
        RESEND_API_ORIGIN: email.origin,
        // Phase 44 `/_/contact`, verified against the local stand-in.
        TURNSTILE_SITE_KEY: TURNSTILE_FIXTURE_SITE_KEY,
        TURNSTILE_SECRET: TURNSTILE_FIXTURE_SECRET,
        TURNSTILE_VERIFY_ORIGIN: turnstile.origin,
      },
    }),
  );
  await writeFile(
    configs.web,
    JSON.stringify({
      ...base,
      name: "draft-api-web-local",
      main: join(root, "apps/web/integration/owner-runtime-gateway.ts"),
      d1_databases: [
        {
          binding: "DB",
          database_name: database,
          database_id: "00000000-0000-0000-0000-000000000013",
        },
      ],
      r2_buckets: [
        { binding: "DRAFT_BUCKET", bucket_name: "draft-api-assets" },
      ],
      services: [
        {
          binding: "OWNER_API",
          service: "draft-api-jobs-local",
          entrypoint: "RuntimeOwnerApi",
        },
        { binding: "JOBS", service: "draft-api-jobs-local" },
      ],
      vars: {
        RUNTIME_ORIGIN: origin,
        RUNTIME_ENABLED: "true",
        APP_ENV: "test",
        // Phase 42E: the editor harness exercises the activated owner entry
        // and its `/editor/preview` route. Committed configs leave it closed.
        OWNER_ENTRY_ACTIVATION: "active",
        GITHUB_CLIENT_ID: "fixture",
        GITHUB_CLIENT_SECRET: "fixture",
        GOOGLE_CLIENT_ID: "fixture",
        GOOGLE_CLIENT_SECRET: "fixture",
      },
    }),
  );
  await writeFile(
    join(directory, ".dev.vars"),
    Object.entries(secrets)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    { mode: 0o600 },
  );
  cli([
    "d1",
    "migrations",
    "apply",
    database,
    "-c",
    configs.jobs,
    "--local",
    "--persist-to",
    state,
  ]);
  await esbuild.build({
    stdin: {
      contents:
        "export {completeDraft} from './packages/schema/src/fixtures.test-support.ts'; export {readDraft,draftSchema} from './packages/schema/src/index.ts';",
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(directory, "fixtures.mjs"),
  });
  const { completeDraft, readDraft, draftSchema } = await import(
    pathToFileURL(join(directory, "fixtures.mjs"))
  );
  const fixture = completeDraft(),
    progress = { schemaVersion: 1, step: "profile" };
  const read = (owner = "alice") => request("/api/owner/draft", {}, { owner });
  const patch = (revision, path, value, extra = {}) =>
    request(
      "patch",
      { context: "content", revision, change: { op: "set", path, value } },
      extra,
    );
  const pending = () => request("pending");
  const clear = () => sql("DELETE FROM owner_save_attempt");
  const setDraft = async (draft, generation = 2) => {
    await clear();
    await sql(
      "UPDATE portfolio SET draft=?,draft_validation_version=?,draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
      [JSON.stringify(draft), generation],
    );
    return (await request("/api/owner/progress")).revision;
  };
  async function validateUntilStop(attempt, options = {}) {
    let result = { sequence: attempt.sequence };
    for (let i = 0; i < 20000; i++) {
      result = await request(
        "validation-step",
        { id: attempt.id, sequence: result.sequence },
        options,
      );
      assert.ok(result.examined === undefined || result.examined <= 16);
      assert.ok(
        result.validationBytes === undefined || result.validationBytes <= 4096,
      );
      if (result.complete || result.issue) return result;
    }
    throw new Error("Validation failed to terminate");
  }
  await start();
  await sql(
    "CREATE TABLE IF NOT EXISTS runtime_probe(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  await sql("DELETE FROM user WHERE id LIKE 'draft-%'");
  for (const id of Object.keys(tokens)) {
    const owner = id === "alice-other" ? "alice" : id,
      now = Date.now();
    await sql(
      "INSERT OR IGNORE INTO user(id,name,email,email_verified,deleting_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      [
        `draft-${owner}`,
        owner,
        `${owner}@draft.example.test`,
        1,
        owner === "deleting" ? now : null,
        now,
        now,
      ],
    );
    await sql(
      "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      [
        `draft-session-${id}`,
        tokens[id],
        `draft-${owner}`,
        owner === "expired" ? 1 : now + 7200000,
        now,
        now,
      ],
    );
  }
  await check(
    "real session guards and unchanged provisioning/status contracts",
    async () => {
      for (const owner of [null, "expired", "deleting"])
        await request("/api/owner/draft", {}, { owner, status: 401 });
      for (const owner of ["alice", "bob", "revoked"]) {
        const created = await request(
          "/api/owner/portfolio",
          {},
          { method: "POST", owner },
        );
        assert.deepEqual(Object.keys(created).sort(), ["portfolio", "user"]);
        assert.equal(
          (await request("/api/owner", {}, { owner })).portfolio.id,
          created.portfolio.id,
        );
      }
      await request(
        "/api/owner/draft",
        {},
        { headers: { Cookie: `${cookie("alice")}x` }, status: 401 },
      );
      await request(
        "progress",
        { revision: 0, progress },
        { headers: { Origin: "https://evil.test" }, status: 403 },
      );
      await request(
        "progress",
        { revision: 0, progress },
        { headers: { "Content-Type": "text/plain" }, status: 415 },
      );
      await request("/api/owner/draft", {}, { method: "DELETE", status: 405 });
      assert.deepEqual(
        await request(
          "/api/owner/draft",
          {},
          { headers: { "X-Expected-Owner-Id": "" }, status: 400 },
        ),
        { error: "invalid_input" },
      );
      assert.deepEqual(
        await request(
          "patch",
          {
            context: "content",
            revision: 0,
            change: {
              op: "set",
              path: ["profile", "name"],
              value: "foreign input",
            },
          },
          { headers: { "X-Expected-Owner-Id": "draft-bob" }, status: 409 },
        ),
        { error: "owner_changed" },
      );
    },
  );
  await check(
    "real session missing portfolios return not_found on reads and writes",
    async () => {
      assert.equal(
        (await request("/api/owner", {}, { owner: "fresh" })).portfolio,
        null,
      );
      for (const path of ["/api/owner/draft", "/api/owner/progress"])
        assert.deepEqual(
          await request(path, {}, { owner: "fresh", status: 404 }),
          { error: "not_found" },
        );
      for (const [action, body] of [
        ["begin", { revision: 0, context: "content" }],
        [
          "patch",
          {
            context: "content",
            revision: 0,
            change: { op: "set", path: ["profile", "name"], value: "x" },
          },
        ],
        ["progress", { revision: 0, progress }],
      ])
        assert.deepEqual(
          await request(action, body, { owner: "fresh", status: 404 }),
          { error: "not_found" },
        );
    },
  );
  return {
    root,
    origin,
    secrets,
    tokens,
    github,
    email,
    turnstile,
    esbuild,
    fixture,
    progress,
    completeDraft,
    readDraft,
    draftSchema,
    evidence,
    checks,
    samples,
    cli,
    sql,
    cookie,
    request,
    read,
    patch,
    pending,
    clear,
    setDraft,
    validateUntilStop,
    start,
    stop,
    async close() {
      await stop();
      await github.close();
      await email.close();
      await turnstile.close();
    },
    logs: () => logs,
  };
}
