import {
  decryptActivityToken,
  projectPublishedActivity,
  type RefreshTicket,
} from "@hasaweb/github";
import { createEmptyDraft } from "@hasaweb/schema";
import {
  githubJobs,
  ownerGithub,
  pendingGitHubCleanups,
  runGitHubGrantCleanup,
} from "../src/github";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
}
function required<T>(value: T): NonNullable<T> {
  if (value == null) throw new Error("Expected a current GitHub record");
  return value as NonNullable<T>;
}
async function rejects(action: () => PromiseLike<unknown>) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error("Expected rejection");
}
const selected = { id: "github-fixture", login: "fixture-owner" };
const app = { id: "activity-fixture-app", secret: "fixture-app-secret" };
const calendar = (count: number) => ({
  days: [{ date: "2026-10-16", count }],
  fetchedAt: "2026-10-17T00:00:00Z",
});
const fixtureKey = () =>
  crypto.subtle.importKey(
    "raw",
    new Uint8Array(32).fill(17),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );

export async function runGitHubChecks(
  db: D1Database,
  check: (name: string, action: () => Promise<void>) => Promise<void>,
) {
  await check(
    "GitHub migration discards unknown legacy counts and quarantines credentials",
    async () => {
      const connection = required(
        await db
          .prepare(
            "SELECT * FROM github_connection WHERE portfolio_id='local-portfolio'",
          )
          .first(),
      );
      equal(connection.generation, 1);
      equal(connection.token_enc, null);
      equal(connection.private_enabled, 0);
      equal(connection.status, "needs_reconnect");
      const legacy = required(
        await db
          .prepare(
            "SELECT * FROM github_legacy_credential WHERE portfolio_id='local-portfolio'",
          )
          .first(),
      );
      equal(legacy.token_enc, "legacy-encrypted-fixture");
      const activity = required(
        await db
          .prepare(
            "SELECT * FROM github_activity WHERE portfolio_id='local-portfolio'",
          )
          .first(),
      );
      equal(activity.private_counts, null);
      equal(activity.authorized_calendar, null);
      equal(activity.public_calendar, null);
      equal(
        projectPublishedActivity(
          { ...selected, includePrivate: true },
          await githubJobs(db).servingState("local-portfolio"),
        )?.available,
        false,
      );
    },
  );
  const draft = JSON.stringify(
    createEmptyDraft({
      themeId: "default",
      fontId: "default",
      colorMode: "system",
    }),
  );
  for (const id of ["gh-a", "gh-b", "gh-legacy", "gh-durable", "gh-rejected"]) {
    await db.batch([
      db
        .prepare(
          "INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,?,?,1,1)",
        )
        .bind(id, id, `${id}@hasaweb.invalid`),
      db
        .prepare(
          "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,4102444800000,1,1)",
        )
        .bind(`session-${id}`, `token-${id}`, id),
      db
        .prepare(
          "INSERT INTO portfolio(id,user_id,draft,created_at,updated_at) VALUES(?,?,?,1,1)",
        )
        .bind(`portfolio-${id}`, id, draft),
    ]);
  }
  const a = ownerGithub(db, {
    user: { id: "gh-a" },
    session: { id: "session-gh-a" },
  });
  const b = ownerGithub(db, {
    user: { id: "gh-b" },
    session: { id: "session-gh-b" },
  });
  const jobs = githubJobs(db);
  await check(
    "GitHub unresolved legacy credentials block new private consent but allow public setup",
    async () => {
      const legacyOwner = ownerGithub(db, {
        user: { id: "gh-legacy" },
        session: { id: "session-gh-legacy" },
      });
      required(
        await legacyOwner.select(
          { id: "legacy-id", login: "legacy-fixture" },
          null,
        ),
      );
      equal(await legacyOwner.beginConsent(app.id, 1), null);
      equal(
        await jobs.refresh(
          required(await jobs.capture("portfolio-gh-legacy", "public")).ticket,
          { kind: "public", calendar: calendar(1) },
        ),
        true,
      );
    },
  );
  const key = await fixtureKey();
  let old: RefreshTicket;
  let operationId = "";
  await check(
    "GitHub selection is owner scoped and guarded by expected generation",
    async () => {
      equal(
        (
          await a.select(
            { ...selected, portfolioId: "portfolio-gh-b" } as typeof selected,
            null,
          )
        )?.portfolioId,
        "portfolio-gh-a",
      );
      equal(await b.getConnection(), undefined);
      equal(await b.getActivity(), undefined);
      equal(await a.select(selected, null), null);
      equal(await a.select({ id: "other", login: "other" }, 0), null);
      await b.select(selected, null);
      old = required(await jobs.capture("portfolio-gh-a", "public")).ticket;
      equal(
        await jobs.refresh(old, { kind: "public", calendar: calendar(2) }),
        true,
      );
    },
  );
  await check(
    "GitHub simultaneous owners can reserve only one consent for an app/account",
    async () => {
      const results = await Promise.all([
        a.beginConsent("concurrent-fixture-app", 1),
        b.beginConsent("concurrent-fixture-app", 1),
      ]);
      equal(results.filter(Boolean).length, 1);
      const lease = required(results[0] ?? results[1]);
      equal(await (results[0] ? a : b).cancelUnissuedConsent(lease), true);
    },
  );
  await check(
    "GitHub consent encrypts credentials and keeps activity independent of sign-in",
    async () => {
      const lease = required(await a.beginConsent(app.id, 1));
      operationId = lease.operationId;
      equal(await b.beginConsent(app.id, 1), null);
      const activated = required(
        await a.finishConsent(
          lease,
          key,
          "fixture-activity-secret",
          "read:user",
          lease.identity,
        ),
      );
      equal(activated.generation, 2);
      equal("tokenEnc" in activated, false);
      const captured = required(
        await jobs.capture("portfolio-gh-a", "authorized"),
      );
      equal(
        await decryptActivityToken(
          key,
          required(captured.tokenEnc),
          required(captured.tokenBinding),
        ),
        "fixture-activity-secret",
      );
      equal(
        required(captured.tokenEnc).includes("fixture-activity-secret"),
        false,
      );
      equal(
        (
          await db
            .prepare("SELECT count(*) AS n FROM account WHERE user_id='gh-a'")
            .first()
        )?.n,
        0,
      );
      old = captured.ticket;
      equal(
        await jobs.refresh(old, { kind: "authorized", calendar: calendar(7) }),
        true,
      );
      equal(
        await a.finishConsent(
          lease,
          key,
          "duplicate-issued-token",
          "read:user",
          lease.identity,
        ),
        null,
      );
      equal(await a.beginConsent(app.id, 1), null);
    },
  );
  await check(
    "GitHub publication selects one complete calendar and gates draft consent",
    async () => {
      const state = await jobs.servingState("portfolio-gh-a");
      equal(
        projectPublishedActivity({ ...selected, includePrivate: true }, state)
          ?.days,
        [{ date: "2026-10-16", count: 7 }],
      );
      equal(
        projectPublishedActivity({ ...selected, includePrivate: false }, state)
          ?.days,
        [{ date: "2026-10-16", count: 2 }],
      );
      equal(projectPublishedActivity(null, state), null);
      equal(
        projectPublishedActivity(
          { ...selected, id: "wrong", includePrivate: true },
          state,
        )?.available,
        false,
      );
      equal(
        projectPublishedActivity(
          { ...selected, login: "someone-else", includePrivate: true },
          state,
        )?.available,
        false,
      );
    },
  );
  await check(
    "GitHub rejected issued tokens persist for retry without changing the selected graph",
    async () => {
      const owner = ownerGithub(db, {
        user: { id: "gh-rejected" },
        session: { id: "session-gh-rejected" },
      });
      const identity = {
        id: "rejected-selection",
        login: "rejected-selection",
      };
      required(await owner.select(identity, null));
      const before = await a.getConnection();
      for (const rejected of [
        {
          identity: selected,
          scopes: "read:user",
          token: "wrong-account-issued-token",
        },
        { identity, scopes: "repo", token: "wrong-scope-issued-token" },
      ]) {
        const lease = required(await owner.beginConsent(app.id, 1));
        await rejects(() =>
          owner.finishConsent(
            lease,
            key,
            rejected.token,
            rejected.scopes,
            rejected.identity,
          ),
        );
        const stored = required(
          await db
            .prepare(
              "SELECT state,token_enc,token_binding FROM github_grant WHERE app_id=? AND github_user_id=?",
            )
            .bind(app.id, identity.id)
            .first<{
              state: string;
              token_enc: string;
              token_binding: string;
            }>(),
        );
        equal(stored.state, "pending");
        equal(stored.token_enc.includes(rejected.token), false);
        equal(JSON.parse(stored.token_binding)[3], rejected.identity.id);
        equal(
          await decryptActivityToken(
            key,
            stored.token_enc,
            stored.token_binding,
          ),
          rejected.token,
        );
        equal((await owner.getConnection())?.identity, identity);
        equal((await owner.getConnection())?.generation, 1);
        equal(await jobs.capture("portfolio-gh-rejected", "authorized"), null);
        equal(await owner.beginConsent(app.id, 1), null);
        const ticket = {
          appId: app.id,
          githubUserId: identity.id,
          operationId: lease.operationId,
        };
        let calls = 0;
        const transport = async (url: string, init: RequestInit) => {
          calls++;
          equal(url, `https://api.github.com/applications/${app.id}/token`);
          equal(JSON.parse(String(init.body)).access_token, rejected.token);
          return new Response(null, { status: calls === 1 ? 503 : 204 });
        };
        equal(
          await runGitHubGrantCleanup(db, ticket, key, app, transport, 1000),
          "retry",
        );
        equal(await owner.beginConsent(app.id, 1), null);
        equal(
          await runGitHubGrantCleanup(db, ticket, key, app, transport, 61_000),
          "deleted",
        );
        equal(calls, 2);
        equal(
          (
            await db
              .prepare(
                "SELECT token_enc FROM github_grant WHERE app_id=? AND github_user_id=?",
              )
              .bind(app.id, identity.id)
              .first()
          )?.token_enc,
          null,
        );
        const next = required(await owner.beginConsent(app.id, 1));
        equal(
          await runGitHubGrantCleanup(db, ticket, key, app, transport, 100_000),
          "skipped",
        );
        equal(calls, 2);
        equal(await owner.cancelUnissuedConsent(next), true);
      }
      equal(await a.getConnection(), before);
      equal(
        projectPublishedActivity(
          { ...selected, includePrivate: true },
          await jobs.servingState("portfolio-gh-a"),
        )?.days,
        calendar(7).days,
      );
    },
  );
  await check(
    "GitHub transient errors preserve calendar and platform failures never revoke owner access",
    async () => {
      equal(
        await jobs.refresh(old, {
          kind: "error",
          source: "authorized",
          error: "network",
        }),
        true,
      );
      equal(
        projectPublishedActivity(
          { ...selected, includePrivate: true },
          await jobs.servingState("portfolio-gh-a"),
        )?.days,
        calendar(7).days,
      );
      equal(
        await jobs.refresh(old, {
          kind: "error",
          source: "public",
          error: "credential",
        }),
        true,
      );
      equal((await a.getConnection())?.privateEnabled, true);
      equal(
        await jobs.refresh(old, {
          kind: "error",
          source: "public",
          error: "scope",
        }),
        true,
      );
      equal(
        projectPublishedActivity(
          { ...selected, includePrivate: false },
          await jobs.servingState("portfolio-gh-a"),
        )?.available,
        false,
      );
      equal(
        await jobs.refresh(old, { kind: "public", calendar: calendar(2) }),
        true,
      );
    },
  );
  await check(
    "GitHub withdrawal atomically disables active credentials and authorized output",
    async () => {
      required(await a.disconnect(2));
      equal(await jobs.capture("portfolio-gh-a", "authorized"), null);
      equal(
        (
          await db
            .prepare(
              "SELECT token_enc FROM github_connection WHERE portfolio_id='portfolio-gh-a'",
            )
            .first()
        )?.token_enc,
        null,
      );
      equal(
        (
          await db
            .prepare(
              "SELECT authorized_calendar FROM github_activity WHERE portfolio_id='portfolio-gh-a'",
            )
            .first()
        )?.authorized_calendar,
        null,
      );
      equal(
        projectPublishedActivity(
          { ...selected, includePrivate: true },
          await jobs.servingState("portfolio-gh-a"),
        )?.days,
        calendar(2).days,
      );
      equal((await a.getConnection())?.generation, 3);
      equal(
        (await pendingGitHubCleanups(db)).some(
          (ticket) => ticket.operationId === operationId,
        ),
        true,
      );
      equal((await a.cleanupStatus()).results[0]?.state, "pending");
    },
  );
  await check(
    "GitHub stale refresh successes and every error cannot restore withdrawn data",
    async () => {
      equal(
        await jobs.refresh(old, {
          kind: "authorized",
          calendar: calendar(999),
        }),
        false,
      );
      equal(
        await jobs.refresh(old, { kind: "public", calendar: calendar(999) }),
        false,
      );
      for (const error of [
        "credential",
        "scope",
        "identity",
        "network",
        "rate",
        "payload",
        "server",
      ] as const)
        for (const source of ["public", "authorized"] as const)
          equal(
            await jobs.refresh(old, { kind: "error", source, error }),
            false,
          );
      equal((await a.getConnection())?.generation, 3);
      equal(
        projectPublishedActivity(
          { ...selected, includePrivate: true },
          await jobs.servingState("portfolio-gh-a"),
        )?.days,
        calendar(2).days,
      );
    },
  );
  const cleanup = () => ({
    appId: app.id,
    githubUserId: selected.id,
    operationId,
  });
  await check(
    "GitHub failed grant cleanup is durable and blocks reconsent across owners",
    async () => {
      let calls = 0;
      equal(
        await runGitHubGrantCleanup(
          db,
          cleanup(),
          key,
          app,
          async (url, init) => {
            calls++;
            equal(url, `https://api.github.com/applications/${app.id}/grant`);
            equal(init.method, "DELETE");
            equal(
              JSON.parse(required(init.body as string)).access_token,
              "fixture-activity-secret",
            );
            return new Response("sensitive provider error", { status: 503 });
          },
          1000,
        ),
        "retry",
      );
      equal(calls, 1);
      const row = required(
        await db
          .prepare(
            "SELECT * FROM github_grant WHERE app_id=? AND github_user_id=?",
          )
          .bind(app.id, selected.id)
          .first(),
      );
      equal(row.state, "pending");
      equal(row.last_error, "retry");
      equal(typeof row.token_enc, "string");
      equal(
        JSON.stringify(await a.cleanupStatus()).includes("token_enc"),
        false,
      );
      equal(await a.beginConsent(app.id, 3), null);
      equal(await b.beginConsent(app.id, 1), null);
      // A failed old cleanup does not prevent public graph setup/refresh.
      equal(
        await jobs.refresh(
          required(await jobs.capture("portfolio-gh-a", "public")).ticket,
          { kind: "public", calendar: calendar(3) },
        ),
        true,
      );
      equal(
        await runGitHubGrantCleanup(
          db,
          cleanup(),
          key,
          app,
          async () => {
            throw new Error("must not run before retry time");
          },
          2000,
        ),
        "skipped",
      );
    },
  );
  await check(
    "GitHub one cleanup attempt owns the provider call while consent remains blocked",
    async () => {
      let enter: () => void = () => {};
      let finish: (value: Response) => void = () => {};
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const provider = new Promise<Response>((resolve) => {
        finish = resolve;
      });
      const running = runGitHubGrantCleanup(
        db,
        cleanup(),
        key,
        app,
        async () => {
          enter();
          return provider;
        },
        70_000,
      );
      await entered;
      equal(await a.beginConsent(app.id, 3), null);
      equal(
        await runGitHubGrantCleanup(
          db,
          cleanup(),
          key,
          app,
          async () => new Response(null, { status: 204 }),
          90_000_000,
        ),
        "skipped",
      );
      finish(new Response(null, { status: 204 }));
      equal(await running, "deleted");
      const row = required(
        await db
          .prepare(
            "SELECT * FROM github_grant WHERE app_id=? AND github_user_id=?",
          )
          .bind(app.id, selected.id)
          .first(),
      );
      equal(row.state, "idle");
      equal(row.token_enc, null);
      equal(row.token_binding, null);
    },
  );
  await check(
    "GitHub delayed old cleanup delivery and refresh errors cannot invalidate a fresh grant",
    async () => {
      const lease = required(await a.beginConsent(app.id, 3));
      const fresh = required(
        await a.finishConsent(
          lease,
          key,
          "fresh-fixture-secret",
          "read:user",
          lease.identity,
        ),
      );
      equal(fresh.generation, 4);
      let calls = 0;
      equal(
        await runGitHubGrantCleanup(
          db,
          cleanup(),
          key,
          app,
          async () => {
            calls++;
            return new Response(null, { status: 204 });
          },
          100_000,
        ),
        "skipped",
      );
      equal(calls, 0);
      equal(
        await jobs.refresh(old, {
          kind: "error",
          source: "authorized",
          error: "credential",
        }),
        false,
      );
      equal((await a.getConnection())?.privateEnabled, true);
      old = required(await jobs.capture("portfolio-gh-a", "authorized")).ticket;
      operationId = lease.operationId;
      equal(
        await jobs.refresh(old, { kind: "authorized", calendar: calendar(9) }),
        true,
      );
    },
  );
  await check(
    "GitHub current revocation errors withdraw only their generation and queue cleanup",
    async () => {
      equal(
        await jobs.refresh(old, {
          kind: "error",
          source: "authorized",
          error: "credential",
        }),
        true,
      );
      equal((await a.getConnection())?.status, "needs_reconnect");
      equal((await a.getConnection())?.generation, 5);
      equal(
        await jobs.refresh(old, {
          kind: "authorized",
          calendar: calendar(999),
        }),
        false,
      );
      equal(
        projectPublishedActivity(
          { ...selected, includePrivate: true },
          await jobs.servingState("portfolio-gh-a"),
        )?.days,
        calendar(3).days,
      );
      equal(
        await runGitHubGrantCleanup(
          db,
          cleanup(),
          key,
          app,
          async () => new Response(null, { status: 204 }),
        ),
        "deleted",
      );
    },
  );
  await check(
    "GitHub selection during consent queues a stale issued token without enabling it",
    async () => {
      const lease = required(await a.beginConsent(app.id, 5));
      required(
        await a.select({ id: "different-id", login: "different-login" }, 5),
      );
      equal(
        await a.finishConsent(
          lease,
          key,
          "stale-issued-token",
          "read:user",
          lease.identity,
        ),
        null,
      );
      equal((await a.getConnection())?.identity.login, "different-login");
      equal((await a.getConnection())?.privateEnabled, false);
      equal(
        projectPublishedActivity(
          { ...selected, includePrivate: true },
          await jobs.servingState("portfolio-gh-a"),
        )?.available,
        false,
      );
      equal(await b.beginConsent(app.id, 1), null);
      const row = required(
        await db
          .prepare(
            "SELECT state,token_enc FROM github_grant WHERE app_id=? AND github_user_id=?",
          )
          .bind(app.id, selected.id)
          .first(),
      );
      equal(row.state, "pending");
      equal(typeof row.token_enc, "string");
      operationId = lease.operationId;
      equal(
        await runGitHubGrantCleanup(
          db,
          cleanup(),
          key,
          app,
          async () => new Response(null, { status: 204 }),
        ),
        "deleted",
      );
    },
  );
  await check(
    "GitHub uncertain remote deletion never releases consent through clock expiry",
    async () => {
      const lease = required(await b.beginConsent(app.id, 1));
      required(
        await b.finishConsent(
          lease,
          key,
          "uncertain-token",
          "read:user",
          lease.identity,
        ),
      );
      required(await b.disconnect(2));
      operationId = lease.operationId;
      equal(
        await runGitHubGrantCleanup(db, cleanup(), key, app, async () => {
          throw new Error("connection lost");
        }),
        "uncertain",
      );
      equal(await b.beginConsent(app.id, 3), null);
      equal(
        await runGitHubGrantCleanup(
          db,
          cleanup(),
          key,
          app,
          async () => new Response(null, { status: 204 }),
          Date.now() + 365 * 86_400_000,
        ),
        "skipped",
      );
    },
  );
  await check(
    "GitHub an active username change withdraws the grant and rejects its late jobs",
    async () => {
      const generation = required(await a.getConnection()).generation;
      const lease = required(await a.beginConsent(app.id, generation));
      const activated = required(
        await a.finishConsent(
          lease,
          key,
          "username-change-token",
          "read:user",
          lease.identity,
        ),
      );
      const ticket = required(
        await jobs.capture("portfolio-gh-a", "authorized"),
      ).ticket;
      equal(
        await jobs.refresh(ticket, {
          kind: "authorized",
          calendar: calendar(20),
        }),
        true,
      );
      // An existing sign-in provider survives graph withdrawal and remote cleanup.
      await db
        .prepare(
          "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('gh-sign-in','sign-in-fixture','github','gh-a',1,1)",
        )
        .run();
      required(
        await a.select(
          { id: "third-id", login: "third-login" },
          activated.generation,
        ),
      );
      equal(
        await jobs.refresh(ticket, {
          kind: "authorized",
          calendar: calendar(999),
        }),
        false,
      );
      equal(
        await jobs.refresh(ticket, {
          kind: "error",
          source: "authorized",
          error: "credential",
        }),
        false,
      );
      equal((await a.getConnection())?.status, "disconnected");
      equal(
        projectPublishedActivity(
          { ...lease.identity, includePrivate: true },
          await jobs.servingState("portfolio-gh-a"),
        )?.available,
        false,
      );
      equal(
        await runGitHubGrantCleanup(
          db,
          {
            appId: app.id,
            githubUserId: lease.identity.id,
            operationId: lease.operationId,
          },
          key,
          app,
          async () => new Response(null, { status: 204 }),
        ),
        "deleted",
      );
      equal(
        (
          await db
            .prepare("SELECT count(*) AS n FROM account WHERE id='gh-sign-in'")
            .first()
        )?.n,
        1,
      );
    },
  );
  await check(
    "GitHub cancelled unissued consent and owner/session boundaries remain safe",
    async () => {
      const generation = required(await a.getConnection()).generation;
      const lease = required(await a.beginConsent(app.id, generation));
      equal(await b.cancelUnissuedConsent(lease), false);
      equal(await a.cancelUnissuedConsent(lease), true);
      equal(await a.cancelUnissuedConsent(lease), false);
      await rejects(() =>
        a.finishConsent(
          { ...lease, portfolioId: "portfolio-gh-b" },
          key,
          "token",
          "read:user",
          lease.identity,
        ),
      );
      await rejects(() =>
        a.finishConsent(lease, key, "token", "repo", lease.identity),
      );
      await rejects(() =>
        a.finishConsent(lease, key, "wrong-account-token", "read:user", {
          ...lease.identity,
          id: "wrong-id",
        }),
      );
      await db.prepare("DELETE FROM session WHERE id='session-gh-a'").run();
      equal(await a.getConnection(), undefined);
      equal(await a.getActivity(), undefined);
      await rejects(() => a.select(selected, generation));
      await rejects(() => a.disconnect(generation));
      await db.prepare("UPDATE user SET deleting_at=1 WHERE id='gh-b'").run();
      equal(await b.getConnection(), undefined);
      equal(await jobs.capture("portfolio-gh-b", "public"), null);
      equal(await jobs.servingState("portfolio-gh-b"), null);
    },
  );
  await check(
    "GitHub database guards reject legacy private writes and unversioned authorization",
    async () => {
      await rejects(() =>
        db
          .prepare(
            "UPDATE github_connection SET private_enabled=1 WHERE portfolio_id='portfolio-gh-a'",
          )
          .run(),
      );
      await rejects(() =>
        db
          .prepare(
            "UPDATE github_activity SET private_counts='[7]' WHERE portfolio_id='portfolio-gh-a'",
          )
          .run(),
      );
      await rejects(() =>
        db
          .prepare(
            "UPDATE github_activity SET generation=999 WHERE portfolio_id='portfolio-gh-a'",
          )
          .run(),
      );
    },
  );
  await check(
    "GitHub encrypted failed cleanup survives owner deletion for restart recovery",
    async () => {
      const owner = ownerGithub(db, {
        user: { id: "gh-durable" },
        session: { id: "session-gh-durable" },
      });
      required(
        await owner.select(
          { id: "durable-github-id", login: "durable-fixture" },
          null,
        ),
      );
      const lease = required(await owner.beginConsent(app.id, 1));
      required(
        await owner.finishConsent(
          lease,
          key,
          "durable-fixture-token",
          "read:user",
          lease.identity,
        ),
      );
      required(await owner.disconnect(2));
      await db.prepare("DELETE FROM user WHERE id='gh-durable'").run();
      equal(
        await runGitHubGrantCleanup(
          db,
          {
            appId: app.id,
            githubUserId: lease.identity.id,
            operationId: lease.operationId,
          },
          key,
          app,
          async () => new Response(null, { status: 503 }),
          1000,
        ),
        "retry",
      );
      const stored = required(
        await db
          .prepare(
            "SELECT portfolio_id,state,attempts FROM github_grant WHERE github_user_id='durable-github-id'",
          )
          .first(),
      );
      equal(stored.portfolio_id, null);
      equal(stored.state, "pending");
      equal(stored.attempts, 1);
    },
  );
}

export async function verifyGitHubRestart(db: D1Database) {
  const row = required(
    await db
      .prepare(
        "SELECT operation_id,state,portfolio_id FROM github_grant WHERE app_id=? AND github_user_id='durable-github-id'",
      )
      .bind(app.id)
      .first<{
        operation_id: string;
        state: string;
        portfolio_id: string | null;
      }>(),
  );
  equal(row.state, "pending");
  equal(row.portfolio_id, null);
  const outcome = await runGitHubGrantCleanup(
    db,
    {
      appId: app.id,
      githubUserId: "durable-github-id",
      operationId: row.operation_id,
    },
    await fixtureKey(),
    app,
    async (_url, init) => {
      equal(
        JSON.parse(String(init.body)).access_token,
        "durable-fixture-token",
      );
      return new Response(null, { status: 204 });
    },
  );
  const cleared = required(
    await db
      .prepare(
        "SELECT state,token_enc FROM github_grant WHERE app_id=? AND github_user_id='durable-github-id'",
      )
      .bind(app.id)
      .first(),
  );
  return {
    persisted: row.state,
    ownerRemoved: row.portfolio_id === null,
    retried: outcome === "deleted",
    tokenCleared: cleared.state === "idle" && cleared.token_enc === null,
  };
}
