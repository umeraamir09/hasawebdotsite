import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

// A local stand-in for the GitHub endpoints the graph services call: the
// public GraphQL reads with the platform credential, and (Phase 41) the
// activity app's authorize page, PKCE token exchange, owner-token GraphQL and
// grant/token revocation. It enforces the credentials and answers with the
// envelopes the production code parses. No test sees a real token or account.
export const PLATFORM_TOKEN = "platform-fixture-token";
export const ACTIVITY_CLIENT_ID = "activity-fixture-client";
export const ACTIVITY_CLIENT_SECRET = "activity-fixture-secret";
// Base64 of 32 bytes: the local AES-GCM key for stored activity tokens.
export const ACTIVITY_KEY = Buffer.alloc(32, 41).toString("base64");
const platform = { id: "platform-node", login: "platform-account" };
const basic = `Basic ${Buffer.from(`${ACTIVITY_CLIENT_ID}:${ACTIVITY_CLIENT_SECRET}`).toString("base64")}`;

export async function startGitHubFixture(port) {
  const users = new Map();
  const codes = new Map();
  const tokens = new Map();
  // `consent.as` approves as that login (default: the suggested `login`);
  // `consent.cancel` answers access_denied; `consent.hold` keeps the browser
  // on a GitHub page and stores the callback URL in `held`, so a check can
  // deliver it later, twice, or from another session. `callbackOrigin` stands
  // in for the browser origin in front of the app (the harness proxies it).
  // `revokeFailure` answers grant/token deletion with that status, and
  // `activityFailure` only the calendar read (the account still resolves).
  const state = {
    failure: null,
    activityFailure: null,
    calls: [],
    consent: { as: null, cancel: false, hold: false },
    held: null,
    callbackOrigin: null,
    revokeFailure: null,
  };
  function addUser({
    login,
    id = `node-${login.toLowerCase()}`,
    databaseId,
    restricted = 0,
    counts = {},
    privateCounts = {},
  }) {
    users.set(login.toLowerCase(), {
      login,
      id,
      databaseId: databaseId ?? users.size + 1000,
      restricted,
      counts,
      privateCounts,
    });
    return users.get(login.toLowerCase());
  }
  // What the token's own account sees: public and private contributions.
  function authorizedCounts(user) {
    const all = { ...user.counts };
    for (const [date, count] of Object.entries(user.privateCounts))
      all[date] = (all[date] ?? 0) + count;
    return all;
  }
  function weeks(range, counts) {
    const out = [];
    const end = Date.parse(range.to.slice(0, 10));
    let week = [];
    for (let at = Date.parse(range.from.slice(0, 10)); at <= end; at += 864e5) {
      const date = new Date(at).toISOString().slice(0, 10);
      week.push({ date, contributionCount: counts[date] ?? 0 });
      if (new Date(at).getUTCDay() === 6) {
        out.push({ contributionDays: week });
        week = [];
      }
    }
    if (week.length) out.push({ contributionDays: week });
    return out;
  }
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const send = (status, value, scopes = "") => {
        response.writeHead(status, {
          "Content-Type": "application/json",
          "X-OAuth-Scopes": scopes,
        });
        response.end(JSON.stringify(value));
      };
      const authorized =
        request.headers.authorization === `Bearer ${PLATFORM_TOKEN}`;
      const url = new URL(request.url, "http://fixture");
      if (
        url.pathname === "/login/oauth/authorize" &&
        request.method === "GET"
      ) {
        const query = Object.fromEntries(url.searchParams);
        state.calls.push({ kind: "authorize", login: query.login });
        if (
          query.client_id !== ACTIVITY_CLIENT_ID ||
          query.scope !== "read:user" ||
          query.code_challenge_method !== "S256" ||
          !query.code_challenge ||
          !query.state ||
          !query.redirect_uri
        ) {
          response.writeHead(400).end("invalid authorize request");
          return;
        }
        const target = new URL(query.redirect_uri);
        const destination = new URL(
          target.pathname,
          state.callbackOrigin ?? target.origin,
        );
        if (state.consent.cancel)
          destination.search = new URLSearchParams({
            error: "access_denied",
            state: query.state,
          }).toString();
        else {
          const code = randomBytes(12).toString("hex");
          codes.set(code, {
            login: state.consent.as ?? query.login,
            challenge: query.code_challenge,
            redirect: query.redirect_uri,
          });
          destination.search = new URLSearchParams({
            code,
            state: query.state,
          }).toString();
        }
        if (state.consent.hold) {
          state.held = destination.toString();
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end("<!doctype html><title>GitHub</title><p>Authorize</p>");
          return;
        }
        response.writeHead(302, { Location: destination.toString() });
        response.end();
        return;
      }
      if (
        url.pathname === "/login/oauth/access_token" &&
        request.method === "POST"
      ) {
        const form = new URLSearchParams(body);
        const code = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        state.calls.push({ kind: "exchange", ok: Boolean(code) });
        const challenge = createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url");
        if (
          !code ||
          form.get("client_id") !== ACTIVITY_CLIENT_ID ||
          form.get("client_secret") !== ACTIVITY_CLIENT_SECRET ||
          form.get("redirect_uri") !== code.redirect ||
          challenge !== code.challenge
        )
          return send(200, { error: "bad_verification_code" });
        const token = `gho_fixture_${randomBytes(8).toString("hex")}`;
        tokens.set(token, { login: code.login.toLowerCase(), valid: true });
        return send(200, {
          access_token: token,
          scope: "read:user",
          token_type: "bearer",
        });
      }
      const application = /^\/applications\/([^/]+)\/(grant|token)$/.exec(
        url.pathname,
      );
      if (application) {
        const token = JSON.parse(body || "{}").access_token;
        const grant = tokens.get(token);
        state.calls.push({
          kind: `${request.method.toLowerCase()}-${application[2]}`,
          login: grant?.login,
        });
        if (
          application[1] !== ACTIVITY_CLIENT_ID ||
          request.headers.authorization !== basic
        )
          return send(401, {});
        if (request.method === "POST")
          return send(grant?.valid ? 200 : 404, {});
        if (request.method !== "DELETE") return send(404, {});
        if (state.revokeFailure) return send(state.revokeFailure, {});
        if (!grant?.valid) return send(404, {});
        if (application[2] === "token") grant.valid = false;
        else
          for (const item of tokens.values())
            if (item.login === grant.login) item.valid = false;
        response.writeHead(204).end();
        return;
      }
      const owner = tokens.get(
        (request.headers.authorization ?? "").replace(/^Bearer /, ""),
      );
      if (owner && url.pathname === "/graphql" && request.method === "POST") {
        const input = JSON.parse(body || "{}");
        state.calls.push({ kind: "authorized", login: input.variables?.login });
        if (!owner.valid) return send(401, { message: "Bad credentials" });
        const viewer = users.get(owner.login);
        const user = users.get(String(input.variables?.login).toLowerCase());
        if (!viewer || !user)
          return send(
            200,
            {
              data: {
                viewer: viewer && { id: viewer.id, login: viewer.login },
                user: null,
              },
              errors: [{ type: "NOT_FOUND", path: ["user"] }],
            },
            "read:user",
          );
        return send(
          200,
          {
            data: {
              viewer: { id: viewer.id, login: viewer.login },
              user: {
                id: user.id,
                login: user.login,
                contributionsCollection: {
                  restrictedContributionsCount: 0,
                  contributionCalendar: {
                    weeks: weeks(
                      input.variables,
                      viewer.id === user.id
                        ? authorizedCounts(user)
                        : user.counts,
                    ),
                  },
                },
              },
            },
          },
          "read:user",
        );
      }
      if (url.pathname === "/graphql" && request.method === "POST") {
        const input = JSON.parse(body || "{}");
        const kind = String(input.query).includes("ResolveLogin")
          ? "resolve"
          : "activity";
        const login = String(input.variables?.login ?? "");
        state.calls.push({ kind, login, authorized });
        if (!authorized) return send(401, { message: "Bad credentials" });
        if (state.failure) return send(state.failure, {});
        if (state.activityFailure && kind === "activity")
          return send(state.activityFailure, {});
        const user = users.get(login.toLowerCase());
        if (!user)
          return send(200, {
            data: { viewer: platform, user: null },
            errors: [{ type: "NOT_FOUND", path: ["user"] }],
          });
        if (kind === "resolve")
          return send(200, {
            data: {
              viewer: platform,
              user: { id: user.id, login: user.login },
            },
          });
        return send(200, {
          data: {
            viewer: platform,
            user: {
              id: user.id,
              login: user.login,
              contributionsCollection: {
                restrictedContributionsCount: user.restricted,
                contributionCalendar: {
                  weeks: weeks(input.variables, user.counts),
                },
              },
            },
          },
        });
      }
      const byId = /^\/user\/(\d+)$/.exec(url.pathname);
      if (byId && request.method === "GET") {
        state.calls.push({ kind: "user", id: byId[1], authorized });
        if (!authorized) return send(401, {});
        const user = [...users.values()].find(
          (item) => String(item.databaseId) === byId[1],
        );
        return user
          ? send(200, { id: user.databaseId, login: user.login, type: "User" })
          : send(404, {});
      }
      send(404, {});
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${port}`,
    addUser,
    state,
    users,
    tokens,
    // Revokes every token of an account, as removing the app on GitHub does.
    revokeAll(login) {
      for (const item of tokens.values())
        if (item.login === login.toLowerCase()) item.valid = false;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
