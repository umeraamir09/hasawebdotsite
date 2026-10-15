import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { checkBrowserCookies } from "./auth-cookie-browser.mjs";
import { checkAuthUi } from "./auth-ui-browser.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const output = join(root, ".wrangler/auth-integration");
const state = join(output, "state");
const configPath = join(output, "wrangler.json");
const port = 8811;
const origin = "https://hasaweb.site";
const evidence = [];
const cookieNames = new Set();
const cookieSamples = new Map();
let browserEvidence;
let uiEvidence;
let child;
let logs = "";

function cli(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
// Deliberately small transport jar. Attribute assertions check the emitted
// cookies. Chromium separately checks actual cookie enforcement.
class Jar {
  values = new Map();
  header(url = origin) {
    const target = new URL(url);
    if (target.origin !== origin) return "";
    return [...this.values].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  take(response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      assert.ok(name.startsWith("__Host-"), name);
      assert.match(cookie, /;\s*Secure(?:;|$)/i);
      assert.match(cookie, /;\s*HttpOnly(?:;|$)/i);
      assert.match(cookie, /;\s*SameSite=Lax(?:;|$)/i);
      assert.match(cookie, /;\s*Path=\/(?:;|$)/i);
      assert.doesNotMatch(cookie, /;\s*Domain=/i);
      cookieNames.add(name);
      if (!/;\s*Max-Age=0(?:;|$)/i.test(cookie))
        cookieSamples.set(name, cookie);
      if (/;\s*Max-Age=0(?:;|$)/i.test(cookie)) this.values.delete(name);
      else this.values.set(name, pair.slice(index + 1));
    }
  }
  clone() {
    const jar = new Jar();
    jar.values = new Map(this.values);
    return jar;
  }
}
async function request(path, jar = new Jar(), body, extra = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: jar.header(),
      ...(body ? { Origin: origin, "Content-Type": "application/json" } : {}),
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  jar.take(response);
  return response;
}
async function begin(provider, jar, link = false, extra = {}) {
  const response = await request(
    `/api/auth/${link ? "link-social" : "sign-in/social"}`,
    jar,
    {
      provider,
      callbackURL: `${origin}/editor`,
      errorCallbackURL: `${origin}/sign-in?provider=${provider}`,
    },
    extra,
  );
  return { response, data: await response.json() };
}
async function callback(provider, jar, url, code, params = {}) {
  const authorization = new URL(url);
  const query = new URLSearchParams({
    state: authorization.searchParams.get("state"),
    code,
    ...params,
  });
  return request(`/api/auth/callback/${provider}?${query}`, jar);
}
async function identity(jar, query = "") {
  const response = await request(`/api/auth/get-session${query}`, jar);
  assert.ok([200, 401].includes(response.status));
  return response.json();
}
async function login(provider, code, jar = new Jar()) {
  const { response, data } = await begin(provider, jar);
  assert.equal(response.status, 200);
  const url = new URL(data.url);
  assert.equal(
    url.searchParams.get("redirect_uri"),
    `${origin}/api/auth/callback/${provider}`,
  );
  const scopes = url.searchParams.get("scope").split(" ").sort();
  assert.deepEqual(
    scopes,
    provider === "github" ? ["user:email"] : ["email", "openid", "profile"],
  );
  const completed = await callback(provider, jar, data.url, code);
  assert.equal(completed.status, 302);
  return { jar, completed, data: await identity(jar) };
}
async function counts() {
  return (await request("/__fixture/counts")).json();
}
async function check(name, run) {
  await run();
  evidence.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
await mkdir(output, { recursive: true });
await rm(join(root, "specs/2026-10-15-sign-in/evidence.json"), {
  force: true,
});
await rm(state, { recursive: true, force: true });
await writeFile(
  configPath,
  JSON.stringify({
    name: "hasaweb-auth-fixture-local",
    main: join(root, "apps/web/integration/auth-worker.ts"),
    compatibility_date: "2026-10-14",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    d1_databases: [
      {
        binding: "DB",
        database_name: "auth-fixture-local",
        database_id: "00000000-0000-0000-0000-000000000005",
      },
    ],
  }),
);
await writeFile(
  join(output, ".dev.vars"),
  `FIXTURE_SECRET=${randomBytes(32).toString("hex")}\n`,
  { mode: 0o600 },
);
await writeFile(
  join(output, "schema.sql"),
  (
    await Promise.all(
      (
        await readdir(join(root, "packages/db/migrations"))
      )
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) =>
          readFile(join(root, "packages/db/migrations", name), "utf8"),
        ),
    )
  ).join("\n"),
);
cli([
  "d1",
  "execute",
  "DB",
  "--local",
  "--config",
  configPath,
  "--persist-to",
  state,
  "--file",
  join(output, "schema.sql"),
]);
try {
  child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--config",
      configPath,
      "--persist-to",
      state,
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      logs = (logs + data).slice(-16000);
    });
  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try {
      const response = await request("/__fixture/counts");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await setTimeout(100);
  }
  assert.ok(ready, logs);
  let owner;
  await check(
    "GitHub verified sign-in and Google same-email linking",
    async () => {
      owner = await login("github", "shared");
      assert.ok(
        owner.data?.user?.id,
        `GitHub callback: ${owner.completed.headers.get("location")}`,
      );
      const google = await login("google", "shared");
      assert.ok(
        google.data?.user?.id,
        `Google callback: ${google.completed.headers.get("location")}`,
      );
      assert.equal(google.data.user.id, owner.data.user.id);
      assert.equal((await counts()).user, 1);
      assert.equal((await counts()).account, 2);
    },
  );
  await check("returning provider preserves account identity", async () => {
    assert.equal(
      (await login("github", "shared")).data.user.id,
      owner.data.user.id,
    );
  });
  await check("Google-first verified account links GitHub", async () => {
    const google = await login("google", "other");
    const github = await login("github", "other");
    assert.equal(google.data.user.id, github.data.user.id);
  });
  for (const provider of ["github", "google"]) {
    for (const code of ["unverified", "missing"]) {
      await check(`${provider} ${code} email cannot merge`, async () => {
        const before = await counts();
        const result = await login(provider, code);
        assert.equal(result.data, null);
        assert.ok(
          new URL(result.completed.headers.get("location")).searchParams.has(
            "error",
          ),
        );
        assert.deepEqual(await counts(), before);
      });
    }
  }
  await check(
    "verified incoming email cannot claim an unverified existing owner",
    async () => {
      await login("github", "freshUnverified");

      const before = await counts();
      const second = await login("google", "freshVerified");
      assert.equal(second.data, null);
      assert.deepEqual(await counts(), before);
    },
  );
  for (const mode of [
    "missing-state",
    "wrong-state",
    "no-cookie",
    "cancelled",
    "invalid-code",
  ]) {
    await check(`${mode} callback creates no account or session`, async () => {
      const jar = new Jar();
      const { data } = await begin("github", jar);
      const before = await counts();
      const params =
        mode === "missing-state"
          ? { state: "" }
          : mode === "wrong-state"
            ? { state: "wrong" }
            : mode === "cancelled"
              ? { error: "access_denied" }
              : {};
      const result = await callback(
        "github",
        mode === "no-cookie" ? new Jar() : jar,
        data.url,
        mode === "invalid-code" ? "invalid" : "shared",
        params,
      );
      assert.ok(
        new URL(result.headers.get("location")).searchParams.has("error"),
      );
      assert.equal(await identity(jar), null);
      assert.deepEqual(await counts(), before);
    });
  }
  await check("consumed OAuth state cannot be replayed", async () => {
    const jar = new Jar();
    const { data } = await begin("github", jar);
    const replay = jar.clone();
    await callback("github", jar, data.url, "shared");
    const before = await counts();
    const result = await callback("github", replay, data.url, "shared");
    assert.ok(
      new URL(result.headers.get("location")).searchParams.has("error"),
    );
    assert.equal(await identity(replay), null);
    assert.deepEqual(await counts(), before);
  });
  await check(
    "sibling origins and external callback destinations fail",
    async () => {
      for (const Origin of [
        "https://alice.hasaweb.site",
        "https://evil.example",
        "",
        "null",
      ]) {
        assert.equal(
          (
            await request(
              "/api/auth/sign-in/social",
              new Jar(),
              { provider: "github" },
              { Origin },
            )
          ).status,
          403,
        );
      }
      assert.equal(
        (
          await request(
            "/api/auth/sign-in/social",
            new Jar(),
            { provider: "github" },
            { "Content-Type": "text/plain" },
          )
        ).status,
        415,
      );
      const response = await request("/api/auth/sign-in/social", new Jar(), {
        provider: "google",
        callbackURL: "https://evil.example",
      });
      assert.equal(response.status, 403);
      assert.equal(
        (
          await request("/api/auth/get-session", owner.jar, undefined, {
            "X-Fixture-Host": "alice.hasaweb.site",
          })
        ).status,
        404,
      );
    },
  );
  await check(
    "D1 and cached sessions agree; sign-out invalidates D1",
    async () => {
      const jar = owner.jar.clone();
      assert.equal((await identity(jar)).user.id, owner.data.user.id);
      assert.equal(
        (await identity(jar, "?disableCookieCache=true")).user.id,
        owner.data.user.id,
      );
      const stolenCache = jar.clone();
      assert.equal((await request("/api/auth/sign-out", jar, {})).status, 200);
      assert.equal(await identity(jar), null);
      assert.equal(await identity(stolenCache), null);
      assert.equal(
        await identity(stolenCache, "?disableCookieCache=true"),
        null,
      );
    },
  );
  await check(
    "signed-out owner access and unsupported authentication endpoints fail",
    async () => {
      assert.equal((await request("/api/owner")).status, 401);
      for (const path of [
        "sign-up/email",
        "sign-in/email",
        "forget-password",
        "link-social",
        "unlink-account",
        "update-user",
        "delete-user",
      ]) {
        assert.equal(
          (await request(`/api/auth/${path}`, new Jar(), {})).status,
          404,
        );
      }
      for (const body of [
        null,
        [],
        { provider: "github", idToken: { token: "forged" } },
        { provider: "github", scopes: ["repo"] },
        { provider: "other" },
      ]) {
        const result = await fetch(
          `http://127.0.0.1:${port}/api/auth/sign-in/social`,
          {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        assert.equal(result.status, 400);
      }
    },
  );
  await check(
    "existing portfolio survives verified provider linking, cancellation, sign-out and retry",
    async () => {
      const first = await login("github", "explicit");
      assert.equal(
        (await request("/__fixture/portfolio", first.jar)).status,
        200,
      );
      const saved = await (await request("/api/owner", first.jar)).json();
      const second = await login("google", "explicit");
      assert.deepEqual(
        await (await request("/api/owner", second.jar)).json(),
        saved,
      );
      await request("/api/auth/sign-out", second.jar, {});
      assert.equal((await request("/api/owner", second.jar)).status, 401);
      const interrupted = await begin("google", second.jar);
      await callback("google", second.jar, interrupted.data.url, "explicit", {
        error: "access_denied",
      });
      assert.equal(await identity(second.jar), null);
      const retry = await login("google", "explicit", second.jar);
      assert.equal(retry.data.user.id, first.data.user.id);
      assert.deepEqual(
        await (await request("/api/owner", retry.jar)).json(),
        saved,
      );
      const countsAfter = await counts();
      assert.equal(countsAfter.portfolio, 1);
    },
  );
  await check(
    "expiry, deletion and copied cache cookies deny owner access",
    async () => {
      const expired = await login("github", "other");
      assert.equal(
        (await request("/__fixture/expire", expired.jar)).status,
        200,
      );
      assert.equal((await request("/api/owner", expired.jar)).status, 401);
      const retry = await login("google", "other", expired.jar);
      assert.equal(retry.data.user.id, expired.data.user.id);
      const deleting = await login("github", "shared");
      assert.equal(
        (await request("/__fixture/delete", deleting.jar)).status,
        200,
      );
      assert.equal((await request("/api/owner", deleting.jar)).status, 401);
      assert.equal(await identity(deleting.jar), null);
      assert.equal((await login("google", "shared")).data, null);
    },
  );
  await check(
    "auth and owner responses are no-store, noindex, with no account tokens",
    async () => {
      const signedIn = await login("github", "explicit");
      for (const path of ["/api/owner", "/api/auth/get-session"]) {
        for (const jar of [new Jar(), signedIn.jar]) {
          const response = await request(path, jar);
          assert.equal(
            response.headers.get("cache-control"),
            "private, no-store",
          );
          assert.equal(response.headers.get("x-robots-tag"), "noindex");
          assert.match(response.headers.get("vary"), /Cookie/);
          assert.doesNotMatch(
            await response.text(),
            /accessToken|refreshToken|session_token|email|deletingAt/,
          );
        }
      }
      assert.equal(
        (
          await request("/api/owner", signedIn.jar, undefined, {
            "X-Fixture-Host": "alice.hasaweb.site",
          })
        ).status,
        404,
      );
    },
  );
  await check(
    "Chromium enforces apex-only HTTPS cookies and rejects sibling injection",
    async () => {
      browserEvidence = await checkBrowserCookies([...cookieSamples.values()]);
    },
  );
  if (process.argv.includes("--browser")) {
    uiEvidence = await checkAuthUi({ root, wrangler, fixturePort: port });
    console.log(`PASS ${uiEvidence.checks.length} browser journey checks`);
  }
  await writeFile(
    join(root, "specs/2026-10-15-sign-in/evidence.json"),
    `${JSON.stringify(
      {
        runtime: "local workerd + D1",
        betterAuth: "1.7.7",
        checks: evidence,
        cookieNames: [...cookieNames].sort(),
        browserEvidence,
        uiEvidence,
        limitations: [
          "Provider HTTP responses are fixtures",
          "Browser cookie enforcement uses intercepted HTTPS responses; deployed TLS not verified",
          "Cached session revocation requires disableCookieCache or independent owner/deletion checks",
        ],
      },
      null,
      2,
    )}\n`,
  );
  console.log(`${evidence.length} checks passed`);
} catch (error) {
  // Never dump runtime logs here: provider/session data can appear in errors.
  console.error(error);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    process.kill(-child.pid, "SIGTERM");
    await Promise.race([exited, setTimeout(5000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid, "SIGKILL");
  }
  await rm(join(output, ".dev.vars"), { force: true });
  await rm(state, { recursive: true, force: true });
}
