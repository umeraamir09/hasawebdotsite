// Independent GitHub refresh policy (Phase 42). The owner approved these
// intervals on November 8, 2026; see the Phase 42 results record.

/** Refresh-on-visit: a calendar older than this is due, counted from its last successful fetch. */
export const REFRESH_TTL_MS = 6 * 60 * 60_000;
/**
 * One window for deduplication, stuck-job recovery and transient-failure
 * retry: a portfolio is requested again only after this long, so a lost
 * message or a failed fetch is retried by the next visit or sweep after it.
 */
export const REFRESH_REQUEST_WINDOW_MS = 15 * 60_000;
/** Daily private sweep: an authorized calendar older than this is due. */
export const PRIVATE_SWEEP_INTERVAL_MS = 24 * 60 * 60_000;
/** Bounded work: at most this many private connections are requested per cron tick. */
export const PRIVATE_SWEEP_BATCH = 25;

/**
 * One Queue message refreshes one portfolio: its public calendar, its
 * authorized calendar while the grant is active, and the published
 * account's public calendar when the draft selected another account.
 * `requestedAt` lets exactly one delivery of a request claim the work.
 */
export type RefreshMessage = {
  kind: "github-refresh";
  portfolioId: string;
  requestedAt: number;
};

export function parseRefreshMessage(value: unknown): RefreshMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (
    message.kind !== "github-refresh" ||
    typeof message.portfolioId !== "string" ||
    !message.portfolioId ||
    message.portfolioId.length > 128 ||
    typeof message.requestedAt !== "number" ||
    !Number.isSafeInteger(message.requestedAt) ||
    message.requestedAt <= 0
  )
    return null;
  return {
    kind: "github-refresh",
    portfolioId: message.portfolioId,
    requestedAt: message.requestedAt,
  };
}

/**
 * Whether a stored calendar is due. A missing, unreadable or future-dated
 * calendar is due: only a successful fetch resets the interval.
 */
export function calendarDue(
  calendar: unknown,
  now: number,
  interval = REFRESH_TTL_MS,
) {
  if (!calendar || typeof calendar !== "object") return true;
  const fetchedAt = Date.parse(
    String((calendar as { fetchedAt?: unknown }).fetchedAt),
  );
  if (!Number.isFinite(fetchedAt) || fetchedAt > now + 60_000) return true;
  return now - fetchedAt >= interval;
}
