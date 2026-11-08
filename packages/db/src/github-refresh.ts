import {
  authorizedRefreshResult,
  calendarDue,
  decryptActivityToken,
  fetchAuthorizedActivity,
  fetchPublicBaseline,
  type GitHubIdentity,
  type GitHubTransport,
  type GraphState,
  lastYearRange,
  PRIVATE_SWEEP_BATCH,
  PRIVATE_SWEEP_INTERVAL_MS,
  type PublishedGraph,
  parseCalendar,
  parseIdentity,
  publicRefreshResult,
  REFRESH_REQUEST_WINDOW_MS,
  type RefreshMessage,
  type RefreshTicket,
  sameIdentity,
} from "@hasaweb/github";
import {
  githubJobs,
  publishedGraphAccount,
  publishedGraphColumn,
} from "./github";

// Independent GitHub refresh (Phase 42). Refreshes never need Publish: the
// public endpoint reads current calendars under the frozen published
// configuration. Every write reuses the Phase 11D generation-checked
// `githubJobs().refresh`, so a stale response or error cannot restore
// withdrawn data or touch a newer grant.
//
// Triggers: a published-page visit past the TTL (`site`), the owner's status
// read past the TTL (editor and onboarding share `ownerGraphSetup`), and the
// daily sweep of private connections (jobs cron). Each one first records a
// request in `github_refresh` with a compare-and-set, so within the request
// window one portfolio gets at most one message. D1 is the source of truth:
// a lost message or a crashed consumer is simply requested again after the
// window by the next trigger.

export type RefreshQueue = { send(message: RefreshMessage): Promise<unknown> };
export type PublicRefreshEnvironment = {
  transport: GitHubTransport;
  platformToken: string;
};
export type AuthorizedRefreshEnvironment = {
  transport: GitHubTransport;
  key: CryptoKey;
};

/**
 * Records a refresh request unless one was recorded within the request
 * window. Returns the message to enqueue, or null when another trigger
 * already owns this window.
 */
export async function requestGitHubRefresh(
  db: D1Database,
  portfolioId: string,
  now = Date.now(),
): Promise<RefreshMessage | null> {
  const row = await db
    .prepare(
      `INSERT INTO github_refresh(portfolio_id,requested_at)
      SELECT id,? FROM portfolio WHERE id=?
      ON CONFLICT(portfolio_id) DO UPDATE SET requested_at=excluded.requested_at
      WHERE github_refresh.requested_at<=?
      RETURNING requested_at`,
    )
    .bind(now, portfolioId, now - REFRESH_REQUEST_WINDOW_MS)
    .first<{ requested_at: number }>();
  return row
    ? { kind: "github-refresh", portfolioId, requestedAt: row.requested_at }
    : null;
}

/** Requests a refresh and sends its message. Callers run this in `waitUntil`. */
export async function enqueueGitHubRefresh(
  db: D1Database,
  queue: RefreshQueue,
  portfolioId: string,
  now = Date.now(),
) {
  const message = await requestGitHubRefresh(db, portfolioId, now);
  if (message) await queue.send(message);
  return message;
}

/**
 * Lets exactly one delivery of a request do the work. A duplicate delivery,
 * or a message superseded by a newer request, is skipped. A consumer that
 * crashed after claiming leaves `started_at` set; the next request after the
 * window is newer and can be claimed again.
 */
export async function claimGitHubRefresh(
  db: D1Database,
  message: RefreshMessage,
  now = Date.now(),
) {
  const result = await db
    .prepare(
      `UPDATE github_refresh SET started_at=?
      WHERE portfolio_id=? AND requested_at=? AND (started_at IS NULL OR started_at<requested_at)`,
    )
    .bind(
      Math.max(now, message.requestedAt),
      message.portfolioId,
      message.requestedAt,
    )
    .run();
  return result.meta.changes === 1;
}

/**
 * Due private connections for the daily sweep. A connection is due when its
 * authorized calendar is missing or older than the sweep interval and no
 * request is recorded within the request window. Each returned connection has
 * a recorded request; at most `limit` per call.
 */
export async function dueGitHubSweep(
  db: D1Database,
  now = Date.now(),
  limit = PRIVATE_SWEEP_BATCH,
): Promise<RefreshMessage[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid sweep batch size");
  const rows = await db
    .prepare(
      `SELECT c.portfolio_id FROM github_connection c
      JOIN portfolio p ON p.id=c.portfolio_id JOIN user u ON u.id=p.user_id
      LEFT JOIN github_activity a ON a.portfolio_id=c.portfolio_id AND a.generation=c.generation
      LEFT JOIN github_refresh r ON r.portfolio_id=c.portfolio_id
      WHERE u.deleting_at IS NULL AND c.private_enabled=1 AND c.status='ok' AND c.token_enc IS NOT NULL
        AND (a.authorized_calendar IS NULL OR json_extract(a.authorized_calendar,'$.fetchedAt') IS NULL
          OR json_extract(a.authorized_calendar,'$.fetchedAt')<=?)
        AND (r.requested_at IS NULL OR r.requested_at<=?)
      ORDER BY coalesce(r.requested_at,0), c.portfolio_id LIMIT ?`,
    )
    .bind(
      // Stored calendars are normalized by parseCalendar to toISOString, so
      // ISO strings of the same shape order like their instants.
      new Date(now - PRIVATE_SWEEP_INTERVAL_MS).toISOString(),
      now - REFRESH_REQUEST_WINDOW_MS,
      limit,
    )
    .all<{ portfolio_id: string }>();
  const messages: RefreshMessage[] = [];
  for (const row of rows.results) {
    // A visit or another tick may have requested it meanwhile.
    const message = await requestGitHubRefresh(db, row.portfolio_id, now);
    if (message) messages.push(message);
  }
  return messages;
}

const decode = (value: unknown): unknown => {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/**
 * Whether the calendars the connection serves are due under the TTL: the
 * public calendar, and the authorized one while the grant is active. A cache
 * from another generation is due. `requireData` leaves a selection that has
 * never fetched successfully to explicit setup and Retry (editor status).
 */
export function connectionRefreshDue(
  state: GraphState | null,
  now: number,
  options: { requireData?: boolean } = {},
) {
  if (!state) return false;
  const activity =
    state.activity?.generation === state.generation ? state.activity : null;
  const publicCalendar = decode(activity?.publicCalendar);
  const authorizedCalendar = decode(activity?.authorizedCalendar);
  if (options.requireData && !publicCalendar && !authorizedCalendar)
    return false;
  return (
    calendarDue(publicCalendar, now) ||
    (state.privateAuthorized && calendarDue(authorizedCalendar, now))
  );
}

/**
 * The published account's retained public calendar, as serving state, when
 * the connection does not hold that account's data. It never carries
 * authorization, so the projection can only select the public calendar.
 */
export async function publishedFallbackState(
  db: D1Database,
  portfolioId: string,
  published: PublishedGraph,
): Promise<GraphState | null> {
  const row = await db
    .prepare(
      `SELECT s.github_user_id,s.login,s.public_calendar FROM github_published_activity s
      JOIN portfolio p ON p.id=s.portfolio_id JOIN user u ON u.id=p.user_id
      WHERE s.portfolio_id=? AND s.github_user_id=? AND u.deleting_at IS NULL`,
    )
    .bind(portfolioId, published.id)
    .first<{
      github_user_id: string;
      login: string;
      public_calendar: string | null;
    }>();
  if (!row) return null;
  return {
    identity: { id: row.github_user_id, login: row.login },
    generation: 0,
    privateAuthorized: false,
    activity: {
      generation: 0,
      publicCalendar: decode(row.public_calendar),
      authorizedCalendar: null,
    },
  };
}

/** Fetches and stores the selected account's public calendar. */
export async function refreshPublicCalendar(
  db: D1Database,
  ticket: RefreshTicket,
  env: PublicRefreshEnvironment,
  now = Date.now(),
) {
  const baseline = await fetchPublicBaseline(
    env.transport,
    env.platformToken,
    ticket.identity,
    lastYearRange(new Date(now)),
    new Date(now).toISOString(),
  );
  // A selection that changed while the provider answered discards this result.
  return githubJobs(db).refresh(ticket, publicRefreshResult(baseline), now);
}

/**
 * Fetches the authorized calendar with the stored grant. A 401, a changed
 * scope or another account withdraws private data and queues the grant for
 * revocation (`withdrawn`); the caller then runs grant cleanup.
 */
export async function refreshAuthorizedCalendar(
  db: D1Database,
  portfolioId: string,
  env: AuthorizedRefreshEnvironment,
  now = Date.now(),
) {
  const jobs = githubJobs(db);
  const captured = await jobs.capture(portfolioId, "authorized");
  if (!captured?.tokenEnc || !captured.tokenBinding)
    return { written: false, withdrawn: false };
  const token = await decryptActivityToken(
    env.key,
    captured.tokenEnc,
    captured.tokenBinding,
  );
  const at = new Date(now);
  const fetched = await fetchAuthorizedActivity(
    env.transport,
    token,
    captured.ticket.identity,
    lastYearRange(at),
    at.toISOString(),
  );
  const result = authorizedRefreshResult(fetched, captured.ticket.identity);
  const written = await jobs.refresh(captured.ticket, result, now);
  return {
    written,
    withdrawn:
      written &&
      result.kind === "error" &&
      ["credential", "scope", "identity"].includes(result.error),
  };
}

async function publishedIdentity(db: D1Database, portfolioId: string) {
  const row = await db
    .prepare(
      `SELECT ${publishedGraphColumn("?", "$.graph.id")} AS id, ${publishedGraphColumn("?", "$.graph.login")} AS login`,
    )
    .bind(portfolioId, portfolioId)
    .first<{ id: unknown; login: unknown }>();
  if (typeof row?.id !== "string" || typeof row.login !== "string") return null;
  try {
    return parseIdentity({ id: row.id, login: row.login });
  } catch {
    return null;
  }
}

/**
 * Keeps the published account's public calendar while the draft selects
 * another account, so the live graph keeps refreshing until the next Publish.
 * Removes the retained row once the active version names no graph, names
 * another account, or the connection again serves that account.
 */
export async function refreshPublishedAccount(
  db: D1Database,
  portfolioId: string,
  selected: GitHubIdentity | null,
  env: PublicRefreshEnvironment,
  now = Date.now(),
) {
  const published = await publishedIdentity(db, portfolioId);
  const remove = (keep: string | null) =>
    db
      .prepare(
        `DELETE FROM github_published_activity WHERE portfolio_id=?
        ${keep ? "AND github_user_id<>?" : ""}`,
      )
      .bind(portfolioId, ...(keep ? [keep] : []))
      .run();
  if (!published) {
    await remove(null);
    return "none" as const;
  }
  await remove(published.id);
  if (selected && sameIdentity(selected, published)) {
    // The connection serves this account. The retained row only covers a
    // connection without usable data, and goes once the connection has some.
    const state = await githubJobs(db).servingState(portfolioId);
    let usable = false;
    try {
      usable =
        state?.activity?.generation === state?.generation &&
        !!parseCalendar(state?.activity?.publicCalendar);
    } catch {
      usable = false;
    }
    if (usable) await remove(null);
    return "connection" as const;
  }
  const baseline = await fetchPublicBaseline(
    env.transport,
    env.platformToken,
    published,
    lastYearRange(new Date(now)),
    new Date(now).toISOString(),
  );
  const result = publicRefreshResult(baseline);
  const calendar =
    result.kind === "public" && result.calendar
      ? JSON.stringify(parseCalendar(result.calendar))
      : null;
  const error = result.kind === "error" ? result.error : null;
  // A transient failure keeps the last good calendar and its date; an
  // identity, scope or payload failure clears it (as for the connection).
  const preserve =
    result.kind === "error" &&
    !["scope", "identity", "payload"].includes(result.error);
  await db
    .prepare(
      `INSERT INTO github_published_activity(portfolio_id,github_user_id,login,public_calendar,public_error,checked_at)
      SELECT p.id,?,?,?,?,? FROM portfolio p JOIN user u ON u.id=p.user_id
      WHERE p.id=? AND u.deleting_at IS NULL AND ${publishedGraphAccount("p.id")}=?
        AND NOT EXISTS(SELECT 1 FROM github_connection c WHERE c.portfolio_id=p.id AND c.github_user_id=?)
      ON CONFLICT(portfolio_id) DO UPDATE SET github_user_id=excluded.github_user_id,login=excluded.login,
        public_calendar=CASE WHEN ${preserve ? 1 : 0}=1 AND github_published_activity.github_user_id=excluded.github_user_id
          THEN github_published_activity.public_calendar ELSE excluded.public_calendar END,
        public_error=excluded.public_error,checked_at=excluded.checked_at`,
    )
    .bind(
      published.id,
      published.login,
      calendar,
      error,
      now,
      portfolioId,
      published.id,
      published.id,
    )
    .run();
  return "published" as const;
}

/**
 * Runs one refresh message. Each step is independent: a failure in one is
 * recorded (or logged) and the others still run. Returns whether private
 * access was withdrawn, so the caller can start grant cleanup.
 */
export async function runGitHubRefresh(
  db: D1Database,
  message: RefreshMessage,
  env: {
    public: PublicRefreshEnvironment | null;
    authorized: AuthorizedRefreshEnvironment | null;
  },
  now = Date.now(),
) {
  if (!(await claimGitHubRefresh(db, message, now)))
    return { claimed: false, withdrawn: false, failed: [] as string[] };
  const failed: string[] = [];
  let withdrawn = false;
  const captured = await githubJobs(db).capture(message.portfolioId, "public");
  if (captured && env.public) {
    await refreshPublicCalendar(db, captured.ticket, env.public, now).catch(
      () => failed.push("public"),
    );
  } else if (captured) failed.push("public");
  if (env.authorized) {
    await refreshAuthorizedCalendar(
      db,
      message.portfolioId,
      env.authorized,
      now,
    ).then(
      (outcome) => {
        withdrawn = outcome.withdrawn;
      },
      () => failed.push("authorized"),
    );
  }
  if (env.public)
    await refreshPublishedAccount(
      db,
      message.portfolioId,
      captured?.ticket.identity ?? null,
      env.public,
      now,
    ).catch(() => failed.push("published"));
  return { claimed: true, withdrawn, failed };
}
