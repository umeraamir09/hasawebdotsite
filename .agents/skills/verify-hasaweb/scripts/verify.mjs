#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runVerification } from "../../../../scripts/verify.mjs";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const script = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const port = 8837;
const origin = `http://127.0.0.1:${port}`;
const json = (path, value) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const buildHash = async () =>
  createHash("sha256")
    .update(await readFile(join(root, "apps/web/.open-next/worker.js")))
    .digest("hex");

async function doctor(directory) {
  const instance = JSON.parse(await readFile(join(directory, "instance.json")));
  assert.equal(instance.root, root);
  assert.equal(instance.revision, git("rev-parse", "HEAD"));
  assert.equal(instance.buildHash, await buildHash());
  process.kill(instance.pid, 0);
  const sockets = spawnSync("ss", ["-H", "-ltnp", `sport = :${port}`], {
    encoding: "utf8",
  });
  assert.equal(sockets.status, 0, "Linux/WSL ss is required");
  const pids = [...sockets.stdout.matchAll(/pid=(\d+)/g)].map((m) => m[1]);
  assert.ok(pids.length, "No identifiable process owns the web port");
  for (const pid of pids) {
    const group = spawnSync("ps", ["-o", "pgid=", "-p", pid], {
      encoding: "utf8",
    });
    assert.equal(
      Number(group.stdout.trim()),
      instance.pid,
      "Foreign port owner",
    );
  }
  const responses = [];
  for (const [path, app] of [
    ["/api/health", "web"],
    ["/api/dev-runtime/site/health", "site"],
    ["/api/dev-runtime/jobs/health", "jobs"],
  ]) {
    const response = await fetch(`${origin}${path}`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { app, status: "ok" });
    responses.push({ path, status: response.status, body });
  }
  const owner = await fetch(`${origin}/api/owner`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(owner.status, 401);
  assert.equal(owner.headers.get("cache-control"), "private, no-store");
  return { ...instance, responses, ownerStatus: owner.status };
}

async function drive() {
  const parent = join(root, ".wrangler/evidence");
  await mkdir(parent, { recursive: true });
  const evidence = await mkdtemp(join(parent, "verify-hasaweb-"));
  console.log(`Journey evidence: ${evidence}`);
  const scratch = join(evidence, "scratch");
  const state = join(scratch, "state");
  await mkdir(scratch);
  const report = {
    feature: "entry",
    origin,
    revision: git("rev-parse", "HEAD"),
    actions: [],
    requests: [],
    responses: [],
    pageErrors: [],
    externalRequests: [],
  };
  let server;
  let browser;
  let page;
  let migrated = false;
  let failed = false;
  let interrupted;
  const onSignal = (signal) => {
    interrupted = signal;
    void browser?.close();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const cli = (args) => {
    const result = spawnSync(process.execPath, [wrangler, ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      timeout: 120000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  const database = () =>
    JSON.parse(
      cli([
        "d1",
        "execute",
        "DB",
        "--local",
        "--config",
        join(scratch, "web.json"),
        "--persist-to",
        state,
        "--json",
        "--command",
        "SELECT (SELECT count(*) FROM user) AS users, (SELECT count(*) FROM session) AS sessions, (SELECT count(*) FROM portfolio) AS portfolios, (SELECT count(*) FROM subdomain_claim) AS claims, (SELECT count(*) FROM asset) AS assets",
      ]),
    )[0].results;
  try {
    const sockets = spawnSync("ss", ["-H", "-ltn"], { encoding: "utf8" });
    assert.equal(sockets.status, 0, "Linux/WSL ss is required");
    assert.doesNotMatch(
      sockets.stdout,
      /:(8837|8838|8839|9337|9338|9339)\s/,
      "Verification ports are busy",
    );
    const secret = randomBytes(32).toString("hex");
    for (const app of ["web", "site", "jobs"]) {
      const config = JSON.parse(
        await readFile(join(root, `apps/${app}/wrangler.jsonc`)),
      );
      config.main = resolve(root, `apps/${app}`, config.main);
      config.d1_databases[0].migrations_dir = join(
        root,
        "packages/db/migrations",
      );
      if (config.assets)
        config.assets.directory = join(root, "apps/web/.open-next/assets");
      config.vars = {
        APP_ENV: "local",
        APP_ORIGIN: origin,
        BETTER_AUTH_SECRET: secret,
        GITHUB_CLIENT_ID: "local-verification",
        GITHUB_CLIENT_SECRET: "local-verification",
        GOOGLE_CLIENT_ID: "local-verification",
        GOOGLE_CLIENT_SECRET: "local-verification",
      };
      await json(join(scratch, `${app}.json`), config);
    }
    const configArgs = ["web", "site", "jobs"].flatMap((app) => [
      "-c",
      join(scratch, `${app}.json`),
    ]);
    const migrationLog = cli([
      "d1",
      "migrations",
      "apply",
      "hasaweb-local",
      "--local",
      "--config",
      join(scratch, "web.json"),
      "--persist-to",
      state,
    ]);
    await writeFile(join(evidence, "migrations.log"), migrationLog);
    migrated = true;
    report.databaseBefore = database();
    assert.deepEqual(report.databaseBefore, [
      { users: 0, sessions: 0, portfolios: 0, claims: 0, assets: 0 },
    ]);
    server = spawn(
      process.execPath,
      [
        wrangler,
        "dev",
        ...configArgs,
        "--persist-to",
        state,
        "--port",
        String(port),
        "--inspector-port",
        "9337",
        "--ip",
        "127.0.0.1",
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
    let logs = "";
    let launchError;
    server.on("error", (error) => {
      launchError = error;
    });
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (chunk) => {
        logs += chunk;
      });
    await json(join(evidence, "instance.json"), {
      root,
      origin,
      pid: server.pid,
      revision: report.revision,
      buildHash: await buildHash(),
    });
    try {
      for (let attempt = 0; ; attempt++) {
        if (interrupted) throw new Error(interrupted);
        if (launchError) throw launchError;
        assert.equal(server.exitCode, null, logs);
        try {
          await doctor(evidence);
          break;
        } catch (error) {
          if (attempt >= 119) throw error;
          await delay(500);
        }
      }
      await json(join(evidence, "doctor.json"), await doctor(evidence));
      browser = await chromium.launch({
        executablePath:
          process.env.AUTH_SPIKE_CHROMIUM ?? "/opt/google/chrome/chrome",
        args: ["--no-sandbox"],
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
      });
      await context.route("**/*", async (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          report.externalRequests.push(route.request().url());
          await route.abort();
        } else await route.continue();
      });
      page = await context.newPage();
      page.on("pageerror", (error) => report.pageErrors.push(error.message));
      page.on("request", (request) =>
        report.requests.push({
          method: request.method(),
          path: new URL(request.url()).pathname,
        }),
      );
      page.on("response", (response) =>
        report.responses.push({
          method: response.request().method(),
          path: new URL(response.url()).pathname,
          status: response.status(),
        }),
      );
      const capture = async (name) => {
        await page.screenshot({
          path: join(evidence, `${name}.png`),
          fullPage: true,
        });
        await writeFile(
          join(evidence, `${name}.aria.txt`),
          await page.locator("body").ariaSnapshot(),
        );
        report.actions.push({ name, url: page.url() });
      };
      await page.goto(origin);
      await page
        .getByRole("heading", {
          level: 1,
          name: "Everyone should have a website.",
        })
        .waitFor();
      await capture("01-home");
      report.actions.push({
        action: "click",
        role: "link",
        name: "Start building",
      });
      await page
        .getByRole("link", { name: "Start building", exact: true })
        .click();
      await page.waitForURL(`${origin}/sign-in`);
      for (const provider of ["GitHub", "Google"])
        assert.ok(
          await page
            .getByRole("button", {
              name: `Continue with ${provider}`,
              exact: true,
            })
            .isEnabled(),
        );
      await capture("02-sign-in");
      report.actions.push({
        action: "click",
        role: "link",
        name: "Back to home",
      });
      await page
        .getByRole("link", { name: "Back to home", exact: true })
        .click();
      await page.waitForURL(`${origin}/`);
      await capture("03-home-return");
      report.actions.push({
        action: "navigate",
        path: "/editor",
        authenticated: false,
      });
      const rejected = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/owner/portfolio",
      );
      await page.goto(`${origin}/editor`);
      assert.equal((await rejected).status(), 401);
      await page.waitForURL(`${origin}/sign-in?reason=session_expired`);
      await page
        .getByRole("heading", { name: "Welcome back.", exact: true })
        .waitFor();
      await capture("04-signed-out-entry");
      await context.tracing.stop({ path: join(evidence, "trace.zip") });
      assert.deepEqual(report.pageErrors, []);
      assert.deepEqual(report.externalRequests, []);
      assert.ok(
        report.requests.every(
          (request) =>
            request.method === "GET" ||
            (request.method === "POST" &&
              request.path === "/api/owner/portfolio"),
        ),
        "Unexpected mutation request in signed-out journey",
      );
      const writes = report.responses.filter(
        (response) => response.method !== "GET",
      );
      assert.ok(
        writes.length,
        "Observe the actual shell provisioning rejection",
      );
      assert.ok(
        writes.every(
          (response) =>
            response.method === "POST" &&
            response.path === "/api/owner/portfolio" &&
            response.status === 401,
        ),
      );
    } finally {
      await writeFile(join(evidence, "runtime.log"), logs);
    }
  } catch (error) {
    failed = true;
    report.error = String(error);
    if (page && !page.isClosed())
      await page
        .screenshot({ path: join(evidence, "failure.png") })
        .catch(() => {});
    console.error(error);
  } finally {
    const cleanupErrors = [];
    await browser?.close().catch((error) => cleanupErrors.push(String(error)));
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") cleanupErrors.push(String(error));
      }
      await Promise.race([
        server.exitCode !== null || server.signalCode !== null
          ? Promise.resolve()
          : new Promise((done) => server.once("exit", done)),
        delay(5000, undefined, { ref: false }),
      ]);
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") cleanupErrors.push(String(error));
      }
    }
    try {
      if (migrated) {
        report.databaseAfter = database();
        assert.deepEqual(report.databaseAfter, report.databaseBefore);
      }
    } catch (error) {
      cleanupErrors.push(String(error));
    }
    await rm(scratch, { recursive: true, force: true }).catch((error) =>
      cleanupErrors.push(String(error)),
    );
    report.cleanupErrors = cleanupErrors;
    if (cleanupErrors.length) failed = true;
    report.status = failed || interrupted ? "failed" : "passed";
    await json(join(evidence, "journey.json"), report);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    console.log(`Journey ${report.status}: ${join(evidence, "journey.json")}`);
  }
  return failed || interrupted ? 1 : 0;
}

if (process.argv[2] === "--doctor" && process.argv[3]) {
  console.log(JSON.stringify(await doctor(resolve(process.argv[3])), null, 2));
} else if (process.argv[2] === "--drive") {
  process.exitCode = await drive();
} else if (process.argv.length === 2) {
  process.exitCode = await runVerification({
    root,
    profile: "verify-hasaweb-entry",
    commands: [
      ["pnpm", "build"],
      [process.execPath, script, "--drive"],
    ],
  });
} else {
  throw new Error("Usage: verify.mjs [--doctor evidence-directory]");
}
