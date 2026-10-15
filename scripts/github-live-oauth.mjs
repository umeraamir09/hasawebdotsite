import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const local = join(root, ".wrangler/github-live");
const origin = "http://localhost:3000";
const callbackPaths = {
  signin: "/api/auth/callback/github",
  activity: "/api/github/callback",
};
const scopeFor = { signin: "user:email", activity: "read:user" };
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const random = () => randomBytes(32).toString("base64url");
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const scopeList = (value) =>
  String(value ?? "")
    .split(/[ ,]+/)
    .filter(Boolean)
    .sort();
const sameScopes = (value, expected) => scopeList(value).join() === expected;

export function exchangeFailure(ok, grant, expectedScope) {
  if (!grant || typeof grant !== "object" || Array.isArray(grant))
    return "oauth_invalid_response";
  if (grant.error) {
    const allowed = [
      "incorrect_client_credentials",
      "redirect_uri_mismatch",
      "bad_verification_code",
      "unverified_user_email",
      "access_denied",
      "unsupported_grant_type",
    ];
    return allowed.includes(grant.error)
      ? `oauth_${grant.error}`
      : "oauth_provider_error";
  }
  if (!ok) return "oauth_http_error";
  if (typeof grant.access_token !== "string" || !grant.access_token)
    return "oauth_missing_access_token";
  if (!sameScopes(grant.scope, expectedScope)) return "oauth_scope_mismatch";
  return null;
}

export function createPending(kind, ownerId, now = Date.now()) {
  const verifier = random();
  return {
    kind,
    ownerId,
    verifier,
    state: random(),
    expires: now + 600_000,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}
export function consumePending(session, kind, state, now = Date.now()) {
  const pending = session.pending;
  if (
    !pending ||
    pending.kind !== kind ||
    pending.expires < now ||
    !equal(pending.state, state) ||
    pending.ownerId !== (session.signin?.identity.id ?? null)
  )
    throw new Error("invalid_callback");
  delete session.pending;
  return pending;
}
export function acceptsMutation(headers, csrf, expected) {
  return (
    headers.origin === origin &&
    headers["content-type"]?.split(";")[0] ===
      "application/x-www-form-urlencoded" &&
    equal(csrf, expected)
  );
}

export async function startLiveServer() {
  const config = parseEnv(
    await readFile(join(root, ".env.github-spike.local"), "utf8"),
  );
  const keys = [
    "GITHUB_SIGN_IN_CLIENT_ID",
    "GITHUB_SIGN_IN_CLIENT_SECRET",
    "GITHUB_ACTIVITY_CLIENT_ID",
    "GITHUB_ACTIVITY_CLIENT_SECRET",
    "GITHUB_TEST_USERNAME",
  ];
  if (keys.some((key) => !config[key]))
    throw new Error("missing_local_configuration");
  if (config.GITHUB_SIGN_IN_CLIENT_ID === config.GITHUB_ACTIVITY_CLIENT_ID)
    throw new Error("separate_oauth_apps_required");
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(config.GITHUB_TEST_USERNAME))
    throw new Error("invalid_test_username");
  await mkdir(local, { recursive: true, mode: 0o700 });
  const require = createRequire(import.meta.url);
  const wranglerRequire = createRequire(
    require.resolve("wrangler/package.json"),
  );
  const modulePath = join(local, "permissions.mjs");
  await wranglerRequire("esbuild").build({
    entryPoints: [join(root, "packages/github/spike/permissions.ts")],
    outfile: modulePath,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const policy = await import(pathToFileURL(modulePath).href);
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const sessions = new Map();
  const events = [];
  // Preserve completed provider observations across local server restarts.
  try {
    const previous = JSON.parse(
      await readFile(
        join(root, "specs/2026-10-15-github-permissions/live-evidence.json"),
        "utf8",
      ),
    );
    if (!Array.isArray(previous.events))
      throw new Error("invalid_saved_evidence");
    events.push(...previous.events);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const credentials = (kind) => ({
    id: config[
      kind === "signin"
        ? "GITHUB_SIGN_IN_CLIENT_ID"
        : "GITHUB_ACTIVITY_CLIENT_ID"
    ],
    secret:
      config[
        kind === "signin"
          ? "GITHUB_SIGN_IN_CLIENT_SECRET"
          : "GITHUB_ACTIVITY_CLIENT_SECRET"
      ],
  });
  async function evidence(event) {
    events.push({ at: new Date().toISOString(), ...event });
    await writeFile(
      join(root, "specs/2026-10-15-github-permissions/live-evidence.json"),
      `${JSON.stringify(
        {
          runtime: "isolated Node.js loopback OAuth harness",
          events,
          limitations: [
            "Local HTTP harness does not verify production Better Auth cookies or callbacks",
            "Same contribution account used for public and private observations; platform identity remains separate",
            "Known contribution accuracy and visibility settings require owner confirmation",
            "Production refresh scheduling and CDN purge are not exercised",
          ],
        },
        null,
        2,
      )}\n`,
    );
    console.log(`LIVE ${event.check}: ${event.outcome}`);
  }
  async function api(url, token, init = {}) {
    return fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "hasaweb-s6-local",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  }
  async function user(token) {
    const response = await api("https://api.github.com/user", token);
    if (!response.ok) throw new Error("identity_request_failed");
    const data = await response.json();
    if (typeof data.node_id !== "string" || typeof data.login !== "string")
      throw new Error("invalid_provider_identity");
    return {
      identity: { id: data.node_id, login: data.login },
      scopes: response.headers.get("x-oauth-scopes"),
    };
  }
  async function decrypt(session, kind) {
    return policy.decryptToken(
      key,
      session[kind].encrypted,
      `${session.id}:${kind}`,
    );
  }
  function form(session, path, label, extra = "") {
    return `<form method="post" action="${path}"><input type="hidden" name="csrf" value="${session.csrf}">${extra}<button>${label}</button></form>`;
  }
  function page(session) {
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GitHub permission test</title><body>
      <h1>GitHub permission test</h1><p>Local S-6 test for ${escapeHtml(config.GITHUB_TEST_USERNAME)}. Tokens remain encrypted in server memory and disappear when this process stops.</p>
      <p>${escapeHtml(session.message ?? "Start by authorizing sign-in.")}</p>
      ${form(session, "/authorize/signin", "1. Authorize sign-in, user:email")}
      ${session.signin ? form(session, "/authorize/activity", "2. Authorize private activity, read:user", '<p><label><input type="checkbox" name="consent" value="yes" required> I authorize this matching account and understand visitors would see anonymized contribution counts.</label></p>') : ""}
      ${session.signin ? form(session, "/probe", "3. Fetch and compare contribution calendars") : ""}
      ${session.activity ? form(session, "/disconnect", "4. Disconnect activity and revoke the activity test app grant") : ""}
      <p>To test external revocation, remove only the activity app at <a href="https://github.com/settings/applications" rel="noreferrer">GitHub Authorized OAuth Apps</a>, then fetch again.</p>
      <p>Private contribution visibility on GitHub can affect these results. Change it only yourself, then fetch again.</p>
      <pre>${escapeHtml(JSON.stringify(session.summary ?? {}, null, 2))}</pre>
      ${session.calendar ? `<details><summary>Inspect anonymized authorized calendar</summary><pre>${escapeHtml(JSON.stringify(session.calendar, null, 2))}</pre></details>` : ""}
      </body></html>`;
  }
  async function probe(session) {
    const now = new Date();
    const start = new Date(now);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    start.setUTCHours(0, 0, 0, 0);
    const range = { from: start.toISOString(), to: now.toISOString() };
    const observations = {};
    for (const kind of ["signin", "activity"]) {
      if (!session[kind]) continue;
      const token = await decrypt(session, kind);
      const response = await api("https://api.github.com/graphql", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: policy.QUERY,
          variables: { login: config.GITHUB_TEST_USERNAME, ...range },
        }),
      });
      if (response.status === 401 && kind === "activity") {
        session.state = policy.withdraw(session.state, "needs_reconnect");
        delete session.activity;
        delete session.calendar;
        await evidence({
          check: "external_activity_revocation",
          outcome: "detected_401_private_data_removed",
        });
        observations.activity = { status: 401, privateRemoved: true };
        continue;
      }
      if (!response.ok) throw new Error("calendar_request_failed");
      const data = await response.clone().json();
      if (data.errors || !data.data?.user)
        throw new Error("calendar_graphql_failed");
      const target = data.data.user;
      if (
        !policy.matches(
          { id: target.id, login: target.login },
          session.signin.identity,
        )
      )
        throw new Error("calendar_identity_mismatch");
      const collection = target.contributionsCollection;
      const days = collection.contributionCalendar.weeks.flatMap((week) =>
        week.contributionDays.map((day) => ({
          date: day.date,
          count: day.contributionCount,
        })),
      );
      const observation = {
        status: response.status,
        scopes: scopeList(response.headers.get("x-oauth-scopes")),
        restrictedCount: collection.restrictedContributionsCount,
        days: days.length,
        total: days.reduce((sum, day) => sum + day.count, 0),
        calendarHash: createHash("sha256")
          .update(JSON.stringify(days))
          .digest("hex"),
      };
      if (kind === "activity") {
        try {
          const calendar = await policy.fetchCalendar(
            async () => response.clone(),
            token,
            session.signin.identity,
            range,
            true,
            now.toISOString(),
          );
          session.state = policy.applyRefresh(
            session.state,
            session.state.generation,
            calendar,
          );
          session.calendar = await policy.publicResponse(session.state).json();
          observation.adapterAccepted = true;
        } catch (error) {
          if (!(error instanceof policy.ProviderError)) throw error;
          session.state = policy.applyRefresh(
            session.state,
            session.state.generation,
            error,
          );
          if (error.kind === "reconnect") {
            delete session.activity;
            delete session.calendar;
          }
          await evidence({ check: "activity_adapter", outcome: error.kind });
          throw new Error("calendar_request_failed");
        }
      }
      observations[kind] = observation;
      await evidence({
        check: `${kind}_calendar`,
        outcome: "observed",
        ...observation,
      });
    }
    session.summary = observations;
    session.message =
      "Contribution observations recorded. Compare the private calendar with known activity. No repository details were requested.";
  }
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'",
    );
    // no-referrer makes Chromium send Origin: null on native form POSTs.
    // same-origin preserves the exact Origin check without leaking callback
    // query strings to GitHub or other external destinations.
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.headers.host !== "localhost:3000") {
      response.writeHead(404).end();
      return;
    }
    const url = new URL(request.url, origin);
    const cookie = request.headers.cookie
      ?.split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith("s6_session="))
      ?.slice(11);
    let session = sessions.get(cookie);
    if (!session) {
      if (url.pathname !== "/" || request.method !== "GET") {
        response.writeHead(403).end("Start at localhost:3000 in this browser.");
        return;
      }
      if (sessions.size >= 20) {
        response.writeHead(429).end();
        return;
      }
      session = { id: random(), csrf: random() };
      sessions.set(session.id, session);
      response.setHeader(
        "Set-Cookie",
        `s6_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
      );
    }
    try {
      const kind = Object.keys(callbackPaths).find(
        (name) => callbackPaths[name] === url.pathname,
      );
      if (kind && request.method === "GET") {
        const pending = consumePending(
          session,
          kind,
          url.searchParams.get("state"),
        );
        if (url.searchParams.has("error")) {
          await evidence({ check: `${kind}_consent`, outcome: "cancelled" });
          session.message = "Authorization cancelled. No new grant was saved.";
        } else {
          const code = url.searchParams.get("code");
          if (!code) throw new Error("missing_code");
          const app = credentials(kind);
          const exchanged = await fetch(
            "https://github.com/login/oauth/access_token",
            {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(20_000),
              headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                client_id: app.id,
                client_secret: app.secret,
                code,
                redirect_uri: `${origin}${callbackPaths[kind]}`,
                code_verifier: pending.verifier,
              }),
            },
          );
          const grant = await exchanged.json();
          const failure = exchangeFailure(exchanged.ok, grant, scopeFor[kind]);
          if (failure) {
            await evidence({
              check: `${kind}_token_exchange`,
              outcome: failure,
              status: exchanged.status,
              requestedScopes: [scopeFor[kind]],
              recognizedGrantedScopes: scopeList(grant?.scope).filter((scope) =>
                [
                  "read:user",
                  "user:email",
                  "user",
                  "repo",
                  "public_repo",
                ].includes(scope),
              ),
            });
            throw new Error(failure);
          }
          const proven = await user(grant.access_token);
          if (
            !sameScopes(proven.scopes, scopeFor[kind]) ||
            proven.identity.login.toLowerCase() !==
              config.GITHUB_TEST_USERNAME.toLowerCase() ||
            (kind === "activity" &&
              !policy.matches(proven.identity, session.signin.identity))
          )
            throw new Error("authorized_account_or_scope_mismatch");
          const encrypted = await policy.encryptToken(
            key,
            grant.access_token,
            `${session.id}:${kind}`,
          );
          session[kind] = { encrypted, identity: proven.identity };
          if (kind === "signin") {
            delete session.activity;
            delete session.calendar;
            delete session.summary;
            session.state = {
              selected: proven.identity,
              generation: (session.state?.generation ?? 0) + 1,
              enabled: false,
              grant: null,
              tokenEnc: null,
              status: "disconnected",
              publicCalendar: null,
              authorizedCalendar: null,
              error: null,
            };
          } else
            session.state = policy.enable(
              session.state,
              true,
              proven.identity,
              grant.scope,
              encrypted,
            );
          await evidence({
            check: `${kind}_authorization`,
            outcome: "matching_account_authorized",
            requestedScopes: [scopeFor[kind]],
            grantedScopes: scopeList(grant.scope),
            pkce: "S256",
          });
          session.message = `${kind === "signin" ? "Sign-in" : "Private activity"} authorized for the matching test account.`;
        }
        response.writeHead(303, { Location: "/" }).end();
        return;
      }
      if (request.method === "POST") {
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 4096) throw new Error("request_too_large");
        }
        const fields = new URLSearchParams(body);
        if (!acceptsMutation(request.headers, fields.get("csrf"), session.csrf))
          throw new Error("invalid_origin_or_csrf");
        if (url.pathname.startsWith("/authorize/")) {
          const kind = url.pathname.slice("/authorize/".length);
          if (!Object.hasOwn(callbackPaths, kind))
            throw new Error("unknown_provider_flow");
          if (
            kind === "activity" &&
            (!session.signin || fields.get("consent") !== "yes")
          )
            throw new Error("signin_and_consent_required");
          const pending = createPending(
            kind,
            session.signin?.identity.id ?? null,
          );
          session.pending = pending;
          const authorize = new URL("https://github.com/login/oauth/authorize");
          authorize.search = new URLSearchParams({
            client_id: credentials(kind).id,
            redirect_uri: `${origin}${callbackPaths[kind]}`,
            scope: scopeFor[kind],
            state: pending.state,
            code_challenge: pending.challenge,
            code_challenge_method: "S256",
            login: config.GITHUB_TEST_USERNAME,
            allow_signup: "false",
          }).toString();
          response.writeHead(303, { Location: authorize.href }).end();
          return;
        }
        if (!session.signin) throw new Error("signin_required");
        if (url.pathname === "/probe") await probe(session);
        else if (url.pathname === "/disconnect" && session.activity) {
          const token = await decrypt(session, "activity");
          session.state = policy.withdraw(session.state);
          delete session.activity;
          delete session.calendar;
          delete session.summary;
          const app = credentials("activity");
          const revoked = await fetch(
            `https://api.github.com/applications/${encodeURIComponent(app.id)}/grant`,
            {
              method: "DELETE",
              redirect: "error",
              signal: AbortSignal.timeout(20_000),
              headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": "hasaweb-s6-local",
                Authorization: `Basic ${Buffer.from(`${app.id}:${app.secret}`).toString("base64")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ access_token: token }),
            },
          );
          await evidence({
            check: "activity_grant_deletion",
            outcome:
              revoked.status === 204 ? "revoked" : "provider_retry_needed",
            status: revoked.status,
          });
          if (revoked.status === 204) {
            const invalid = await api("https://api.github.com/user", token);
            const stillSignedIn = await user(await decrypt(session, "signin"));
            await evidence({
              check: "independent_signin_after_activity_revoke",
              outcome:
                invalid.status === 401 &&
                policy.matches(stillSignedIn.identity, session.signin.identity)
                  ? "passed"
                  : "failed",
              activityTokenStatus: invalid.status,
            });
          }
          session.message =
            revoked.status === 204
              ? "Activity grant revoked; private data removed. Sign-in was checked independently."
              : "Local private access removed. Provider revocation failed; remove the activity app manually in GitHub settings.";
        } else throw new Error("unknown_action");
        response.writeHead(303, { Location: "/" }).end();
        return;
      }
      if (request.method !== "GET" || url.pathname !== "/") {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(page(session));
    } catch (error) {
      // Error text can contain OAuth codes, tokens, or provider payloads. Never log it.
      const safe = [
        "invalid_callback",
        "invalid_origin_or_csrf",
        "signin_and_consent_required",
        "authorized_account_or_scope_mismatch",
        "token_exchange_or_scope_failed",
        "oauth_incorrect_client_credentials",
        "oauth_redirect_uri_mismatch",
        "oauth_bad_verification_code",
        "oauth_unverified_user_email",
        "oauth_access_denied",
        "oauth_unsupported_grant_type",
        "oauth_provider_error",
        "oauth_http_error",
        "oauth_missing_access_token",
        "oauth_scope_mismatch",
        "oauth_invalid_response",
        "calendar_graphql_failed",
        "calendar_request_failed",
        "identity_request_failed",
      ].includes(error.message)
        ? error.message
        : "request_failed";
      session.message = `Test could not finish: ${safe}. Retry from this page.`;
      console.log(`LIVE request: ${safe}`);
      response.writeHead(303, { Location: "/" }).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(3000, "127.0.0.1", resolve);
  });
  console.log(`GitHub live permission test ready at ${origin}`);
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startLiveServer().catch(() => {
    console.error(
      "Live harness could not start. Check local configuration and port 3000. No secrets were logged.",
    );
    process.exitCode = 1;
  });
}
