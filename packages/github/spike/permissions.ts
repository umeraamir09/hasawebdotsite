// S-6 experiment only. Product persistence and OAuth routes arrive later.
export const SIGN_IN_SCOPES = ["user:email"] as const;
export const ACTIVITY_SCOPES = ["read:user"] as const;
export const VISIT_TTL = 6 * 60 * 60 * 1000;
export const SWEEP_INTERVAL = 24 * 60 * 60 * 1000;
export const QUERY = `query Activity($login: String!, $from: DateTime!, $to: DateTime!) {
  viewer { id login }
  user(login: $login) {
    id login
    contributionsCollection(from: $from, to: $to) {
      restrictedContributionsCount
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

export type Identity = { id: string; login: string };
export type Day = { date: string; count: number };
export type Calendar = { days: Day[]; fetchedAt: string };
export type State = {
  selected: Identity;
  generation: number;
  enabled: boolean;
  grant: Identity | null;
  tokenEnc: string | null;
  status: "ok" | "needs_reconnect" | "disconnected";
  publicCalendar: Calendar | null;
  authorizedCalendar: Calendar | null;
  error: string | null;
};
type Failure = "reconnect" | "retry" | "invalid";
export type FailureReason =
  | "credential"
  | "rate"
  | "server"
  | "network"
  | "scope"
  | "identity"
  | "payload";
export class ProviderError extends Error {
  constructor(
    public readonly kind: Failure,
    public readonly reason?: FailureReason,
  ) {
    super(kind);
  }
}
export type Transport = (url: string, init: RequestInit) => Promise<Response>;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProviderError("invalid", "payload");
  return value as Record<string, unknown>;
};
function identity(value: unknown): Identity {
  const data = record(value);
  if (
    typeof data.id !== "string" ||
    !data.id ||
    typeof data.login !== "string" ||
    !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(data.login)
  )
    throw new ProviderError("invalid", "payload");
  return { id: data.id, login: data.login };
}
export function matches(a: Identity, b: Identity) {
  return a.id === b.id && a.login.toLowerCase() === b.login.toLowerCase();
}
export function hasActivityScope(value: string) {
  // Accept only the narrow grant requested by the separate activity app.
  return value.split(/[ ,]+/).filter(Boolean).sort().join(",") === "read:user";
}
export async function fetchCalendar(
  transport: Transport,
  token: string,
  selected: Identity,
  range: { from: string; to: string },
  privateActivity: boolean,
  fetchedAt: string,
): Promise<Calendar | null> {
  let response: Response;
  try {
    response = await transport("https://api.github.com/graphql", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "hasaweb-permissions-spike",
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { login: selected.login, ...range },
      }),
    });
  } catch {
    throw new ProviderError("retry", "network");
  }
  if (response.status === 401)
    throw new ProviderError("reconnect", "credential");
  // A 403 may be a rate limit or organization policy, not a revoked token.
  if (!response.ok)
    throw response.status === 403 || response.status === 429
      ? new ProviderError("retry", "rate")
      : new ProviderError("retry", "server");
  if (
    privateActivity &&
    !hasActivityScope(response.headers.get("X-OAuth-Scopes") ?? "")
  )
    throw new ProviderError("reconnect", "scope");
  if (!privateActivity && response.headers.get("X-OAuth-Scopes")?.trim() !== "")
    throw new ProviderError("invalid", "scope");
  let body: Record<string, unknown>;
  try {
    body = record(await response.json());
  } catch {
    throw new ProviderError("invalid", "payload");
  }
  if (body.errors) throw new ProviderError("retry", "server");
  const data = record(body.data);
  const user = record(data.user);
  if (!privateActivity && identity(data.viewer).id === selected.id)
    throw new ProviderError("invalid", "identity");
  if (
    !matches(identity(user), selected) ||
    (privateActivity && !matches(identity(data.viewer), selected))
  )
    throw new ProviderError("reconnect", "identity");
  const collection = record(user.contributionsCollection);
  const restricted = collection.restrictedContributionsCount;
  if (
    typeof restricted !== "number" ||
    !Number.isSafeInteger(restricted) ||
    restricted < 0
  )
    throw new ProviderError("invalid", "payload");
  // No per-day private subtraction is possible from this aggregate alone.
  if (!privateActivity && restricted > 0) return null;
  const weeks = record(collection.contributionCalendar).weeks;
  if (!Array.isArray(weeks) || weeks.length < 1 || weeks.length > 54)
    throw new ProviderError("invalid", "payload");
  const days: Day[] = [];
  const seen = new Set<string>();
  for (const week of weeks) {
    const entries = record(week).contributionDays;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 7)
      throw new ProviderError("invalid", "payload");
    for (const entry of entries) {
      const day = record(entry);
      if (
        typeof day.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
        !Number.isFinite(Date.parse(day.date)) ||
        new Date(day.date).toISOString().slice(0, 10) !== day.date ||
        day.date < range.from.slice(0, 10) ||
        day.date > range.to.slice(0, 10) ||
        seen.has(day.date) ||
        typeof day.contributionCount !== "number" ||
        !Number.isSafeInteger(day.contributionCount) ||
        day.contributionCount < 0
      )
        throw new ProviderError("invalid", "payload");
      seen.add(day.date);
      days.push({ date: day.date, count: day.contributionCount });
    }
  }
  return { days: days.sort((a, b) => a.date.localeCompare(b.date)), fetchedAt };
}

/**
 * Classified public baseline for the separate no-scope platform credential.
 * Dependent graph work (Phases 11D and 40-42) must treat every outcome as
 * platform-level, never as an owner sign-in/activity state:
 * - `available`: serve the public baseline and its fetch date.
 * - `unavailable`: the baseline contains restricted contributions; serve a
 *   clear unavailable state and never add or subtract calendars.
 * - `retry`: platform credential rotation, rate limits, server failures, and
 *   network failures. Retry with backoff, retain the last good baseline or
 *   unavailable, and never ask the owner to reconnect.
 * - `invalid`: misconfigured or unsupported provider behavior. Fail closed,
 *   serve no baseline from this credential, and alert the operator.
 */
export type PublicBaseline =
  | { status: "available"; calendar: Calendar }
  | { status: "unavailable"; reason: "restricted" }
  | { status: "retry"; reason: "credential" | "rate" | "server" | "network" }
  | { status: "invalid"; reason: "scope" | "identity" | "payload" };
export async function fetchPublicBaseline(
  transport: Transport,
  token: string,
  selected: Identity,
  range: { from: string; to: string },
  fetchedAt: string,
): Promise<PublicBaseline> {
  try {
    const calendar = await fetchCalendar(
      transport,
      token,
      selected,
      range,
      false,
      fetchedAt,
    );
    return calendar
      ? { status: "available", calendar }
      : { status: "unavailable", reason: "restricted" };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    if (error.kind === "retry")
      return {
        status: "retry",
        reason:
          error.reason === "rate" || error.reason === "network"
            ? error.reason
            : "server",
      };
    if (error.kind === "reconnect")
      return error.reason === "credential"
        ? { status: "retry", reason: "credential" }
        : { status: "invalid", reason: "identity" };
    return {
      status: "invalid",
      reason:
        error.reason === "scope" || error.reason === "identity"
          ? error.reason
          : "payload",
    };
  }
}
export function enable(
  state: State,
  consent: boolean,
  grant: Identity,
  scopes: string,
  tokenEnc: string,
): State {
  if (!consent || !matches(state.selected, grant) || !hasActivityScope(scopes))
    throw new ProviderError("reconnect");
  return {
    ...state,
    generation: state.generation + 1,
    enabled: true,
    grant,
    tokenEnc,
    status: "ok",
    authorizedCalendar: null,
    error: null,
  };
}
export function withdraw(
  state: State,
  status: State["status"] = "disconnected",
): State {
  return {
    ...state,
    generation: state.generation + 1,
    enabled: false,
    grant: null,
    tokenEnc: null,
    authorizedCalendar: null,
    status,
    error: status === "needs_reconnect" ? "reconnect" : null,
  };
}
export function select(state: State, selected: Identity): State {
  return { ...withdraw(state), selected, publicCalendar: null };
}
export function applyRefresh(
  state: State,
  generation: number,
  result: Calendar | ProviderError,
): State {
  if (
    generation !== state.generation ||
    !state.enabled ||
    !state.grant ||
    !matches(state.selected, state.grant)
  )
    return state;
  if (result instanceof ProviderError) {
    if (result.kind === "reconnect") return withdraw(state, "needs_reconnect");
    return { ...state, error: result.kind };
  }
  return { ...state, authorizedCalendar: result, error: null };
}
export function publicResponse(state: State) {
  const privateAllowed =
    state.enabled &&
    state.status === "ok" &&
    !!state.tokenEnc &&
    !!state.grant &&
    matches(state.selected, state.grant);
  const calendar =
    (privateAllowed ? state.authorizedCalendar : null) ?? state.publicCalendar;
  // Build an allowlist even when stored objects contain unexpected properties.
  return Response.json(
    {
      username: state.selected.login,
      profileUrl: `https://github.com/${encodeURIComponent(state.selected.login)}`,
      available: calendar !== null,
      fetchedAt: calendar?.fetchedAt ?? null,
      days: calendar?.days.map(({ date, count }) => ({ date, count })) ?? [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export function refreshDue(
  lastChecked: number,
  now: number,
  mode: "visit" | "sweep",
  enabled: boolean,
) {
  return mode === "visit"
    ? now - lastChecked >= VISIT_TTL
    : enabled && now - lastChecked >= SWEEP_INTERVAL;
}
const encoder = new TextEncoder();
export async function encryptToken(
  key: CryptoKey,
  token: string,
  binding: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(binding) },
    key,
    encoder.encode(token),
  );
  return JSON.stringify({ iv: [...iv], cipher: [...new Uint8Array(cipher)] });
}
export async function decryptToken(
  key: CryptoKey,
  envelope: string,
  binding: string,
) {
  const { iv, cipher } = JSON.parse(envelope) as {
    iv: number[];
    cipher: number[];
  };
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(iv),
        additionalData: encoder.encode(binding),
      },
      key,
      new Uint8Array(cipher),
    ),
  );
}
