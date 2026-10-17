export type GitHubIdentity = { id: string; login: string };
export type Calendar = {
  days: { date: string; count: number }[];
  fetchedAt: string;
};
export type PublishedGraph = GitHubIdentity & { includePrivate: boolean };
export type RefreshTicket = {
  portfolioId: string;
  generation: number;
  identity: GitHubIdentity;
};
export type RefreshResult =
  | { kind: "public"; calendar: Calendar | null }
  | { kind: "authorized"; calendar: Calendar }
  | { kind: "error"; source: "public" | "authorized"; error: RefreshError };
export type RefreshError =
  | "credential"
  | "rate"
  | "server"
  | "network"
  | "scope"
  | "identity"
  | "payload";

export function parseIdentity(value: GitHubIdentity): GitHubIdentity {
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 256 ||
    typeof value.login !== "string" ||
    !/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(value.login)
  )
    throw new Error("Invalid GitHub identity");
  return { id: value.id, login: value.login };
}
export function sameIdentity(a: GitHubIdentity, b: GitHubIdentity) {
  return a.id === b.id && a.login.toLowerCase() === b.login.toLowerCase();
}

// Rebuild an allowlist at both persistence and serving boundaries.
export function parseCalendar(value: unknown): Calendar {
  if (!value || typeof value !== "object") throw new Error("Invalid calendar");
  const calendar = value as Calendar;
  if (
    !Array.isArray(calendar.days) ||
    calendar.days.length < 1 ||
    calendar.days.length > 366 ||
    typeof calendar.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(calendar.fetchedAt))
  )
    throw new Error("Invalid calendar");
  const seen = new Set<string>();
  const days = calendar.days.map((day) => {
    if (
      !day ||
      typeof day.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
      !Number.isFinite(Date.parse(day.date)) ||
      new Date(day.date).toISOString().slice(0, 10) !== day.date ||
      seen.has(day.date) ||
      !Number.isSafeInteger(day.count) ||
      day.count < 0
    )
      throw new Error("Invalid calendar day");
    seen.add(day.date);
    return { date: day.date, count: day.count };
  });
  return {
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
    fetchedAt: new Date(calendar.fetchedAt).toISOString(),
  };
}

export type GraphState = {
  identity: GitHubIdentity;
  generation: number;
  privateAuthorized: boolean;
  activity: {
    generation: number;
    publicCalendar: unknown;
    authorizedCalendar: unknown;
  } | null;
};

// The caller must resolve configuration from the active immutable publication.
// Preview adapters use their own owner-authenticated configuration instead.
export function projectPublishedActivity(
  published: PublishedGraph | null,
  state: GraphState | null,
) {
  if (!published) return null;
  const identity = parseIdentity(published);
  let calendar: Calendar | null = null;
  if (
    state &&
    sameIdentity(identity, state.identity) &&
    state.activity?.generation === state.generation
  ) {
    const candidate =
      (published.includePrivate && state.privateAuthorized
        ? state.activity.authorizedCalendar
        : null) ?? state.activity.publicCalendar;
    if (candidate) {
      try {
        calendar = parseCalendar(candidate);
      } catch {
        // Corrupt or unknown caches fail closed and need a safe refetch.
      }
    }
  }
  return {
    username: identity.login,
    profileUrl: `https://github.com/${encodeURIComponent(identity.login)}`,
    available: calendar !== null,
    fetchedAt: calendar?.fetchedAt ?? null,
    days: calendar?.days ?? [],
  };
}
