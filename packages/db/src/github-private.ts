import {
  activityAuthorizeUrl,
  authorizedRefreshResult,
  CONSENT_TTL_MS,
  consentStateHash,
  exchangeActivityCode,
  fetchAuthorizedActivity,
  type GitHubTransport,
  hasActivityScope,
  isConsentValue,
  lastYearRange,
  parseCalendar,
  pkceChallenge,
  randomConsentValue,
  sameIdentity,
} from "@hasaweb/github";
import {
  type ConsentTicket,
  githubJobs,
  ownerGithub,
  pendingGitHubCleanups,
  runGitHubGrantCleanup,
} from "./github";
import { refreshAuthorizedCalendar } from "./github-refresh";
import type { SessionIdentity } from "./repositories";

// Private GitHub activity for the signed-in owner (Phase 41). It adds the
// separate activity OAuth app to the Phase 11D coordinator: consent reserves
// the app/account in `github_grant` before any code exchange, and every
// release of that reservation must be provably safe.
//
// A reservation is released only when one of these holds:
// - The attempt was still `issued` and is moved to `void` with a
//   compare-and-set. The callback consumes with the same compare-and-set, so a
//   voided attempt can never start an exchange.
// - The callback itself exchanged the code and the exchange settled without
//   delivering a token. No token reached this adapter and none can later.
// - A crashed callback left the attempt `exchanging`, and longer than the
//   GitHub code lifetime plus the exchange timeout has passed.
// - No attempt for the reservation is usable any more (none was stored, or
//   every one is expired, finished, void or past that deadline).
// A delivered token is never dropped: it is enabled, or queued for revocation.

export type ActivityApp = { id: string; secret: string };
export type PrivateEnvironment = {
  transport: GitHubTransport;
  app: ActivityApp;
  key: CryptoKey;
  // https://github.com, or a local fixture.
  oauthOrigin: string;
  // `${APP_ORIGIN}/api/owner/github/consent/callback`, registered on the app.
  callbackUrl: string;
  now?: () => number;
};
export type ConsentReturn = "editor";

/** Past GitHub's ten-minute code lifetime and the ten-second exchange timeout. */
export const CONSENT_EXCHANGE_DEADLINE_MS = 15 * 60_000;

export type ConsentFailure =
  | "cancelled"
  | "wrong_account"
  | "scope"
  | "failed"
  | "expired"
  | "interrupted";
export type ConsentOutcome = ConsentFailure | "connected" | "invalid";

export type PrivateState =
  | { state: "off" }
  | { state: "authorizing" }
  | { state: "consent_failed"; reason: ConsentFailure }
  // Earlier access is still being revoked at GitHub. New consent waits.
  | { state: "cleanup" }
  // GitHub refused the stored access. Private data is already withdrawn.
  | { state: "reconnect" }
  | { state: "pending" }
  | {
      state: "ready";
      fetchedAt: string;
      total: number;
      lastError: "retry" | "invalid" | null;
    }
  | { state: "error"; kind: "retry" | "invalid" };

type ConsentRow = {
  state_hash: string;
  user_id: string | null;
  session_id: string;
  portfolio_id: string | null;
  app_id: string;
  github_user_id: string;
  login: string;
  operation_id: string;
  generation: number;
  verifier: string;
  return_to: ConsentReturn;
  state: "issued" | "exchanging" | "finished" | "void";
  outcome: string | null;
  created_at: number;
  expires_at: number;
  exchange_started_at: number | null;
};

const FAILURES = new Set<string>([
  "cancelled",
  "wrong_account",
  "scope",
  "failed",
  "expired",
  "interrupted",
]);
const TRANSIENT = new Set(["credential", "rate", "server", "network"]);
const owned = `SELECT p.id FROM portfolio p JOIN user u ON u.id=p.user_id JOIN session s ON s.user_id=u.id
  WHERE u.id=? AND s.id=? AND s.expires_at>? AND u.deleting_at IS NULL`;

const ticketOf = (row: ConsentRow): ConsentTicket => ({
  portfolioId: row.portfolio_id ?? "",
  appId: row.app_id,
  operationId: row.operation_id,
  generation: row.generation,
  identity: { id: row.github_user_id, login: row.login },
});

/**
 * Voids this owner's unused consent attempts and attempts left `exchanging`
 * by a crashed callback, then releases their reservations. Selecting another
 * account, Public only, withdrawal and a new consent all call this first.
 */
export async function releaseUnusedConsent(
  db: D1Database,
  identity: SessionIdentity,
  now = Date.now(),
  onlyStateHash?: string,
) {
  const values = [identity.user.id, identity.session.id, Date.now()];
  // SET expressions read the row as it was before this update.
  const voided = await db
    .prepare(
      `UPDATE github_consent SET state='void', verifier='',
        outcome=CASE WHEN state='exchanging' THEN 'interrupted' WHEN expires_at<=? THEN 'expired' ELSE 'superseded' END
      WHERE portfolio_id IN (${owned})
        AND (state='issued' OR (state='exchanging' AND exchange_started_at<=?))
        ${onlyStateHash ? "AND state_hash=? AND expires_at<=?" : ""}
      RETURNING *`,
    )
    .bind(
      now,
      ...values,
      now - CONSENT_EXCHANGE_DEADLINE_MS,
      ...(onlyStateHash ? [onlyStateHash, now] : []),
    )
    .all<ConsentRow>();
  const owner = ownerGithub(db, identity);
  for (const row of voided.results)
    await owner.cancelUnissuedConsent(ticketOf(row));
  return voided.results.length;
}

/**
 * Releases a `consent` reservation for one app/account that no attempt can
 * still use: no attempt row is `issued` and unexpired, and none is
 * `exchanging` within the deadline. Needs no owner session, so a crashed
 * start, a lost cancel or another owner's abandoned attempt cannot block the
 * account forever. Each condition is one statement, so it is serialized with
 * the attempt insert and the callback's compare-and-set.
 */
export async function releaseStaleReservation(
  db: D1Database,
  appId: string,
  githubUserId: string,
  now = Date.now(),
) {
  const result = await db
    .prepare(
      `UPDATE github_grant SET state='idle'
      WHERE app_id=? AND github_user_id=? AND state='consent'
        AND NOT EXISTS(SELECT 1 FROM github_consent c
          WHERE c.app_id=github_grant.app_id AND c.operation_id=github_grant.operation_id
            AND ((c.state='issued' AND c.expires_at>?)
              OR (c.state='exchanging' AND c.exchange_started_at>?)))`,
    )
    .bind(appId, githubUserId, now, now - CONSENT_EXCHANGE_DEADLINE_MS)
    .run();
  return result.meta.changes === 1;
}

/**
 * Withdraws private access now, without Publish: the generation advances,
 * active credentials and authorized data are cleared and the grant is queued
 * for revocation at GitHub. The public selection stays. Needs no activity app
 * configuration, so removal always works.
 */
export async function withdrawPrivateActivity(
  db: D1Database,
  identity: SessionIdentity,
  now = Date.now(),
): Promise<boolean> {
  const owner = ownerGithub(db, identity);
  await releaseUnusedConsent(db, identity, now);
  for (let attempt = 0; attempt < 3; attempt++) {
    const connection = await owner.getConnection();
    if (!connection) return true;
    // A concurrent consent or selection advanced the generation. Re-read.
    if (await owner.disconnect(connection.generation)) return true;
  }
  return false;
}

/** Public only: clears an unfinished or failed private request. */
export async function choosePublicOnly(
  db: D1Database,
  identity: SessionIdentity,
  now = Date.now(),
) {
  await releaseUnusedConsent(db, identity, now);
  await db
    .prepare(
      `UPDATE github_consent SET outcome='public_only'
      WHERE portfolio_id IN (${owned}) AND state IN ('finished','void')
        AND outcome IN ('cancelled','wrong_account','scope','failed','expired','interrupted')`,
    )
    .bind(identity.user.id, identity.session.id, Date.now())
    .run();
}

/** Runs due remote revocations for the configured activity app. */
export async function runGitHubCleanups(
  db: D1Database,
  env: { app: ActivityApp; key: CryptoKey; transport: GitHubTransport },
  now = Date.now(),
  limit = 10,
) {
  const outcomes: string[] = [];
  for (const ticket of await pendingGitHubCleanups(db, now, limit)) {
    // Another app's credentials cannot revoke this grant. Leave it pending.
    if (ticket.appId !== env.app.id) continue;
    outcomes.push(
      await runGitHubGrantCleanup(
        db,
        ticket,
        env.key,
        env.app,
        env.transport,
        now,
      ),
    );
  }
  return outcomes;
}

function calendarState(
  value: unknown,
  error: string | null,
): PrivateState | null {
  const kind = error ? (TRANSIENT.has(error) ? "retry" : "invalid") : null;
  let calendar: ReturnType<typeof parseCalendar> | null = null;
  try {
    calendar =
      typeof value === "string" ? parseCalendar(JSON.parse(value)) : null;
  } catch {
    calendar = null;
  }
  if (calendar)
    return {
      state: "ready",
      fetchedAt: calendar.fetchedAt,
      total: calendar.days.reduce((sum, day) => sum + day.count, 0),
      lastError: kind,
    };
  return kind ? { state: "error", kind } : null;
}

export function ownerPrivateActivity(
  db: D1Database,
  identity: SessionIdentity,
  env: PrivateEnvironment,
) {
  const owner = ownerGithub(db, identity);
  const jobs = githubJobs(db);
  const now = () => env.now?.() ?? Date.now();
  const ownerValues = () => [identity.user.id, identity.session.id, Date.now()];

  async function finish(hash: string, outcome: ConsentOutcome) {
    await db
      .prepare(
        `UPDATE github_consent SET state='finished', outcome=?, verifier=''
        WHERE state_hash=? AND state='exchanging'`,
      )
      .bind(outcome, hash)
      .run();
    return outcome;
  }

  /** The private part of the owner's graph status. */
  async function status(): Promise<PrivateState> {
    const connection = await owner.getConnection();
    if (!connection) return { state: "off" };
    if (connection.privateEnabled && connection.status === "ok") {
      const activity = await owner.getActivity();
      const current =
        activity && activity.generation === connection.generation
          ? calendarState(
              activity.authorized_calendar,
              activity.authorized_error as string | null,
            )
          : null;
      return current ?? { state: "pending" };
    }
    if (connection.status === "needs_reconnect") return { state: "reconnect" };
    const latest = await db
      .prepare(
        `SELECT state,outcome,expires_at,exchange_started_at FROM github_consent
        WHERE portfolio_id IN (${owned}) AND generation=? AND github_user_id=?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .bind(...ownerValues(), connection.generation, connection.identity.id)
      .first<
        Pick<
          ConsentRow,
          "state" | "outcome" | "expires_at" | "exchange_started_at"
        >
      >();
    if (latest?.state === "issued" && latest.expires_at > now())
      return { state: "authorizing" };
    if (latest?.state === "issued")
      return { state: "consent_failed", reason: "expired" };
    if (latest?.state === "exchanging")
      return (latest.exchange_started_at ?? 0) >
        now() - CONSENT_EXCHANGE_DEADLINE_MS
        ? { state: "authorizing" }
        : { state: "consent_failed", reason: "interrupted" };
    if (
      (latest?.state === "finished" || latest?.state === "void") &&
      latest.outcome &&
      FAILURES.has(latest.outcome)
    )
      return {
        state: "consent_failed",
        reason: latest.outcome as ConsentFailure,
      };
    if ((await owner.cleanupStatus()).results.length)
      return { state: "cleanup" };
    return { state: "off" };
  }

  return {
    status,
    /**
     * Starts consent for the selected account and returns GitHub's authorize
     * URL. The browser navigates there in the same tab.
     */
    async start(
      returnTo: ConsentReturn,
    ): Promise<
      | { ok: true; url: string }
      | { ok: false; error: "no_graph" | "already_authorized" | "consent_busy" }
    > {
      const connection = await owner.getConnection();
      if (!connection) return { ok: false, error: "no_graph" };
      if (connection.privateEnabled && connection.status === "ok")
        return { ok: false, error: "already_authorized" };
      await releaseUnusedConsent(db, identity, now());
      await releaseStaleReservation(
        db,
        env.app.id,
        connection.identity.id,
        now(),
      );
      // Waits for pending or in-flight cleanup of the same app/account and for
      // any other owner's live reservation, and refuses unreconciled legacy tokens.
      const ticket = await owner.beginConsent(
        env.app.id,
        connection.generation,
      );
      if (!ticket) return { ok: false, error: "consent_busy" };
      const state = randomConsentValue();
      const verifier = randomConsentValue();
      const at = now();
      let stored = false;
      try {
        const inserted = await db
          .prepare(
            `INSERT INTO github_consent(state_hash,user_id,session_id,portfolio_id,app_id,github_user_id,login,
              operation_id,generation,verifier,return_to,state,created_at,expires_at)
            SELECT ?,?,?,?,?,?,?,?,?,?,?,'issued',?,? WHERE ? IN (${owned})
            AND EXISTS(SELECT 1 FROM github_grant g WHERE g.app_id=? AND g.github_user_id=?
              AND g.operation_id=? AND g.state='consent')`,
          )
          .bind(
            await consentStateHash(state),
            identity.user.id,
            identity.session.id,
            ticket.portfolioId,
            ticket.appId,
            ticket.identity.id,
            ticket.identity.login,
            ticket.operationId,
            ticket.generation,
            verifier,
            returnTo,
            at,
            at + CONSENT_TTL_MS,
            ticket.portfolioId,
            ...ownerValues(),
            ticket.appId,
            ticket.identity.id,
            ticket.operationId,
          )
          .run();
        stored = inserted.meta.changes === 1;
      } catch (error) {
        // Nothing was handed to the browser, so no exchange can start.
        await releaseStaleReservation(
          db,
          ticket.appId,
          ticket.identity.id,
          now(),
        );
        throw error;
      }
      // The session ended or the reservation was released meanwhile. No
      // state reached the browser, so no exchange can start from it.
      if (!stored) {
        await releaseStaleReservation(
          db,
          ticket.appId,
          ticket.identity.id,
          now(),
        );
        return { ok: false, error: "consent_busy" };
      }
      return {
        ok: true,
        url: activityAuthorizeUrl({
          oauthOrigin: env.oauthOrigin,
          clientId: env.app.id,
          redirectUri: env.callbackUrl,
          state,
          challenge: await pkceChallenge(verifier),
          login: ticket.identity.login,
        }),
      };
    },
    /**
     * Completes a consent callback for this exact owner session. Replayed,
     * expired, other-owner and other-session states change nothing.
     */
    async callback(params: {
      state: string | null;
      code: string | null;
      error: string | null;
    }): Promise<{ returnTo: ConsentReturn; outcome: ConsentOutcome }> {
      const fallback = {
        returnTo: "editor" as const,
        outcome: "invalid" as const,
      };
      if (!isConsentValue(params.state)) return fallback;
      const hash = await consentStateHash(params.state);
      const at = now();
      // A released reservation can never be consumed, whatever the clock.
      const row = await db
        .prepare(
          `UPDATE github_consent SET state='exchanging', exchange_started_at=?
          WHERE state_hash=? AND state='issued' AND expires_at>? AND user_id=? AND session_id=?
            AND portfolio_id IN (${owned})
            AND EXISTS(SELECT 1 FROM github_grant g WHERE g.app_id=github_consent.app_id
              AND g.github_user_id=github_consent.github_user_id
              AND g.operation_id=github_consent.operation_id AND g.state='consent')
          RETURNING *`,
        )
        .bind(
          at,
          hash,
          at,
          identity.user.id,
          identity.session.id,
          ...ownerValues(),
        )
        .first<ConsentRow>();
      if (!row) {
        // An expired attempt of this owner can no longer be consumed, so it
        // is released. Everything else (replay, other owner) is ignored.
        const stale = await db
          .prepare(
            `SELECT state,expires_at,return_to FROM github_consent WHERE state_hash=? AND user_id=?`,
          )
          .bind(hash, identity.user.id)
          .first<Pick<ConsentRow, "state" | "expires_at" | "return_to">>();
        if (
          stale?.state === "issued" &&
          stale.expires_at <= at &&
          (await releaseUnusedConsent(db, identity, at, hash))
        )
          return { returnTo: stale.return_to, outcome: "expired" };
        return { returnTo: stale?.return_to ?? "editor", outcome: "invalid" };
      }
      const ticket = ticketOf(row);
      const done = async (outcome: ConsentOutcome) => ({
        returnTo: row.return_to,
        outcome: await finish(hash, outcome),
      });
      if (params.error || !params.code) {
        // The owner declined (or GitHub refused) before any code existed.
        await owner.cancelUnissuedConsent(ticket);
        return done(params.error === "access_denied" ? "cancelled" : "failed");
      }
      const exchanged = await exchangeActivityCode(
        env.transport,
        env.oauthOrigin,
        env.app,
        {
          code: params.code.slice(0, 256),
          verifier: row.verifier,
          redirectUri: env.callbackUrl,
        },
      );
      if (exchanged.status === "none") {
        // The exchange settled without a token reaching this adapter.
        await owner.cancelUnissuedConsent(ticket);
        return done(exchanged.reason === "code" ? "expired" : "failed");
      }
      // From here a live token exists. Any failure before finishConsent
      // stores it must queue its revocation, or the crashed-exchange release
      // would later free the reservation with nothing left to revoke.
      const discard = async (error: unknown): Promise<never> => {
        try {
          await owner.discardIssuedToken(ticket, env.key, exchanged.token);
          await finish(hash, "failed");
        } catch {
          // Storage is unavailable. The original error is the one to report.
        }
        throw error;
      };
      const fetchedAt = new Date(now());
      const fetched = await fetchAuthorizedActivity(
        env.transport,
        exchanged.token,
        ticket.identity,
        lastYearRange(fetchedAt),
        fetchedAt.toISOString(),
      ).catch(discard);
      if (fetched.status === "failed") {
        // The token's account is unknown, so it cannot be enabled.
        await owner.discardIssuedToken(ticket, env.key, exchanged.token);
        return done("failed");
      }
      const scopes = hasActivityScope(fetched.scopes)
        ? "read:user"
        : fetched.scopes || "none";
      let connection: Awaited<ReturnType<typeof owner.finishConsent>>;
      try {
        // Rejects another account or scope and queues that token's revocation.
        connection = await owner.finishConsent(
          ticket,
          env.key,
          exchanged.token,
          scopes,
          fetched.viewer,
        );
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            error.message === "Invalid activity consent"
          )
        )
          // An ended session, a moved portfolio or a storage failure. The
          // grant row is unchanged (the batch is atomic), so queue the token.
          return discard(error);
        return done(
          sameIdentity(fetched.viewer, ticket.identity)
            ? "scope"
            : "wrong_account",
        );
      }
      // The selection changed meanwhile. finishConsent queued the token.
      if (!connection) return done("failed");
      await jobs.refresh(
        {
          portfolioId: connection.portfolioId,
          generation: connection.generation,
          identity: connection.identity,
        },
        authorizedRefreshResult(fetched, connection.identity),
        now(),
      );
      return done("connected");
    },
    /** Re-fetches the authorized calendar with the stored grant. */
    async refresh() {
      const connection = await owner.getConnection();
      if (!connection?.privateEnabled) return false;
      // The same shared refresh the queue consumer runs (Phase 42).
      const outcome = await refreshAuthorizedCalendar(
        db,
        connection.portfolioId,
        env,
        now(),
      );
      return outcome.written;
    },
  };
}
