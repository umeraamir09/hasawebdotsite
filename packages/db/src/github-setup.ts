import {
  fetchPublicBaseline,
  type GitHubTransport,
  isGitHubLogin,
  lastYearRange,
  lookupLoginById,
  parseCalendar,
  projectPublishedActivity,
  publicRefreshResult,
  resolvePublicIdentity,
  sameIdentity,
} from "@hasaweb/github";
import { githubJobs, ownerGithub } from "./github";
import {
  ownerPrivateActivity,
  type PrivateEnvironment,
  type PrivateState,
  releaseUnusedConsent,
} from "./github-private";
import type { SessionIdentity } from "./repositories";

// GitHub graph setup for the signed-in owner. The public part uses only the
// separate platform credential and public data. Private activity (Phase 41,
// `github-private.ts`) is reported and refreshed here when the activity app
// is configured, and is never part of the public fetch.

/** Retry and setup share one cooldown so a click cannot hammer the provider. */
export const GRAPH_RETRY_COOLDOWN_MS = 10_000;

export type GraphFailure =
  | "invalid_username"
  | "not_found"
  | "unavailable"
  | "misconfigured"
  | "too_soon"
  | "conflict"
  | "no_graph";

export type GraphPublicState =
  // The account is selected and no fetch has finished for this selection.
  | { state: "pending" }
  | {
      state: "ready";
      fetchedAt: string;
      total: number;
      // A later refresh failed. The last good graph and its date stay.
      lastError: "retry" | "invalid" | null;
    }
  // The profile shows private contributions, so public data cannot make a graph.
  | { state: "restricted" }
  | { state: "error"; kind: "retry" | "invalid" };

export type GraphStatus = {
  connection: null | {
    username: string;
    profileUrl: string;
    generation: number;
  };
  public: GraphPublicState;
  // Private activity for the selected account. `off` without a connection.
  private: PrivateState;
  // Whether the separate activity app is configured on this deployment.
  privateAvailable: boolean;
  // Whether this owner signed in with GitHub, so a username can be suggested.
  canDetect: boolean;
};

export type GraphEnvironment = {
  transport: GitHubTransport;
  platformToken: string;
  now?: () => number;
  activity?: PrivateEnvironment;
};

const profileUrl = (login: string) =>
  `https://github.com/${encodeURIComponent(login)}`;
const TRANSIENT = new Set(["credential", "rate", "server", "network"]);

function publicState(
  connection: NonNullable<
    Awaited<ReturnType<ReturnType<typeof ownerGithub>["getConnection"]>>
  >,
  activity:
    | Awaited<ReturnType<ReturnType<typeof ownerGithub>["getActivity"]>>
    | undefined,
): GraphPublicState {
  if (!activity || activity.generation !== connection.generation)
    return { state: "pending" };
  const error = activity.public_error as string | null;
  const kind = error ? (TRANSIENT.has(error) ? "retry" : "invalid") : null;
  let calendar: ReturnType<typeof parseCalendar> | null = null;
  try {
    calendar = activity.public_calendar
      ? parseCalendar(JSON.parse(activity.public_calendar as string))
      : null;
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
  if (kind) return { state: "error", kind };
  // A row with no calendar and no error only exists after a finished fetch.
  return connection.lastCheckedAt === null
    ? { state: "pending" }
    : { state: "restricted" };
}

export function ownerGraphSetup(
  db: D1Database,
  identity: SessionIdentity,
  env: GraphEnvironment,
) {
  const owner = ownerGithub(db, identity);
  const jobs = githubJobs(db);
  const now = () => env.now?.() ?? Date.now();
  const privateActivity = env.activity
    ? ownerPrivateActivity(db, identity, env.activity)
    : null;

  async function status(): Promise<GraphStatus> {
    const connection = await owner.getConnection();
    const canDetect = (await owner.signInAccountId()) !== null;
    const privateAvailable = privateActivity !== null;
    if (!connection)
      return {
        connection: null,
        public: { state: "pending" },
        private: { state: "off" },
        privateAvailable,
        canDetect,
      };
    // Without the activity app, an existing grant is still reported as data
    // state only: it can be withdrawn but not created or refreshed.
    const privateState: PrivateState = privateActivity
      ? await privateActivity.status()
      : connection.privateEnabled
        ? { state: "pending" }
        : { state: "off" };
    return {
      connection: {
        username: connection.identity.login,
        profileUrl: profileUrl(connection.identity.login),
        generation: connection.generation,
      },
      public: publicState(connection, await owner.getActivity()),
      private: privateState,
      privateAvailable,
      canDetect,
    };
  }

  async function fetchAndStore(
    connection: NonNullable<Awaited<ReturnType<typeof owner.getConnection>>>,
  ) {
    const ticket = {
      portfolioId: connection.portfolioId,
      generation: connection.generation,
      identity: connection.identity,
    };
    const at = now();
    const baseline = await fetchPublicBaseline(
      env.transport,
      env.platformToken,
      connection.identity,
      lastYearRange(new Date(at)),
      new Date(at).toISOString(),
    );
    // A selection that changed while the provider answered discards this result.
    return jobs.refresh(ticket, publicRefreshResult(baseline), at);
  }

  return {
    status,
    /**
     * Suggests a username from the owner's GitHub sign-in. It selects nothing
     * and creates no graph. A Google-only owner gets no suggestion.
     */
    async detect(): Promise<
      { ok: true; login: string | null } | { ok: false; error: GraphFailure }
    > {
      const accountId = await owner.signInAccountId();
      if (!accountId) return { ok: true, login: null };
      const found = await lookupLoginById(
        env.transport,
        env.platformToken,
        accountId,
      );
      if (found.status === "found") return { ok: true, login: found.login };
      if (found.status === "not_found") return { ok: true, login: null };
      return { ok: false, error: "unavailable" };
    },
    /**
     * Selects the typed username (detected or manual, with no sign-in link
     * required) and runs the first public fetch. Reselecting the same account
     * only retries the fetch. A different account clears every cached calendar.
     */
    async setup(
      username: string,
    ): Promise<
      { ok: true; status: GraphStatus } | { ok: false; error: GraphFailure }
    > {
      const typed = username.trim();
      if (!isGitHubLogin(typed))
        return { ok: false, error: "invalid_username" };
      let connection = await owner.getConnection();
      const same =
        connection?.identity.login.toLowerCase() === typed.toLowerCase();
      // One cooldown covers Retry and changing the account, so a client
      // cannot spend the shared platform credential faster than this.
      if (
        connection?.lastCheckedAt != null &&
        now() - connection.lastCheckedAt < GRAPH_RETRY_COOLDOWN_MS
      )
        return { ok: false, error: "too_soon" };
      if (!same) {
        const resolved = await resolvePublicIdentity(
          env.transport,
          env.platformToken,
          typed,
        );
        if (resolved.status === "not_found")
          return { ok: false, error: "not_found" };
        if (resolved.status === "retry")
          return { ok: false, error: "unavailable" };
        if (resolved.status === "invalid")
          return { ok: false, error: "misconfigured" };
        // The same stable account under a new capitalization needs no reset.
        if (
          connection &&
          sameIdentity(connection.identity, resolved.identity)
        ) {
          connection = { ...connection, identity: resolved.identity };
        } else {
          // A pending consent belongs to the old account. Selecting another
          // account withdraws its private access in the same transition.
          if (connection) await releaseUnusedConsent(db, identity, now());
          const selected = await owner.select(
            resolved.identity,
            connection ? connection.generation : null,
          );
          if (!selected) return { ok: false, error: "conflict" };
          connection = selected;
        }
      }
      if (!connection) return { ok: false, error: "no_graph" };
      // The selection is kept after a failed fetch so Retry needs no retyping.
      // The result is reported through status, not as a setup failure.
      await fetchAndStore(connection);
      return { ok: true, status: await status() };
    },
    /** Re-fetches the selected account, without changing it. */
    async retry(): Promise<
      { ok: true; status: GraphStatus } | { ok: false; error: GraphFailure }
    > {
      const connection = await owner.getConnection();
      if (!connection) return { ok: false, error: "no_graph" };
      if (
        connection.lastCheckedAt !== null &&
        now() - connection.lastCheckedAt < GRAPH_RETRY_COOLDOWN_MS
      )
        return { ok: false, error: "too_soon" };
      await fetchAndStore(connection);
      // The stored grant refreshes too. A 401 here withdraws private data.
      if (connection.privateEnabled && privateActivity)
        await privateActivity.refresh();
      return { ok: true, status: await status() };
    },
    /**
     * Owner-authorized draft data for the editor and full-page preview, for
     * the selected account. `includePrivate` is the owner's own draft choice:
     * the authorized calendar is used only while the grant is currently valid
     * for this account and generation. Draft choices never reach the public
     * endpoint, which reads the frozen published configuration instead.
     */
    async preview(includePrivate = false) {
      const connection = await owner.getConnection();
      if (!connection) return null;
      const state = await jobs.servingState(connection.portfolioId);
      if (!state) return null;
      return projectPublishedActivity(
        { ...connection.identity, includePrivate },
        state,
      );
    },
  };
}
