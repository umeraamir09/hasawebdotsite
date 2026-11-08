import {
  type GitHubIdentity,
  pkceChallenge,
  projectPublishedActivity,
} from "@hasaweb/github";
import { createEmptyDraft } from "@hasaweb/schema";
import {
  githubJobs,
  ownerGithub,
  pendingGitHubCleanups,
  runGitHubGrantCleanup,
} from "../src/github";
import {
  CONSENT_EXCHANGE_DEADLINE_MS,
  choosePublicOnly,
  ownerPrivateActivity,
  releaseStaleReservation,
  withdrawPrivateActivity,
} from "../src/github-private";
import { ownerGraphSetup } from "../src/github-setup";

// Phase 41 private consent, recovery and withdrawal against real D1. GitHub is
// a fake that enforces PKCE, the redirect URI, per-token identity and scope,
// and grant-wide revocation, and records every call.

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
}
function ok(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const app = { id: "activity-app", secret: "activity-secret" };
const callbackUrl = "https://hasaweb.site/api/owner/github/consent/callback";
type Account = GitHubIdentity & { public: number; all: number };
// The grant coordinator is global per app/account, so each check uses its own.
const registry = new Map<string, Account>();
function account(login: string, counts = { public: 2, all: 9 }): Account {
  const value = { id: `node-${login.toLowerCase()}`, login, ...counts };
  registry.set(login.toLowerCase(), value);
  return value;
}
const platform = { id: "node-platform", login: "platform-account" };

function fakeGitHub() {
  type Code = {
    account: GitHubIdentity;
    challenge: string;
    redirect: string;
    scope: string;
  };
  const codes = new Map<string, Code>();
  const tokens = new Map<
    string,
    { account: GitHubIdentity; scope: string; valid: boolean }
  >();
  const calls: string[] = [];
  const control = {
    exchange: "ok" as "ok" | "throw",
    graphql: "ok" as "ok" | "503",
    deletion: "ok" as "ok" | "500" | "throw",
    // Runs inside the exchange, before the token is returned.
    duringExchange: null as null | (() => Promise<unknown>),
  };
  let issued = 0;
  async function transport(url: string, init: RequestInit) {
    const target = new URL(url);
    calls.push(`${init.method} ${target.host}${target.pathname}`);
    if (target.pathname === "/login/oauth/access_token") {
      if (control.exchange === "throw") throw new Error("offline");
      const body = init.body as URLSearchParams;
      const code = codes.get(body.get("code") ?? "");
      codes.delete(body.get("code") ?? "");
      if (
        !code ||
        body.get("client_id") !== app.id ||
        body.get("client_secret") !== app.secret ||
        body.get("redirect_uri") !== code.redirect ||
        (await pkceChallenge(body.get("code_verifier") ?? "")) !==
          code.challenge
      )
        return Response.json({ error: "bad_verification_code" });
      if (control.duringExchange) {
        const run = control.duringExchange;
        control.duringExchange = null;
        await run();
      }
      const token = `gho_fixture_${++issued}`;
      tokens.set(token, {
        account: code.account,
        scope: code.scope,
        valid: true,
      });
      return Response.json({ access_token: token, scope: code.scope });
    }
    const bearer = String(
      (init.headers as Record<string, string>).Authorization ?? "",
    ).replace(/^Bearer /, "");
    if (target.pathname === "/graphql") {
      const request = JSON.parse(String(init.body));
      const login = String(request.variables.login).toLowerCase();
      const user = registry.get(login);
      // The zero-scope platform credential used by public setup.
      if (bearer === "platform-token") {
        const headers = { "X-OAuth-Scopes": "" };
        if (!user)
          return Response.json(
            {
              data: { viewer: platform, user: null },
              errors: [{ type: "NOT_FOUND", path: ["user"] }],
            },
            { headers },
          );
        if (String(request.query).includes("ResolveLogin"))
          return Response.json(
            {
              data: {
                viewer: platform,
                user: { id: user.id, login: user.login },
              },
            },
            { headers },
          );
        const day = new Date(Date.parse(request.variables.from.slice(0, 10)))
          .toISOString()
          .slice(0, 10);
        return Response.json(
          {
            data: {
              viewer: platform,
              user: {
                id: user.id,
                login: user.login,
                contributionsCollection: {
                  restrictedContributionsCount: 0,
                  contributionCalendar: {
                    weeks: [
                      {
                        contributionDays: [
                          { date: day, contributionCount: user.public },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
          { headers },
        );
      }
      if (control.graphql === "503") return new Response("{}", { status: 503 });
      const grant = tokens.get(bearer);
      if (!grant?.valid) return new Response("{}", { status: 401 });
      const from = Date.parse(request.variables.from.slice(0, 10));
      return Response.json(
        {
          data: {
            viewer: { id: grant.account.id, login: grant.account.login },
            user: user
              ? {
                  id: user.id,
                  login: user.login,
                  contributionsCollection: {
                    restrictedContributionsCount: 0,
                    contributionCalendar: {
                      weeks: [
                        {
                          contributionDays: [
                            {
                              date: new Date(from).toISOString().slice(0, 10),
                              // The token's own account sees everything.
                              contributionCount:
                                user.id === grant.account.id
                                  ? user.all
                                  : user.public,
                            },
                          ],
                        },
                      ],
                    },
                  },
                }
              : null,
          },
        },
        { headers: { "X-OAuth-Scopes": grant.scope } },
      );
    }
    const application = /^\/applications\/([^/]+)\/(grant|token)$/.exec(
      target.pathname,
    );
    if (application) {
      const token = JSON.parse(String(init.body)).access_token as string;
      const grant = tokens.get(token);
      if (init.method === "POST")
        return new Response(null, { status: grant?.valid ? 200 : 404 });
      if (control.deletion === "throw") throw new Error("lost reply");
      if (control.deletion === "500")
        return new Response(null, { status: 500 });
      if (!grant?.valid) return new Response(null, { status: 404 });
      if (application[2] === "token") grant.valid = false;
      else
        for (const item of tokens.values())
          if (item.account.id === grant.account.id) item.valid = false;
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }
  /** The GitHub authorize page: approve as an account, or cancel. */
  function authorize(
    url: string,
    as: GitHubIdentity | "cancel",
    scope = "read:user",
  ) {
    const target = new URL(url);
    const state = target.searchParams.get("state");
    if (as === "cancel") return { state, code: null, error: "access_denied" };
    const code = `code-${codes.size}-${crypto.randomUUID()}`;
    codes.set(code, {
      account: as,
      challenge: target.searchParams.get("code_challenge") ?? "",
      redirect: target.searchParams.get("redirect_uri") ?? "",
      scope,
    });
    return { state, code, error: null };
  }
  const valid = (account: GitHubIdentity) =>
    [...tokens.values()].some(
      (item) => item.valid && item.account.id === account.id,
    );
  const revokeAll = (account: GitHubIdentity) => {
    for (const item of tokens.values())
      if (item.account.id === account.id) item.valid = false;
  };
  return { transport, authorize, calls, control, tokens, valid, revokeAll };
}

export async function runPrivateActivityChecks(
  db: D1Database,
  check: (name: string, action: () => Promise<void>) => Promise<void>,
) {
  const draft = JSON.stringify(
    createEmptyDraft({
      themeId: "default",
      fontId: "default",
      colorMode: "system",
    }),
  );
  async function makeOwner(id: string, sessions = [`session-${id}`]) {
    await db.batch([
      db
        .prepare(
          "INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,?,?,1,1)",
        )
        .bind(id, id, `${id}@hasaweb.invalid`),
      ...sessions.map((session) =>
        db
          .prepare(
            "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,4102444800000,1,1)",
          )
          .bind(session, `token-${session}`, id),
      ),
      db
        .prepare(
          "INSERT INTO portfolio(id,user_id,draft,created_at,updated_at) VALUES(?,?,?,1,1)",
        )
        .bind(`portfolio-${id}`, id, draft),
    ]);
    return { user: { id }, session: { id: sessions[0] as string } };
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(32).fill(41),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  let clock = Date.now();
  const jobs = githubJobs(db);
  const raw = (portfolioId: string) =>
    db
      .prepare(
        `SELECT c.generation,c.private_enabled,c.status,c.token_enc,c.login,c.github_user_id,
          a.authorized_calendar,a.public_calendar FROM github_connection c
          LEFT JOIN github_activity a ON a.portfolio_id=c.portfolio_id WHERE c.portfolio_id=?`,
      )
      .bind(portfolioId)
      .first<Record<string, unknown>>();
  const grant = (account: GitHubIdentity) =>
    db
      .prepare(
        "SELECT state,token_binding,provider_rejected,attempts FROM github_grant WHERE app_id=? AND github_user_id=?",
      )
      .bind(app.id, account.id)
      .first<{
        state: string;
        token_binding: string | null;
        provider_rejected: number;
        attempts: number;
      }>();
  const total = (graph: ReturnType<typeof projectPublishedActivity>) =>
    graph?.available
      ? graph.days.reduce((sum, day) => sum + day.count, 0)
      : null;

  /** A fresh owner with its own selected account and a public fetch. */
  async function prepared(id: string) {
    const identity = await makeOwner(id);
    const selected = account(`${id}-owner`);
    const other = account(`${id}-other`, { public: 1, all: 4 });
    const second = account(`${id}-second`, { public: 3, all: 3 });
    const github = fakeGitHub();
    const owner = ownerGithub(db, identity);
    const connection = await owner.select(
      { id: selected.id, login: selected.login },
      null,
    );
    ok(connection, "selection");
    await jobs.refresh(
      {
        portfolioId: connection.portfolioId,
        generation: connection.generation,
        identity: connection.identity,
      },
      {
        kind: "public",
        calendar: {
          days: [{ date: "2026-10-16", count: selected.public }],
          fetchedAt: new Date(clock).toISOString(),
        },
      },
      clock,
    );
    const env = {
      transport: github.transport,
      app,
      key,
      oauthOrigin: "https://github.com",
      callbackUrl,
      now: () => clock,
    };
    const service = ownerPrivateActivity(db, identity, env);
    const setup = ownerGraphSetup(db, identity, {
      transport: github.transport,
      platformToken: "platform-token",
      now: () => clock,
      activity: env,
    });
    // Only this check's accounts: other checks may leave due cleanups.
    const mine = new Set([selected.id, other.id, second.id]);
    const cleanup = async () => {
      const outcomes: string[] = [];
      for (const ticket of await pendingGitHubCleanups(db, clock, 100))
        if (ticket.appId === app.id && mine.has(ticket.githubUserId))
          outcomes.push(
            await runGitHubGrantCleanup(
              db,
              ticket,
              key,
              app,
              github.transport,
              clock,
            ),
          );
      return outcomes;
    };
    async function consent(
      as: GitHubIdentity | "cancel" = selected,
      scope?: string,
    ) {
      const started = await service.start("editor");
      ok(started.ok, `consent start ${JSON.stringify(started)}`);
      return {
        url: started.url,
        params: github.authorize(started.url, as, scope),
      };
    }
    return {
      identity,
      github,
      owner,
      service,
      setup,
      cleanup,
      consent,
      selected,
      other,
      second,
      portfolioId: connection.portfolioId,
    };
  }

  await check(
    "Private consent: one-use PKCE exchange enables only the matching account and Publish controls exposure",
    async () => {
      const t = await prepared("gh-private-ok");
      equal(await t.service.status(), { state: "off" });
      const { url, params } = await t.consent();
      const authorize = new URL(url);
      equal(
        authorize.origin + authorize.pathname,
        "https://github.com/login/oauth/authorize",
      );
      equal(authorize.searchParams.get("scope"), "read:user");
      equal(authorize.searchParams.get("code_challenge_method"), "S256");
      equal(authorize.searchParams.get("client_id"), app.id);
      equal(authorize.searchParams.get("redirect_uri"), callbackUrl);
      equal(authorize.searchParams.get("login"), t.selected.login);
      // The state is never stored; only its hash is.
      const stored = await db
        .prepare("SELECT state_hash FROM github_consent WHERE portfolio_id=?")
        .bind(t.portfolioId)
        .first<{ state_hash: string }>();
      ok(stored && stored.state_hash !== params.state, "state hash stored");
      equal(await t.service.status(), { state: "authorizing" });
      equal((await grant(t.selected))?.state, "consent");
      equal(await t.service.callback(params), {
        returnTo: "editor",
        outcome: "connected",
      });
      const row = await raw(t.portfolioId);
      equal(row?.private_enabled, 1);
      ok(
        typeof row?.token_enc === "string" &&
          !String(row.token_enc).includes("gho_"),
        "token encrypted",
      );
      equal((await t.service.status()).state, "ready");
      const status = await t.setup.status();
      equal(status.private, await t.service.status());
      equal(status.privateAvailable, true);
      // Owner preview follows the draft choice; public output the frozen one.
      equal(total(await t.setup.preview(false)), 2);
      equal(total(await t.setup.preview(true)), 9);
      const state = await jobs.servingState(t.portfolioId);
      const published = { id: t.selected.id, login: t.selected.login };
      equal(
        total(
          projectPublishedActivity(
            { ...published, includePrivate: false },
            state,
          ),
        ),
        2,
      );
      equal(
        total(
          projectPublishedActivity(
            { ...published, includePrivate: true },
            state,
          ),
        ),
        9,
      );
      // The calendar contains only dates and counts.
      equal(Object.keys(JSON.parse(String(row?.authorized_calendar))).sort(), [
        "days",
        "fetchedAt",
      ]);
      // Replaying the callback exchanges nothing and changes nothing.
      const exchanges = t.github.calls.filter((call) =>
        call.includes("access_token"),
      ).length;
      const generation = row?.generation;
      equal(await t.service.callback(params), {
        returnTo: "editor",
        outcome: "invalid",
      });
      equal(
        t.github.calls.filter((call) => call.includes("access_token")).length,
        exchanges,
      );
      equal((await raw(t.portfolioId))?.generation, generation);
      equal((await t.service.start("editor")).ok, false);
    },
  );

  await check(
    "Private consent rejects other owners, other sessions, forged and expired states without side effects",
    async () => {
      const t = await prepared("gh-private-bound");
      const intruder = await makeOwner("gh-private-intruder");
      const second = {
        user: t.identity.user,
        session: { id: "session-gh-private-bound-2" },
      };
      await db
        .prepare(
          "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,4102444800000,1,1)",
        )
        .bind(second.session.id, "token-second", t.identity.user.id)
        .run();
      const { params } = await t.consent();
      const env = {
        transport: t.github.transport,
        app,
        key,
        oauthOrigin: "https://github.com",
        callbackUrl,
        now: () => clock,
      };
      await ownerGithub(db, intruder).select(
        { id: t.other.id, login: t.other.login },
        null,
      );
      for (const identity of [intruder, second])
        equal(
          (await ownerPrivateActivity(db, identity, env).callback(params))
            .outcome,
          "invalid",
        );
      for (const state of [null, "x".repeat(43), `${params.state}x`])
        equal(
          (await t.service.callback({ ...params, state })).outcome,
          "invalid",
        );
      equal(t.github.calls.length, 0);
      equal(await t.service.status(), { state: "authorizing" });
      // After ten minutes the attempt can no longer be consumed and is released.
      clock += 10 * 60_000 + 1;
      equal(await t.service.status(), {
        state: "consent_failed",
        reason: "expired",
      });
      equal(await t.service.callback(params), {
        returnTo: "editor",
        outcome: "expired",
      });
      equal((await grant(t.selected))?.state, "idle");
      equal((await raw(t.portfolioId))?.private_enabled, 0);
      equal(t.github.calls.length, 0);
      // Retry works.
      const retried = await t.consent();
      equal((await t.service.callback(retried.params)).outcome, "connected");
    },
  );

  await check(
    "Cancelled consent keeps the public graph, releases the reservation and offers Retry and Public only",
    async () => {
      const t = await prepared("gh-private-cancel");
      const before = await raw(t.portfolioId);
      const { params } = await t.consent("cancel");
      equal(await t.service.callback(params), {
        returnTo: "editor",
        outcome: "cancelled",
      });
      equal((await grant(t.selected))?.state, "idle");
      equal(await t.service.status(), {
        state: "consent_failed",
        reason: "cancelled",
      });
      const after = await raw(t.portfolioId);
      equal(
        [after?.login, after?.generation, after?.public_calendar],
        [before?.login, before?.generation, before?.public_calendar],
      );
      equal((await t.setup.status()).public.state, "ready");
      // Retry starts a new attempt; Public only then clears it and the old link dies.
      const again = await t.consent();
      await choosePublicOnly(db, t.identity, clock);
      equal(await t.service.status(), { state: "off" });
      equal((await grant(t.selected))?.state, "idle");
      equal((await t.service.callback(again.params)).outcome, "invalid");
      equal((await raw(t.portfolioId))?.private_enabled, 0);
      // A superseded attempt never runs: a second start voids the first.
      const first = await t.consent();
      const latest = await t.consent();
      equal((await t.service.callback(first.params)).outcome, "invalid");
      equal((await t.service.callback(latest.params)).outcome, "connected");
    },
  );

  await check(
    "Wrong-account or wrong-scope consent never changes the selected user and revokes only that token",
    async () => {
      const t = await prepared("gh-private-wrong");
      const other = t.other;
      const { params } = await t.consent(other);
      equal(await t.service.callback(params), {
        returnTo: "editor",
        outcome: "wrong_account",
      });
      const row = await raw(t.portfolioId);
      equal(
        [row?.login, row?.private_enabled, row?.token_enc],
        [t.selected.login, 0, null],
      );
      equal(await t.service.status(), {
        state: "consent_failed",
        reason: "wrong_account",
      });
      const pending = await grant(t.selected);
      equal(pending?.state, "pending");
      // Retry waits until the issued token is revoked.
      equal(await t.service.start("editor"), {
        ok: false,
        error: "consent_busy",
      });
      equal(await t.cleanup(), ["deleted"]);
      ok(
        t.github.calls.some(
          (call) =>
            call === "DELETE api.github.com/applications/activity-app/token",
        ),
        "token-only revocation",
      );
      ok(
        !t.github.calls.some((call) => call.endsWith("/grant")),
        "no grant-wide revocation",
      );
      equal((await grant(t.selected))?.state, "idle");
      // A scope other than read:user is refused the same way.
      const scoped = await t.consent(t.selected, "read:user,repo");
      equal((await t.service.callback(scoped.params)).outcome, "scope");
      equal((await raw(t.portfolioId))?.private_enabled, 0);
      equal(await t.cleanup(), ["deleted"]);
      const right = await t.consent();
      equal((await t.service.callback(right.params)).outcome, "connected");
    },
  );

  await check(
    "Withdrawal removes private data at once despite racing jobs and failed revocation; reconnect waits for cleanup",
    async () => {
      const t = await prepared("gh-private-withdraw");
      const owner = t.selected;
      const first = await t.consent();
      equal((await t.service.callback(first.params)).outcome, "connected");
      const published = {
        id: owner.id,
        login: owner.login,
        includePrivate: true,
      };
      equal(
        total(
          projectPublishedActivity(
            published,
            await jobs.servingState(t.portfolioId),
          ),
        ),
        9,
      );
      const old = await jobs.capture(t.portfolioId, "authorized");
      ok(old, "authorized job");
      t.github.control.deletion = "500";
      equal(await withdrawPrivateActivity(db, t.identity, clock), true);
      // No Publish: the live projection is public-only immediately.
      equal(
        total(
          projectPublishedActivity(
            published,
            await jobs.servingState(t.portfolioId),
          ),
        ),
        2,
      );
      const row = await raw(t.portfolioId);
      equal(
        [row?.private_enabled, row?.token_enc, row?.authorized_calendar],
        [0, null, null],
      );
      ok(row?.public_calendar, "public calendar kept");
      // A racing old job cannot restore or disturb anything.
      equal(
        await jobs.refresh(old.ticket, {
          kind: "authorized",
          calendar: {
            days: [{ date: "2026-10-16", count: 99 }],
            fetchedAt: new Date(clock).toISOString(),
          },
        }),
        false,
      );
      equal(
        await jobs.refresh(old.ticket, {
          kind: "error",
          source: "authorized",
          error: "credential",
        }),
        false,
      );
      equal(
        total(
          projectPublishedActivity(
            published,
            await jobs.servingState(t.portfolioId),
          ),
        ),
        2,
      );
      // Failed remote revocation stays pending and blocks only new private consent.
      equal(await t.cleanup(), ["retry"]);
      ok(t.github.valid(owner), "token still valid at GitHub");
      equal(await t.service.start("editor"), {
        ok: false,
        error: "consent_busy",
      });
      equal(await t.service.status(), { state: "cleanup" });
      t.github.control.deletion = "ok";
      equal((await t.setup.setup(t.selected.login)).ok, true);
      equal((await grant(owner))?.state, "pending");
      equal(await t.cleanup(), []);
      clock += 61_000;
      const due = (await pendingGitHubCleanups(db, clock)).find(
        (item) => item.githubUserId === owner.id,
      );
      ok(due, "cleanup due");
      equal(await t.cleanup(), ["deleted"]);
      ok(!t.github.valid(owner), "revoked at GitHub");
      // New consent now succeeds, and the delayed duplicate cleanup cannot touch it.
      const second = await t.consent();
      equal((await t.service.callback(second.params)).outcome, "connected");
      equal(
        await runGitHubGrantCleanup(
          db,
          due,
          key,
          app,
          t.github.transport,
          clock + 120_000,
        ),
        "skipped",
      );
      ok(t.github.valid(owner), "fresh grant survives the old cleanup");
      equal((await t.service.status()).state, "ready");
    },
  );

  await check(
    "Access revoked on GitHub is withdrawn on refresh and released for reconnect only by the dead-token proof",
    async () => {
      const t = await prepared("gh-private-revoked");
      const owner = t.selected;
      const { params } = await t.consent();
      equal((await t.service.callback(params)).outcome, "connected");
      t.github.revokeAll(owner);
      clock += 60_000;
      equal(await t.service.refresh(), true);
      equal(await t.service.status(), { state: "reconnect" });
      const row = await raw(t.portfolioId);
      equal(
        [
          row?.private_enabled,
          row?.token_enc,
          row?.authorized_calendar,
          row?.status,
        ],
        [0, null, null, "needs_reconnect"],
      );
      equal((await grant(owner))?.provider_rejected, 1);
      equal(await t.cleanup(), ["gone"]);
      ok(
        t.github.calls.includes(
          "POST api.github.com/applications/activity-app/token",
        ),
        "token check",
      );
      equal((await grant(owner))?.state, "idle");
      equal((await grant(owner))?.provider_rejected, 0);
      const again = await t.consent();
      equal((await t.service.callback(again.params)).outcome, "connected");
      // An ordinary withdrawal whose delete is refused is never released by a 404.
      t.github.control.deletion = "ok";
      const token = [...t.github.tokens.entries()].find(
        ([, item]) => item.valid,
      )?.[0];
      ok(token, "active token");
      (t.github.tokens.get(token) as { valid: boolean }).valid = false;
      equal(await withdrawPrivateActivity(db, t.identity, clock), true);
      equal(await t.cleanup(), ["retry"]);
      equal((await grant(owner))?.state, "pending");
    },
  );

  await check(
    "Account changes, removal during exchange, unverified tokens and crashed callbacks stay fenced",
    async () => {
      const t = await prepared("gh-private-races");
      const owner = t.selected;
      // Selecting another account voids the pending attempt for the old one.
      const stale = await t.consent();
      clock += 11_000;
      const changed = await t.setup.setup(t.second.login);
      ok(
        changed.ok && changed.status.connection?.username === t.second.login,
        "second selection",
      );
      equal((await t.service.callback(stale.params)).outcome, "invalid");
      equal((await grant(owner))?.state, "idle");
      clock += 11_000;
      equal((await t.setup.setup(owner.login)).ok, true);
      // Removal while the code is being exchanged queues the issued token.
      const racing = await t.consent();
      t.github.control.duringExchange = () =>
        withdrawPrivateActivity(db, t.identity, clock);
      equal((await t.service.callback(racing.params)).outcome, "failed");
      equal((await raw(t.portfolioId))?.private_enabled, 0);
      equal((await grant(owner))?.state, "pending");
      equal(await t.cleanup(), ["deleted"]);
      ok(!t.github.valid(owner), "issued token revoked");
      // A token whose account cannot be verified is revoked, never enabled.
      t.github.control.graphql = "503";
      const unverified = await t.consent();
      equal((await t.service.callback(unverified.params)).outcome, "failed");
      t.github.control.graphql = "ok";
      equal((await raw(t.portfolioId))?.private_enabled, 0);
      ok(
        JSON.parse(String((await grant(owner))?.token_binding))[0].includes(
          "token-cleanup",
        ),
        "token-only binding",
      );
      equal(await t.cleanup(), ["deleted"]);
      // A session that ends while the code is exchanged makes finishConsent
      // throw after a token exists. That token is still queued and revoked,
      // and the attempt is finished, not left exchanging until the deadline.
      const ending = await t.consent();
      const expireSession = (at: number) =>
        db
          .prepare("UPDATE session SET expires_at=? WHERE id=?")
          .bind(at, t.identity.session.id)
          .run();
      t.github.control.duringExchange = () => expireSession(1);
      let threw = false;
      try {
        await t.service.callback(ending.params);
      } catch {
        threw = true;
      }
      ok(threw, "callback reports the ended session");
      await expireSession(4102444800000);
      equal((await raw(t.portfolioId))?.private_enabled, 0);
      equal((await grant(owner))?.state, "pending");
      ok(
        JSON.parse(String((await grant(owner))?.token_binding))[0].includes(
          "token-cleanup",
        ),
        "ended-session token is token-only",
      );
      equal(
        (
          await db
            .prepare(
              "SELECT state,outcome FROM github_consent WHERE portfolio_id=? ORDER BY created_at DESC LIMIT 1",
            )
            .bind(t.portfolioId)
            .first()
        )?.state,
        "finished",
      );
      equal(await t.cleanup(), ["deleted"]);
      ok(!t.github.valid(owner), "ended-session token revoked");
      // An exchange that settles without a token releases at once.
      t.github.control.exchange = "throw";
      const offline = await t.consent();
      equal((await t.service.callback(offline.params)).outcome, "failed");
      t.github.control.exchange = "ok";
      equal((await grant(owner))?.state, "idle");
      // A crashed callback keeps its reservation until the exchange deadline.
      const crashed = await t.consent();
      await db
        .prepare(
          "UPDATE github_consent SET state='exchanging',exchange_started_at=? WHERE portfolio_id=? AND state='issued'",
        )
        .bind(clock, t.portfolioId)
        .run();
      equal((await t.service.callback(crashed.params)).outcome, "invalid");
      equal(await t.service.start("editor"), {
        ok: false,
        error: "consent_busy",
      });
      equal(await t.service.status(), { state: "authorizing" });
      clock += CONSENT_EXCHANGE_DEADLINE_MS + 1;
      equal(await t.service.status(), {
        state: "consent_failed",
        reason: "interrupted",
      });
      const recovered = await t.consent();
      equal((await t.service.callback(recovered.params)).outcome, "connected");
      // Public-only setup and status stay available throughout.
      equal((await t.setup.status()).public.state, "ready");
    },
  );

  await check(
    "Stranded consent reservations are released only when no attempt can still exchange",
    async () => {
      const t = await prepared("gh-private-stranded");
      const owner = t.selected;
      // A start that crashed after reserving and before storing its attempt.
      const ticket = await t.owner.beginConsent(
        app.id,
        (await t.owner.getConnection())?.generation ?? 0,
      );
      ok(ticket, "reservation");
      equal((await grant(owner))?.state, "consent");
      const first = await t.consent();
      equal((await t.service.callback(first.params)).outcome, "connected");
      equal(await withdrawPrivateActivity(db, t.identity, clock), true);
      equal(await t.cleanup(), ["deleted"]);

      // Another owner's abandoned attempt for the same account blocks only
      // until it expires; then the second owner can authorize.
      const rival = await makeOwner("gh-private-rival");
      await ownerGithub(db, rival).select(
        { id: owner.id, login: owner.login },
        null,
      );
      const rivalService = ownerPrivateActivity(db, rival, {
        transport: t.github.transport,
        app,
        key,
        oauthOrigin: "https://github.com",
        callbackUrl,
        now: () => clock,
      });
      const abandoned = await t.consent();
      equal(await rivalService.start("editor"), {
        ok: false,
        error: "consent_busy",
      });
      equal(await releaseStaleReservation(db, app.id, owner.id, clock), false);
      clock += 10 * 60_000 + 1;
      const taken = await rivalService.start("editor");
      ok(taken.ok, "rival consent after expiry");
      // The released attempt can never be consumed, even by its own owner.
      equal((await t.service.callback(abandoned.params)).outcome, "expired");
      equal((await grant(owner))?.state, "consent");
      const params = t.github.authorize(taken.url, owner);
      equal((await rivalService.callback(params)).outcome, "connected");
      equal((await raw("portfolio-gh-private-rival"))?.private_enabled, 1);
      equal((await raw(t.portfolioId))?.private_enabled, 0);

      // A consume that arrives after its reservation was released fails
      // whatever its clock says.
      await withdrawPrivateActivity(db, rival, clock);
      equal(await t.cleanup(), ["deleted"]);
      const late = await t.consent();
      await db
        .prepare(
          "UPDATE github_grant SET state='idle' WHERE app_id=? AND github_user_id=?",
        )
        .bind(app.id, owner.id)
        .run();
      equal((await t.service.callback(late.params)).outcome, "invalid");
      equal(
        t.github.calls.filter((call) => call.includes("access_token")).length,
        2,
      );
    },
  );
}
