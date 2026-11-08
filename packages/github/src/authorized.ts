import {
  type Calendar,
  type GitHubIdentity,
  type RefreshResult,
  sameIdentity,
} from "./contracts";
import { hasActivityScope } from "./oauth";
import {
  CONTRIBUTION_QUERY,
  type DateRange,
  type GitHubTransport,
  isGitHubLogin,
  parseContributionCalendar,
} from "./public";

// The complete authorized calendar from the owner's activity token. It
// already includes public contributions, so it replaces the public baseline
// when published with private activity. It is never added to it.

const TIMEOUT_MS = 10_000;

export type AuthorizedFetch =
  // GitHub answered and named the token's account (`viewer`). The calendar is
  // present only when the selected user matched and the payload was valid.
  | {
      status: "answered";
      viewer: GitHubIdentity;
      scopes: string;
      calendar: Calendar | null;
      error: null | "identity" | "payload";
    }
  // No account could be established from this response.
  | {
      status: "failed";
      error: "credential" | "rate" | "server" | "network" | "payload";
    };

const object = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
function identity(value: unknown): GitHubIdentity | null {
  const data = object(value);
  if (
    !data ||
    typeof data.id !== "string" ||
    !data.id ||
    data.id.length > 256 ||
    typeof data.login !== "string" ||
    !isGitHubLogin(data.login)
  )
    return null;
  return { id: data.id, login: data.login };
}

export async function fetchAuthorizedActivity(
  transport: GitHubTransport,
  token: string,
  selected: GitHubIdentity,
  range: DateRange,
  fetchedAt: string,
): Promise<AuthorizedFetch> {
  let response: Response;
  try {
    response = await transport("https://api.github.com/graphql", {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "hasaweb-activity",
      },
      body: JSON.stringify({
        query: CONTRIBUTION_QUERY,
        variables: { login: selected.login, ...range },
      }),
    });
  } catch {
    return { status: "failed", error: "network" };
  }
  // 401 is the owner's token, revoked or expired: reconnect, not retry.
  if (response.status === 401) return { status: "failed", error: "credential" };
  if (!response.ok)
    return {
      status: "failed",
      error:
        response.status === 403 || response.status === 429 ? "rate" : "server",
    };
  const scopes = response.headers.get("X-OAuth-Scopes") ?? "";
  let body: Record<string, unknown> | null;
  try {
    body = object(await response.json());
  } catch {
    body = null;
  }
  const data = object(body?.data);
  const viewer = identity(data?.viewer);
  if (!viewer) return { status: "failed", error: "payload" };
  const errors = body?.errors;
  // GraphQL reports a renamed or deleted login as a NOT_FOUND on `user`.
  if (data?.user === null || (Array.isArray(errors) && errors.length))
    return {
      status: "answered",
      viewer,
      scopes,
      calendar: null,
      error: data?.user === null ? "identity" : "payload",
    };
  const user = identity(data?.user);
  if (!user || !sameIdentity(user, selected) || !sameIdentity(viewer, selected))
    return {
      status: "answered",
      viewer,
      scopes,
      calendar: null,
      error: "identity",
    };
  const collection = object(object(data?.user)?.contributionsCollection);
  try {
    if (!collection) throw new Error("payload");
    return {
      status: "answered",
      viewer,
      scopes,
      calendar: parseContributionCalendar(collection, range, fetchedAt),
      error: null,
    };
  } catch {
    return {
      status: "answered",
      viewer,
      scopes,
      calendar: null,
      error: "payload",
    };
  }
}

/**
 * The persistence form for a selected account. A wrong scope or a token for
 * another account is a reconnect error, which withdraws the grant.
 */
export function authorizedRefreshResult(
  fetched: AuthorizedFetch,
  selected: GitHubIdentity,
): RefreshResult {
  if (fetched.status === "failed")
    return { kind: "error", source: "authorized", error: fetched.error };
  if (!hasActivityScope(fetched.scopes))
    return { kind: "error", source: "authorized", error: "scope" };
  if (!sameIdentity(fetched.viewer, selected) || fetched.error === "identity")
    return { kind: "error", source: "authorized", error: "identity" };
  if (!fetched.calendar)
    return { kind: "error", source: "authorized", error: "payload" };
  return { kind: "authorized", calendar: fetched.calendar };
}
