import {
  type GitHubIdentity,
  type GitHubTransport,
  PRIVATE_SWEEP_INTERVAL_MS,
  type PublishedGraph,
  projectPublishedActivity,
  REFRESH_REQUEST_WINDOW_MS,
  REFRESH_TTL_MS,
  type RefreshMessage,
} from "@hasaweb/github";
import { githubJobs, ownerGithub } from "../src/github";
import {
  type ownerPrivateActivity,
  withdrawPrivateActivity,
} from "../src/github-private";
import {
  claimGitHubRefresh,
  connectionRefreshDue,
  dueGitHubSweep,
  publishedFallbackState,
  refreshAuthorizedCalendar,
  requestGitHubRefresh,
  runGitHubRefresh,
} from "../src/github-refresh";
import { ownerGraphSetup } from "../src/github-setup";
import type { Account, FakeGitHub } from "./github-private";

// Phase 42 independent refresh against real D1: request deduplication and
// claims, refresh without Publish, last good data on failure, revocation on
// the next refresh, stale results racing withdrawal and reconnect, the daily
// sweep, owner status reads, and the published account's retained graph
// after a draft account change.

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
}
function ok(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

type Identity = Parameters<typeof ownerGithub>[1];
type Prepared = {
  identity: Identity;
  github: FakeGitHub;
  owner: ReturnType<typeof ownerGithub>;
  service: ReturnType<typeof ownerPrivateActivity>;
  setup: ReturnType<typeof ownerGraphSetup>;
  cleanup: () => Promise<string[]>;
  consent: (as?: GitHubIdentity | "cancel") => Promise<{
    url: string;
    params: { state: string | null; code: string | null; error: string | null };
  }>;
  selected: Account;
  other: Account;
  second: Account;
  portfolioId: string;
};

export async function runRefreshChecks({
  db,
  check,
  prepared,
  makeOwner,
  key,
  clock,
}: {
  db: D1Database;
  check: (name: string, action: () => Promise<void>) => Promise<void>;
  prepared: (id: string) => Promise<Prepared>;
  makeOwner: (id: string) => Promise<Identity>;
  key: CryptoKey;
  clock: { now(): number; advance(ms: number): number };
}) {
  const jobs = githubJobs(db);
  const total = (graph: ReturnType<typeof projectPublishedActivity>) =>
    graph?.available
      ? graph.days.reduce((sum, day) => sum + day.count, 0)
      : null;
  const live = async (portfolioId: string, published: PublishedGraph) => {
    const graph = projectPublishedActivity(
      published,
      await jobs.servingState(portfolioId),
    );
    if (graph?.available) return graph;
    // The site's fallback: the published account's retained public calendar.
    return projectPublishedActivity(
      published,
      await publishedFallbackState(db, portfolioId, published),
    );
  };
  /** Makes a version live whose sealed index freezes this graph. */
  async function publish(
    portfolioId: string,
    graph: PublishedGraph | null,
    n: number,
  ) {
    const candidate = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "UPDATE publish_version SET status='superseded' WHERE portfolio_id=? AND status='live'",
        )
        .bind(portfolioId),
      db
        .prepare(
          "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,status,cursor,next_attempt_at,deadline_at,created_at,updated_at) SELECT ?,id,user_id,0,'ready','[]',0,0,1,1 FROM portfolio WHERE id=?",
        )
        .bind(candidate, portfolioId),
      db
        .prepare(
          "INSERT INTO publication_candidate_index(candidate_id,value) VALUES(?,?)",
        )
        .bind(
          candidate,
          JSON.stringify(
            graph
              ? {
                  graph: {
                    id: graph.id,
                    login: graph.login,
                    includePrivate: graph.includePrivate ? 1 : 0,
                  },
                }
              : {},
          ),
        ),
      db
        .prepare(
          "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) VALUES(?,?,?,'live','publication-v7',?,1,1)",
        )
        .bind(candidate, portfolioId, n, candidate),
      db
        .prepare(
          "UPDATE portfolio SET status='published',published_version=? WHERE id=?",
        )
        .bind(n, portfolioId),
    ]);
  }
  const envFor = (
    t: Prepared,
    transport: GitHubTransport = t.github.transport,
  ) => ({
    public: { transport, platformToken: "platform-token" },
    authorized: { transport, key },
  });
  /** Requests (past the window when needed) and runs one refresh. */
  async function refreshNow(
    t: Prepared,
    transport: GitHubTransport = t.github.transport,
  ) {
    const message = await requestGitHubRefresh(db, t.portfolioId, clock.now());
    ok(message, "refresh requested");
    return runGitHubRefresh(db, message, envFor(t, transport), clock.now());
  }
  const sideRows = (portfolioId: string) =>
    db
      .prepare(
        "SELECT github_user_id,public_calendar FROM github_published_activity WHERE portfolio_id=?",
      )
      .bind(portfolioId)
      .all<{ github_user_id: string; public_calendar: string | null }>();
  const operation = async (portfolioId: string) =>
    (
      await db
        .prepare(
          "SELECT grant_operation FROM github_connection WHERE portfolio_id=?",
        )
        .bind(portfolioId)
        .first<{ grant_operation: string | null }>()
    )?.grant_operation ?? null;
  const grantState = (account: GitHubIdentity) =>
    db
      .prepare("SELECT state FROM github_grant WHERE github_user_id=?")
      .bind(account.id)
      .first<{ state: string }>();
  async function connect(t: Prepared) {
    const { params } = await t.consent();
    equal((await t.service.callback(params)).outcome, "connected");
  }
  const graphOf = (account: GitHubIdentity, includePrivate: boolean) => ({
    id: account.id,
    login: account.login,
    includePrivate,
  });

  await check(
    "Refresh requests: one message per window and one claim per request; lost or crashed work is requested again",
    async () => {
      const t = await prepared("gh-refresh-dedupe");
      const first = await requestGitHubRefresh(db, t.portfolioId, clock.now());
      ok(first, "first request");
      equal(
        await requestGitHubRefresh(db, t.portfolioId, clock.now() + 1000),
        null,
      );
      equal(await claimGitHubRefresh(db, first, clock.now()), true);
      // A duplicate delivery of the same request does nothing.
      equal(await claimGitHubRefresh(db, first, clock.now()), false);
      // A consumer that crashed after claiming is recovered by a newer request.
      const later = await requestGitHubRefresh(
        db,
        t.portfolioId,
        clock.now() + REFRESH_REQUEST_WINDOW_MS,
      );
      ok(later && later.requestedAt > first.requestedAt, "later request");
      equal(await claimGitHubRefresh(db, first, clock.now()), false);
      equal(
        await claimGitHubRefresh(
          db,
          later,
          clock.now() + REFRESH_REQUEST_WINDOW_MS,
        ),
        true,
      );
      equal(
        await requestGitHubRefresh(db, "portfolio-missing", clock.now()),
        null,
      );
      // Run without a claim: a superseded message changes nothing.
      equal(
        (await runGitHubRefresh(db, first, envFor(t), clock.now())).claimed,
        false,
      );
    },
  );

  await check(
    "Refresh: a published graph updates without Publish, and a failed refresh keeps the last good graph and date",
    async () => {
      const t = await prepared("gh-refresh-public");
      const published = graphOf(t.selected, false);
      await publish(t.portfolioId, published, 1);
      equal(total(await live(t.portfolioId, published)), 2);
      const state = await jobs.servingState(t.portfolioId);
      equal(connectionRefreshDue(state, clock.now()), false);
      equal(connectionRefreshDue(state, clock.now() + REFRESH_TTL_MS), true);

      t.selected.public = 5;
      clock.advance(REFRESH_TTL_MS);
      const at = clock.now();
      equal((await refreshNow(t)).claimed, true);
      let graph = await live(t.portfolioId, published);
      equal(total(graph), 5);
      equal(graph?.fetchedAt, new Date(at).toISOString());

      // GitHub fails: the last good graph and its date stay, and the owner
      // sees the failure with Retry.
      clock.advance(REFRESH_TTL_MS);
      const down: GitHubTransport = async () =>
        new Response("{}", { status: 502 });
      const failed = await refreshNow(t, down);
      equal(failed.failed, []);
      graph = await live(t.portfolioId, published);
      equal(total(graph), 5);
      equal(graph?.fetchedAt, new Date(at).toISOString());
      const status = await t.setup.status();
      equal(status.public.state, "ready");
      ok(
        status.public.state === "ready" && status.public.lastError === "retry",
        "failure reported",
      );
      // Still due, but the window holds the next request back.
      equal(
        connectionRefreshDue(
          await jobs.servingState(t.portfolioId),
          clock.now(),
        ),
        true,
      );
      equal(
        await requestGitHubRefresh(db, t.portfolioId, clock.now() + 60_000),
        null,
      );
      clock.advance(REFRESH_REQUEST_WINDOW_MS);
      await refreshNow(t);
      const repaired = await t.setup.status();
      ok(
        repaired.public.state === "ready" && repaired.public.lastError === null,
        "repaired",
      );
    },
  );

  await check(
    "Refresh: private counts refresh, and access revoked on GitHub is withdrawn on the next refresh without Publish",
    async () => {
      const t = await prepared("gh-refresh-private");
      await connect(t);
      const published = graphOf(t.selected, true);
      await publish(t.portfolioId, published, 1);
      equal(total(await live(t.portfolioId, published)), 9);
      t.selected.all = 12;
      clock.advance(REFRESH_TTL_MS);
      equal((await refreshNow(t)).withdrawn, false);
      equal(total(await live(t.portfolioId, published)), 12);

      // The owner removes the app on GitHub. The next refresh sees 401.
      t.github.revokeAll(t.selected);
      clock.advance(REFRESH_TTL_MS);
      equal((await refreshNow(t)).withdrawn, true);
      equal(total(await live(t.portfolioId, published)), 2);
      equal((await t.service.status()).state, "reconnect");
      equal((await grantState(t.selected))?.state, "pending");
      // The dead-token proof releases cleanup; Reconnect works again.
      await t.cleanup();
      equal((await grantState(t.selected))?.state, "idle");
      await connect(t);
      equal(total(await live(t.portfolioId, published)), 12);
    },
  );

  await check(
    "Refresh: a stale response or error cannot restore withdrawn access or withdraw a newer grant",
    async () => {
      const t = await prepared("gh-refresh-race");
      await connect(t);
      const published = graphOf(t.selected, true);
      await publish(t.portfolioId, published, 1);

      // Withdrawal lands while the refresh waits for GitHub.
      t.selected.all = 20;
      let once = true;
      const withdrawing: GitHubTransport = async (url, init) => {
        const response = await t.github.transport(url, init);
        const bearer = String(
          (init.headers as Record<string, string>).Authorization ?? "",
        );
        if (once && !bearer.includes("platform-token")) {
          once = false;
          ok(
            await withdrawPrivateActivity(db, t.identity, clock.now()),
            "withdrawn",
          );
        }
        return response;
      };
      clock.advance(REFRESH_TTL_MS);
      await refreshNow(t, withdrawing);
      equal(total(await live(t.portfolioId, published)), 2);
      const row = await db
        .prepare(
          "SELECT c.private_enabled,a.authorized_calendar FROM github_connection c JOIN github_activity a USING(portfolio_id) WHERE c.portfolio_id=?",
        )
        .bind(t.portfolioId)
        .first<Record<string, unknown>>();
      equal(row, { private_enabled: 0, authorized_calendar: null });

      // An old refresh captured the first grant. Before GitHub answers, the
      // owner withdraws, cleanup revokes that grant and the owner reconnects.
      // GitHub then refuses the old token: that 401 must not touch the new grant.
      equal(await t.cleanup(), ["deleted"]);
      await connect(t);
      const first = await operation(t.portfolioId);
      let replaced: string | null = null;
      const reconnecting: GitHubTransport = async (url, init) => {
        const bearer = String(
          (init.headers as Record<string, string>).Authorization ?? "",
        );
        if (replaced === null && !bearer.includes("platform-token")) {
          ok(
            await withdrawPrivateActivity(db, t.identity, clock.now()),
            "withdrawn mid-flight",
          );
          equal(await t.cleanup(), ["deleted"]);
          await connect(t);
          replaced = await operation(t.portfolioId);
          return new Response("{}", { status: 401 });
        }
        return t.github.transport(url, init);
      };
      clock.advance(REFRESH_REQUEST_WINDOW_MS);
      const result = await refreshNow(t, reconnecting);
      ok(replaced && replaced !== first, "a new grant replaced the first");
      equal(result.withdrawn, false);
      equal(await operation(t.portfolioId), replaced);
      const final = await db
        .prepare(
          "SELECT private_enabled,status FROM github_connection WHERE portfolio_id=?",
        )
        .bind(t.portfolioId)
        .first<Record<string, unknown>>();
      equal(final, { private_enabled: 1, status: "ok" });
      equal((await grantState(t.selected))?.state, "active");
      equal(total(await live(t.portfolioId, published)), 20);
    },
  );

  await check(
    "Daily sweep: requests only due private connections, in bounded and deduplicated batches",
    async () => {
      const due = await prepared("gh-sweep-due");
      const fresh = await prepared("gh-sweep-fresh");
      const off = await prepared("gh-sweep-off");
      await connect(due);
      await connect(fresh);
      const start = clock.now();
      // `fresh` refreshed an hour before the sweep; `due` a day before.
      clock.advance(PRIVATE_SWEEP_INTERVAL_MS - 60 * 60_000);
      await refreshAuthorizedCalendar(
        db,
        fresh.portfolioId,
        { transport: fresh.github.transport, key },
        clock.now(),
      );
      const at = clock.advance(60 * 60_000);
      ok(at - start >= PRIVATE_SWEEP_INTERVAL_MS, "a day passed");
      const mine = new Set([
        due.portfolioId,
        fresh.portfolioId,
        off.portfolioId,
      ]);
      const ours = (messages: RefreshMessage[]) =>
        messages
          .filter((m) => mine.has(m.portfolioId))
          .map((m) => m.portfolioId);
      // Bounded: one call never requests more than its batch.
      const swept = await dueGitHubSweep(db, at, 1);
      ok(swept.length <= 1, "bounded batch");
      // Other checks leave due private connections too; drain them all.
      for (let batch = 0; batch < 20; batch++) {
        const more = await dueGitHubSweep(db, at, 100);
        if (!more.length) break;
        swept.push(...more);
      }
      // Only the due connection, and only once.
      equal(ours(swept), [due.portfolioId]);
      // Within the window the same connection is not requested again.
      equal(ours(await dueGitHubSweep(db, at + 60_000, 100)), []);
      // The consumer validates the token and refreshes; then it is not due.
      due.selected.all = 15;
      const message = {
        kind: "github-refresh" as const,
        portfolioId: due.portfolioId,
        requestedAt: at,
      };
      equal(
        (await runGitHubRefresh(db, message, envFor(due), at)).claimed,
        true,
      );
      equal(
        total(
          projectPublishedActivity(
            graphOf(due.selected, true),
            await jobs.servingState(due.portfolioId),
          ),
        ),
        15,
      );
      equal(
        ours(await dueGitHubSweep(db, at + REFRESH_REQUEST_WINDOW_MS, 100)),
        [],
      );
    },
  );

  await check(
    "Owner status: a graph past the TTL asks for one background refresh; a selection that never fetched does not",
    async () => {
      const t = await prepared("gh-refresh-status");
      const requested: string[] = [];
      const setup = ownerGraphSetup(db, t.identity, {
        transport: t.github.transport,
        platformToken: "platform-token",
        now: () => clock.now(),
        requestRefresh: (portfolioId) => requested.push(portfolioId),
      });
      await setup.status();
      equal(requested, []);
      clock.advance(REFRESH_TTL_MS);
      const status = await setup.status();
      // The last good graph is reported while the refresh runs.
      equal(status.public.state, "ready");
      equal(requested, [t.portfolioId]);

      const blank = await makeOwner("gh-refresh-blank");
      await ownerGithub(db, blank).select(
        { id: "node-gh-refresh-blank", login: "gh-refresh-blank" },
        null,
      );
      const blankRequested: string[] = [];
      await ownerGraphSetup(db, blank, {
        transport: t.github.transport,
        platformToken: "platform-token",
        now: () => clock.now(),
        requestRefresh: (portfolioId) => blankRequested.push(portfolioId),
      }).status();
      equal(blankRequested, []);
    },
  );

  await check(
    "Published account: a draft account change keeps the published public graph live and refreshing until the next Publish",
    async () => {
      const t = await prepared("gh-refresh-switch");
      await connect(t);
      const published = graphOf(t.selected, true);
      await publish(t.portfolioId, published, 1);
      equal(total(await live(t.portfolioId, published)), 9);

      // The draft selects another account. Private access is withdrawn at
      // once; the live graph keeps the published account's public counts.
      clock.advance(60_000);
      const switched = await t.setup.setup(t.second.login);
      ok(switched.ok, "switched");
      equal((await grantState(t.selected))?.state, "pending");
      let rows = (await sideRows(t.portfolioId)).results;
      equal(
        rows.map((row) => row.github_user_id),
        [t.selected.id],
      );
      // Only the public calendar (2), never the authorized one (9).
      equal(
        rows.map((row) =>
          (
            JSON.parse(String(row.public_calendar)) as {
              days: { count: number }[];
            }
          ).days.reduce((sum, day) => sum + day.count, 0),
        ),
        [2],
      );
      let graph = await live(t.portfolioId, published);
      equal(graph?.username, t.selected.login);
      equal(total(graph), 2);
      ok(
        !projectPublishedActivity(
          published,
          await jobs.servingState(t.portfolioId),
        )?.available,
        "connection no longer serves the published account",
      );

      // The retained graph refreshes without Publish.
      t.selected.public = 6;
      clock.advance(REFRESH_TTL_MS);
      await refreshNow(t);
      graph = await live(t.portfolioId, published);
      equal(total(graph), 6);
      equal(graph?.fetchedAt, new Date(clock.now()).toISOString());

      // A lost retained row (a Publish racing the switch) is rebuilt.
      await db
        .prepare("DELETE FROM github_published_activity WHERE portfolio_id=?")
        .bind(t.portfolioId)
        .run();
      equal(
        await live(t.portfolioId, published).then((g) => g?.available),
        false,
      );
      clock.advance(REFRESH_REQUEST_WINDOW_MS);
      await refreshNow(t);
      equal(total(await live(t.portfolioId, published)), 6);

      // Selecting the published account again: the connection serves it and
      // the retained row goes on the next refresh.
      clock.advance(60_000);
      ok((await t.setup.setup(t.selected.login)).ok, "switched back");
      // Leaving an unpublished account retains nothing of it.
      equal(
        (await sideRows(t.portfolioId)).results.map(
          (row) => row.github_user_id,
        ),
        [t.selected.id],
      );
      equal(total(await live(t.portfolioId, published)), 6);
      clock.advance(REFRESH_REQUEST_WINDOW_MS);
      await refreshNow(t);
      equal((await sideRows(t.portfolioId)).results, []);

      // After Publish of the other account, nothing old is retained.
      clock.advance(60_000);
      ok((await t.setup.setup(t.second.login)).ok, "switched again");
      equal((await sideRows(t.portfolioId)).results.length, 1);
      await publish(t.portfolioId, graphOf(t.second, false), 2);
      clock.advance(REFRESH_REQUEST_WINDOW_MS);
      await refreshNow(t);
      equal((await sideRows(t.portfolioId)).results, []);
      equal(total(await live(t.portfolioId, graphOf(t.second, false))), 3);
      // A version without a graph retains nothing either.
      clock.advance(60_000);
      ok((await t.setup.setup(t.selected.login)).ok, "switched to the first");
      equal(
        (await sideRows(t.portfolioId)).results.map(
          (row) => row.github_user_id,
        ),
        [t.second.id],
      );
      await publish(t.portfolioId, null, 3);
      clock.advance(REFRESH_REQUEST_WINDOW_MS);
      await refreshNow(t);
      rows = (await sideRows(t.portfolioId)).results;
      equal(rows, []);
    },
  );
}
