import {
  authorizedRefreshResult,
  fetchAuthorizedActivity,
  fetchViewer,
  type GitHubTransport,
  hasActivityScope,
  isGitHubLogin,
  lastYearRange,
  lookupLoginById,
  parseCalendar,
  projectPublishedActivity,
  resolvePublicIdentity,
  sameIdentity,
} from "@hasaweb/github";
import { githubJobs, ownerGithub } from "./github";
import {
  ownerPrivateActivity,
  type PrivateEnvironment,
  type PrivateState,
  releaseStaleReservation,
  releaseUnusedConsent,
} from "./github-private";
import { connectionRefreshDue, refreshPublicCalendar } from "./github-refresh";
import type { SessionIdentity } from "./repositories";

// GitHub graph setup for the signed-in owner. A graph shows public and
// private activity of one account the owner authorized: their GitHub sign-in
// (`connectSignIn`, with the sign-in token) or another account (`setup` and
// then consent in `github-private.ts`). The public baseline uses only the
// separate platform credential and public data, and is never mixed with the
// authorized calendar.

/** Retry and setup share one cooldown so a click cannot hammer the provider. */
export const GRAPH_RETRY_COOLDOWN_MS = 10_000;

export type GraphFailure =
  | "invalid_username"
  | "not_found"
  | "unavailable"
  | "misconfigured"
  | "too_soon"
  | "conflict"
  | "no_graph"
  // The sign-in token can't read private activity (missing, refused or too
  // few scopes). The owner authorizes on GitHub instead.
  | "reauthorize"
  // Earlier access for this account is still being revoked at GitHub.
  | "consent_busy"
  | "private_unavailable";

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
  // Whether private activity is configured on this deployment.
  privateAvailable: boolean;
  // Whether this owner signed in with GitHub, so their graph can connect
  // from that sign-in.
  githubSignIn: boolean;
};

export type GraphEnvironment = {
  transport: GitHubTransport;
  platformToken: string;
  now?: () => number;
  activity?: PrivateEnvironment;
  // Phase 42: a status read past the refresh TTL asks for a queued refresh.
  // The caller records and sends it outside the response (`waitUntil`).
  requestRefresh?: (portfolioId: string) => void;
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
    const githubSignIn = (await owner.signInAccount()) !== null;
    const privateAvailable = privateActivity !== null;
    if (!connection)
      return {
        connection: null,
        public: { state: "pending" },
        private: { state: "off" },
        privateAvailable,
        githubSignIn,
      };
    // Without the activity app, an existing grant is still reported as data
    // state only: it can be withdrawn but not created or refreshed.
    const privateState: PrivateState = privateActivity
      ? await privateActivity.status()
      : connection.privateEnabled
        ? { state: "pending" }
        : { state: "off" };
    // A graph past the TTL refreshes in the background, without Publish. A
    // selection that never fetched successfully stays with setup and Retry.
    if (env.requestRefresh) {
      const state = await jobs.servingState(connection.portfolioId);
      if (connectionRefreshDue(state, now(), { requireData: true }))
        env.requestRefresh(connection.portfolioId);
    }
    return {
      connection: {
        username: connection.identity.login,
        profileUrl: profileUrl(connection.identity.login),
        generation: connection.generation,
      },
      public: publicState(connection, await owner.getActivity()),
      private: privateState,
      privateAvailable,
      githubSignIn,
    };
  }

  // The same shared refresh the queue consumer runs (Phase 42).
  const fetchAndStore = (
    connection: NonNullable<Awaited<ReturnType<typeof owner.getConnection>>>,
  ) =>
    refreshPublicCalendar(
      db,
      {
        portfolioId: connection.portfolioId,
        generation: connection.generation,
        identity: connection.identity,
      },
      env,
      now(),
    );

  return {
    status,
    /**
     * The username of the owner's GitHub sign-in, for authorizing it on
     * GitHub when its sign-in token can't be used. It selects nothing and
     * creates no graph. A Google-only owner gets none.
     */
    async detect(): Promise<
      { ok: true; login: string | null } | { ok: false; error: GraphFailure }
    > {
      const account = await owner.signInAccount();
      if (!account) return { ok: true, login: null };
      const found = await lookupLoginById(
        env.transport,
        env.platformToken,
        account.accountId,
      );
      if (found.status === "found") return { ok: true, login: found.login };
      if (found.status === "not_found") return { ok: true, login: null };
      return { ok: false, error: "unavailable" };
    },
    /**
     * Connects the owner's GitHub sign-in account with public and private
     * activity. `decrypt` turns the stored sign-in token into plaintext.
     * The token is kept as this graph's encrypted grant for the sign-in app,
     * the same record a consented activity token gets, so refresh,
     * withdrawal and revocation work unchanged. `reauthorize` means the
     * sign-in token can't be used and the owner authorizes on GitHub.
     */
    async connectSignIn(
      decrypt: (stored: string) => Promise<string>,
    ): Promise<
      { ok: true; status: GraphStatus } | { ok: false; error: GraphFailure }
    > {
      const activity = env.activity;
      if (!activity) return { ok: false, error: "private_unavailable" };
      const stored = (await owner.signInAccount())?.accessToken;
      if (!stored) return { ok: false, error: "reauthorize" };
      // An undecryptable token (for example after a secret change) is one
      // the owner replaces by authorizing again.
      const token = await decrypt(stored).catch(() => null);
      if (!token) return { ok: false, error: "reauthorize" };
      const found = await fetchViewer(activity.transport, token);
      if (found.status === "failed")
        return {
          ok: false,
          error: found.error === "credential" ? "reauthorize" : "unavailable",
        };
      if (!hasActivityScope(found.scopes))
        return { ok: false, error: "reauthorize" };
      let connection = await owner.getConnection();
      // Already connected as this sign-in: return status. Do not apply the
      // retry cooldown, so a remount that races the first connect still
      // reports success and can write the account into the draft.
      if (
        connection &&
        sameIdentity(connection.identity, found.viewer) &&
        connection.privateEnabled &&
        connection.status === "ok"
      ) {
        await fetchAndStore(connection);
        return { ok: true, status: await status() };
      }
      if (
        connection?.lastCheckedAt != null &&
        now() - connection.lastCheckedAt < GRAPH_RETRY_COOLDOWN_MS
      )
        return { ok: false, error: "too_soon" };
      if (!connection || !sameIdentity(connection.identity, found.viewer)) {
        if (connection) await releaseUnusedConsent(db, identity, now());
        const selected = await owner.select(
          found.viewer,
          connection ? connection.generation : null,
        );
        if (!selected) return { ok: false, error: "conflict" };
        connection = selected;
      }
      if (!connection.privateEnabled || connection.status !== "ok") {
        const app = activity.signInApp.id;
        await releaseStaleReservation(db, app, found.viewer.id, now());
        // Waits for revocation of earlier access to this account, like consent.
        const ticket = await owner.beginConsent(app, connection.generation);
        if (!ticket) return { ok: false, error: "consent_busy" };
        // The reservation guards against a concurrent grant-wide revocation.
        // Releasing it is safe whenever this token was not stored: the
        // sign-in still holds the token, and nothing here issued it.
        const release = () => owner.cancelUnissuedConsent(ticket);
        const fetchedAt = new Date(now());
        const fetched = await fetchAuthorizedActivity(
          activity.transport,
          token,
          ticket.identity,
          lastYearRange(fetchedAt),
          fetchedAt.toISOString(),
        ).catch(async (error: unknown) => {
          await release();
          throw error;
        });
        if (fetched.status === "failed") {
          await release();
          return {
            ok: false,
            error:
              fetched.error === "credential" ? "reauthorize" : "unavailable",
          };
        }
        let enabled: Awaited<ReturnType<typeof owner.finishConsent>>;
        try {
          enabled = await owner.finishConsent(
            ticket,
            activity.key,
            token,
            "read:user",
            fetched.viewer,
          );
        } catch (error) {
          // The token named another account between the two reads. It is
          // already queued for revocation.
          if (
            error instanceof Error &&
            error.message === "Invalid activity consent"
          )
            return { ok: false, error: "reauthorize" };
          await release();
          throw error;
        }
        // The selection changed meanwhile. finishConsent queued the token.
        if (!enabled) return { ok: false, error: "conflict" };
        await jobs.refresh(
          {
            portfolioId: enabled.portfolioId,
            generation: enabled.generation,
            identity: enabled.identity,
          },
          authorizedRefreshResult(fetched, enabled.identity),
          now(),
        );
        connection = enabled;
      }
      await fetchAndStore(connection);
      return { ok: true, status: await status() };
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
