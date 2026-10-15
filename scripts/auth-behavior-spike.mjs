import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { checkBrowserCookies } from "./auth-cookie-browser.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const output = join(root, ".wrangler/auth-behavior");
const state = join(output, "state");
const configPath = join(output, "wrangler.json");
const port = 8805;
const origin = "https://hasaweb.site";
const evidence = [];
const cookieNames = new Set();
const cookieSamples = new Map();
let browserEvidence;
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
      callbackURL: `${origin}/done`,
      errorCallbackURL: `${origin}/failed`,
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
  assert.equal(response.status, 200);
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
await rm(join(root, "specs/2026-10-15-auth-behavior/evidence.json"), {
  force: true,
});
await rm(state, { recursive: true, force: true });
await writeFile(
  configPath,
  JSON.stringify({
    name: "hasaweb-auth-fixture-local",
    main: join(root, "apps/web/spike/auth-fixture-worker.ts"),
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
  await readFile(join(root, "apps/web/spike/fixture.sql")),
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
      assert.equal((await counts()).spike_user, 1);
      assert.equal((await counts()).spike_account, 2);
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
      const first = await login("github", "freshUnverified");
      assert.equal(first.data.user.emailVerified, false);
      const before = await counts();
      const second = await login("google", "freshVerified");
      assert.equal(second.data, null);
      assert.deepEqual(await counts(), before);
    },
  );
  await check(
    "explicit linking requires an authenticated session",
    async () => {
      const result = await begin("google", new Jar(), true);
      assert.equal(result.response.status, 401);
    },
  );
  await check("explicit linking refuses a different email", async () => {
    const jar = owner.jar.clone();
    const before = await counts();
    const { data } = await begin("google", jar, true);
    const result = await callback("google", jar, data.url, "other");
    assert.ok(
      new URL(result.headers.get("location")).searchParams.has("error"),
    );
    assert.deepEqual(await counts(), before);
    assert.equal((await identity(jar)).user.id, owner.data.user.id);
  });
  await check(
    "successful explicit linking requires provider proof",
    async () => {
      const first = await login("github", "explicit");
      const jar = first.jar.clone();
      const before = await counts();
      const { data } = await begin("google", jar, true);
      const result = await callback("google", jar, data.url, "explicit");
      assert.equal(result.headers.get("location"), `${origin}/done`);
      assert.equal((await identity(jar)).user.id, first.data.user.id);
      assert.equal((await counts()).spike_account, before.spike_account + 1);
      assert.equal(
        (await login("google", "explicit")).data.user.id,
        first.data.user.id,
      );
    },
  );
  for (const provider of ["github", "google"]) {
    for (const code of ["unverified", "missing", "invalid"]) {
      await check(
        `explicit ${provider} linking rejects ${code} proof`,
        async () => {
          const jar = owner.jar.clone();
          const before = await counts();
          const { response, data } = await begin(provider, jar, true);
          assert.equal(response.status, 200);
          const result = await callback(provider, jar, data.url, code);
          assert.ok(
            new URL(result.headers.get("location")).searchParams.has("error"),
          );
          assert.deepEqual(await counts(), before);
          assert.equal((await identity(jar)).user.id, owner.data.user.id);
        },
      );
    }
  }
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
      assert.equal((await identity(stolenCache)).user.id, owner.data.user.id);
      assert.equal(
        await identity(stolenCache, "?disableCookieCache=true"),
        null,
      );
    },
  );
  await check(
    "Chromium enforces apex-only HTTPS cookies and rejects sibling injection",
    async () => {
      browserEvidence = await checkBrowserCookies([...cookieSamples.values()]);
    },
  );
  await writeFile(
    join(root, "specs/2026-10-15-auth-behavior/evidence.json"),
    `${JSON.stringify(
      {
        runtime: "local workerd + D1",
        betterAuth: "1.7.7",
        checks: evidence,
        cookieNames: [...cookieNames].sort(),
        browserEvidence,
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
