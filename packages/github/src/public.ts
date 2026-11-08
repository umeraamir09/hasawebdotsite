import {
  type Calendar,
  type GitHubIdentity,
  parseIdentity,
  type RefreshResult,
  sameIdentity,
} from "./contracts";

// Public graph fetching with the separate no-scope platform credential. This is
// the production form of the Phase 11C classifier in `spike/permissions.ts`.
// Every outcome is platform-level: none of them asks the owner to reconnect.
// Phase 41 adds the authorized (owner token) fetch beside this one and reuses
// `parseContributionCalendar`.

export type GitHubTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type PublicBaseline =
  | { status: "available"; calendar: Calendar }
  // Restricted (private) contributions are shown on the profile. A public
  // baseline cannot be built from them. Never add or subtract calendars.
  | { status: "unavailable"; reason: "restricted" }
  | { status: "retry"; reason: "credential" | "rate" | "server" | "network" }
  | { status: "invalid"; reason: "scope" | "identity" | "payload" }
  // The login no longer names an account (deleted, renamed or never existed).
  | { status: "not_found" };

export type PublicIdentity =
  | { status: "found"; identity: GitHubIdentity }
  | { status: "not_found" }
  | {
      status: "retry";
      reason: "credential" | "rate" | "server" | "network";
    }
  | { status: "invalid"; reason: "scope" | "identity" | "payload" };

export type DateRange = { from: string; to: string };

const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_USER_URL = "https://api.github.com/user/";
const TIMEOUT_MS = 10_000;
const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export const CONTRIBUTION_QUERY = `query PublicActivity($login: String!, $from: DateTime!, $to: DateTime!) {
  viewer { id login }
  user(login: $login) {
    id login
    contributionsCollection(from: $from, to: $to) {
      restrictedContributionsCount
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;
export const RESOLVE_QUERY = `query ResolveLogin($login: String!) {
  viewer { id login }
  user(login: $login) { id login }
}`;

/** Whether a string can name a GitHub account. Case is preserved by callers. */
export function isGitHubLogin(value: string) {
  return LOGIN.test(value);
}

/** The most recent year GitHub allows in one contributions collection. */
export function lastYearRange(now: Date): DateRange {
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  start.setUTCHours(0, 0, 0, 0);
  return { from: start.toISOString(), to: now.toISOString() };
}

class Classified extends Error {
  constructor(
    readonly outcome:
      | {
          status: "retry";
          reason: "credential" | "rate" | "server" | "network";
        }
      | { status: "invalid"; reason: "scope" | "identity" | "payload" }
      | { status: "not_found" },
  ) {
    super(outcome.status);
  }
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Classified({ status: "invalid", reason: "payload" });
  return value as Record<string, unknown>;
};
function identityOf(value: unknown): GitHubIdentity {
  const data = record(value);
  if (
    typeof data.id !== "string" ||
    !data.id ||
    data.id.length > 256 ||
    typeof data.login !== "string" ||
    !LOGIN.test(data.login)
  )
    throw new Classified({ status: "invalid", reason: "payload" });
  return { id: data.id, login: data.login };
}

async function graphql(
  transport: GitHubTransport,
  token: string,
  query: string,
  variables: Record<string, string>,
) {
  let response: Response;
  try {
    response = await transport(GRAPHQL_URL, {
      method: "POST",
      // Workers reject "error". A redirect response is simply not ok.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "hasaweb-graph",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new Classified({ status: "retry", reason: "network" });
  }
  if (response.status === 401)
    throw new Classified({ status: "retry", reason: "credential" });
  // A 403 may be a rate limit or an organization policy, never an owner token.
  if (!response.ok)
    throw new Classified({
      status: "retry",
      reason:
        response.status === 403 || response.status === 429 ? "rate" : "server",
    });
  // The platform credential must be a classic token with no scopes.
  if (response.headers.get("X-OAuth-Scopes")?.trim() !== "")
    throw new Classified({ status: "invalid", reason: "scope" });
  let body: Record<string, unknown>;
  try {
    body = record(await response.json());
  } catch (error) {
    if (error instanceof Classified) throw error;
    throw new Classified({ status: "invalid", reason: "payload" });
  }
  const errors = body.errors;
  if (Array.isArray(errors) && errors.length) {
    // GraphQL reports an unknown login as a partial error on the user path.
    const missing = errors.every(
      (error) =>
        error &&
        typeof error === "object" &&
        (error as Record<string, unknown>).type === "NOT_FOUND" &&
        JSON.stringify((error as Record<string, unknown>).path) === '["user"]',
    );
    if (missing) throw new Classified({ status: "not_found" });
    throw new Classified({ status: "retry", reason: "server" });
  }
  if (errors) throw new Classified({ status: "retry", reason: "server" });
  return record(body.data);
}

// A week-aligned calendar extends at most six days past either window edge.
const WEEK_PADDING = 6 * 86_400_000;

/**
 * Validates and rebuilds a GraphQL contribution calendar as an allowlist.
 * A calendar of zero-count days is a valid, successful result.
 */
export function parseContributionCalendar(
  collection: Record<string, unknown>,
  range: DateRange,
  fetchedAt: string,
): Calendar {
  const weeks = record(collection.contributionCalendar).weeks;
  if (!Array.isArray(weeks) || weeks.length < 1 || weeks.length > 54)
    throw new Classified({ status: "invalid", reason: "payload" });
  const days: Calendar["days"] = [];
  const seen = new Set<string>();
  const fromDate = range.from.slice(0, 10);
  const toDate = range.to.slice(0, 10);
  const windowStart = Date.parse(fromDate);
  const windowEnd = Date.parse(toDate);
  for (const week of weeks) {
    const entries = record(week).contributionDays;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 7)
      throw new Classified({ status: "invalid", reason: "payload" });
    for (const entry of entries) {
      const day = record(entry);
      if (
        typeof day.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
        new Date(day.date).toISOString().slice(0, 10) !== day.date ||
        Date.parse(day.date) < windowStart - WEEK_PADDING ||
        Date.parse(day.date) > windowEnd + WEEK_PADDING ||
        seen.has(day.date) ||
        typeof day.contributionCount !== "number" ||
        !Number.isSafeInteger(day.contributionCount) ||
        day.contributionCount < 0
      )
        throw new Classified({ status: "invalid", reason: "payload" });
      seen.add(day.date);
      // GitHub aligns the calendar to whole weeks, so the first and last week
      // include days outside the requested window. They are not published.
      if (day.date < fromDate || day.date > toDate) continue;
      days.push({ date: day.date, count: day.contributionCount });
    }
  }
  if (!days.length)
    throw new Classified({ status: "invalid", reason: "payload" });
  return {
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
    fetchedAt,
  };
}

function classify(error: unknown) {
  if (error instanceof Classified) return error.outcome;
  throw error;
}

/**
 * Resolves the stable GitHub account for a typed username. The platform
 * account itself and any scoped credential fail closed.
 */
export async function resolvePublicIdentity(
  transport: GitHubTransport,
  token: string,
  login: string,
): Promise<PublicIdentity> {
  if (!LOGIN.test(login)) return { status: "not_found" };
  try {
    const data = await graphql(transport, token, RESOLVE_QUERY, { login });
    const user = identityOf(data.user);
    if (user.login.toLowerCase() !== login.toLowerCase())
      throw new Classified({ status: "invalid", reason: "identity" });
    if (identityOf(data.viewer).id === user.id)
      throw new Classified({ status: "invalid", reason: "identity" });
    return { status: "found", identity: parseIdentity(user) };
  } catch (error) {
    return classify(error);
  }
}

/**
 * Classified public baseline for one selected account, from the zero-scope
 * platform credential. Phase 11C defines each outcome's dependent behavior.
 */
export async function fetchPublicBaseline(
  transport: GitHubTransport,
  token: string,
  selected: GitHubIdentity,
  range: DateRange,
  fetchedAt: string,
): Promise<PublicBaseline> {
  try {
    const data = await graphql(transport, token, CONTRIBUTION_QUERY, {
      login: selected.login,
      from: range.from,
      to: range.to,
    });
    if (data.user === null) throw new Classified({ status: "not_found" });
    const user = record(data.user);
    // The platform account must be separate from every owner it reads.
    if (identityOf(data.viewer).id === selected.id)
      throw new Classified({ status: "invalid", reason: "identity" });
    if (!sameIdentity(identityOf(user), selected))
      throw new Classified({ status: "not_found" });
    const collection = record(user.contributionsCollection);
    const restricted = collection.restrictedContributionsCount;
    if (
      typeof restricted !== "number" ||
      !Number.isSafeInteger(restricted) ||
      restricted < 0
    )
      throw new Classified({ status: "invalid", reason: "payload" });
    // No per-day private subtraction is possible from this aggregate alone.
    if (restricted > 0) return { status: "unavailable", reason: "restricted" };
    return {
      status: "available",
      calendar: parseContributionCalendar(collection, range, fetchedAt),
    };
  } catch (error) {
    return classify(error);
  }
}

/** The persistence form of a baseline. A renamed or missing account clears it. */
export function publicRefreshResult(baseline: PublicBaseline): RefreshResult {
  switch (baseline.status) {
    case "available":
      return { kind: "public", calendar: baseline.calendar };
    case "unavailable":
      return { kind: "public", calendar: null };
    case "not_found":
      return { kind: "error", source: "public", error: "identity" };
    default:
      return { kind: "error", source: "public", error: baseline.reason };
  }
}

/**
 * Suggests the username for a GitHub sign-in from its numeric account ID. The
 * result is only a suggestion. Setup still resolves and fetches it as typed.
 */
export async function lookupLoginById(
  transport: GitHubTransport,
  token: string,
  accountId: string,
): Promise<
  | { status: "found"; login: string }
  | { status: "not_found" }
  | { status: "retry" | "invalid" }
> {
  if (!/^\d{1,20}$/.test(accountId)) return { status: "not_found" };
  let response: Response;
  try {
    response = await transport(`${REST_USER_URL}${accountId}`, {
      method: "GET",
      // Workers reject "error". A redirect response is simply not ok.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "hasaweb-graph",
        "X-GitHub-Api-Version": "2026-03-10",
      },
    });
  } catch {
    return { status: "retry" };
  }
  if (response.status === 404) return { status: "not_found" };
  if (!response.ok) return { status: "retry" };
  try {
    const body = record(await response.json());
    if (
      body.type !== "User" ||
      String(body.id) !== accountId ||
      typeof body.login !== "string" ||
      !LOGIN.test(body.login)
    )
      return { status: "invalid" };
    return { status: "found", login: body.login };
  } catch {
    return { status: "invalid" };
  }
}
