import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serveGitHubGraph } from "./github-graph";

const publicDays = [
  { date: "2026-11-01", count: 2 },
  { date: "2026-11-02", count: 0 },
];
const privateDays = [
  { date: "2026-11-01", count: 9 },
  { date: "2026-11-02", count: 5 },
];
const calendar = (days: typeof publicDays) =>
  JSON.stringify({ days, fetchedAt: "2026-11-03T00:00:00.000Z" });

type Fixture = {
  graph?: unknown;
  authorized?: boolean;
  connection?: { login: string; id: string };
  activityGeneration?: number;
  withAuthorized?: boolean;
  deleting?: boolean;
  // Phase 42: the published account's retained public calendar.
  retained?: { id: string; login: string; days: typeof publicDays };
  requests?: unknown[][];
};
// Two reads: the active version's frozen configuration, then serving state.
function database(fixture: Fixture): D1Database {
  const connection = fixture.connection ?? {
    login: "Fixture-Owner",
    id: "node-1",
  };
  return {
    prepare(sql: string) {
      return {
        bind: (...values: unknown[]) => ({
          first: async () => {
            if (sql.includes("INSERT INTO github_refresh")) {
              fixture.requests?.push(values);
              return { requested_at: values[0] };
            }
            if (sql.includes("FROM github_published_activity"))
              return fixture.retained && !fixture.deleting
                ? {
                    github_user_id: fixture.retained.id,
                    login: fixture.retained.login,
                    public_calendar: calendar(fixture.retained.days),
                  }
                : null;
            if (sql.includes("publication_candidate_index"))
              return fixture.graph === undefined
                ? null
                : {
                    portfolio_id: "p1",
                    graph:
                      typeof fixture.graph === "string"
                        ? fixture.graph
                        : JSON.stringify(fixture.graph),
                  };
            if (fixture.deleting) return null;
            return {
              login: connection.login,
              github_user_id: connection.id,
              generation: 3,
              authorized: fixture.authorized ? 1 : 0,
              cache_generation: fixture.activityGeneration ?? 3,
              public_calendar: calendar(publicDays),
              authorized_calendar: fixture.withAuthorized
                ? calendar(privateDays)
                : null,
            };
          },
        }),
      };
    },
  } as unknown as D1Database;
}
const frozen = (includePrivate: 0 | 1) => ({
  id: "node-1",
  login: "Fixture-Owner",
  includePrivate,
});
type Graph = { available: boolean; days: unknown[] };
const serve = (
  fixture: Fixture,
  method = "GET",
  refresh: Parameters<typeof serveGitHubGraph>[3] = {},
) =>
  serveGitHubGraph(
    new Request("https://site.hasaweb.site/_/github.json", { method }),
    database(fixture),
    "site",
    refresh,
  );
// The stored calendars were fetched at 2026-11-03T00:00Z.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T01:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("published GitHub graph endpoint", () => {
  it("serves the allowlisted public calendar with no-store headers", async () => {
    const response = await serve({ graph: frozen(0) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      username: "Fixture-Owner",
      profileUrl: "https://github.com/Fixture-Owner",
      available: true,
      fetchedAt: "2026-11-03T00:00:00.000Z",
      days: publicDays,
    });
  });
  it("never serves an authorized calendar for a public-only publication", async () => {
    // Draft consent and a stored private calendar alone expose nothing.
    const response = await serve({
      graph: frozen(0),
      authorized: true,
      withAuthorized: true,
    });
    const body = JSON.stringify(await response.json());
    expect(body).toContain('"count":2');
    expect(body).not.toContain('"count":9');
    expect(body).not.toContain('"count":5');
  });
  it("falls back to the public calendar until a private grant is valid", async () => {
    const response = await serve({
      graph: frozen(1),
      authorized: false,
      withAuthorized: true,
    });
    expect(((await response.json()) as Graph).days).toEqual(publicDays);
  });
  it("returns no graph when the active version froze none", async () => {
    for (const graph of [
      undefined,
      null,
      "not json",
      { id: "", login: "x" },
      { includePrivate: 0 },
      { id: null, login: null, includePrivate: 0 },
      { id: "node-1", includePrivate: 0 },
    ]) {
      const response = await serve({ graph: graph as never });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  });
  it("withdraws data when the selected account no longer matches the version", async () => {
    for (const connection of [
      { login: "someone-else", id: "node-1" },
      { login: "Fixture-Owner", id: "node-2" },
    ]) {
      const body = await (await serve({ graph: frozen(0), connection })).json();
      expect(body).toMatchObject({
        username: "Fixture-Owner",
        available: false,
        fetchedAt: null,
        days: [],
      });
    }
    const stale = (await (
      await serve({ graph: frozen(0), activityGeneration: 2 })
    ).json()) as Graph;
    expect(stale.available).toBe(false);
  });
  it("answers an owner being deleted with an unavailable graph", async () => {
    const response = await serve({ graph: frozen(0), deleting: true });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Graph).available).toBe(false);
  });
  it("answers HEAD without a body", async () => {
    const response = await serve({ graph: frozen(0) }, "HEAD");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("refresh-on-visit and the published account's retained graph (Phase 42)", () => {
  const visit = async (fixture: Fixture) => {
    const sent: unknown[] = [];
    const pending: Promise<unknown>[] = [];
    const response = await serve(fixture, "GET", {
      queue: { send: async (message) => sent.push(message) },
      background: { waitUntil: (work) => pending.push(work) },
    });
    await Promise.all(pending);
    return { response, sent };
  };
  it("serves the last good graph at once and requests one refresh past the six-hour TTL", async () => {
    const fresh = await visit({ graph: frozen(0), requests: [] });
    expect(fresh.sent).toEqual([]);
    vi.setSystemTime(new Date("2026-11-03T06:00:00.000Z"));
    const requests: unknown[][] = [];
    const due = await visit({ graph: frozen(0), requests });
    expect(((await due.response.json()) as Graph).days).toEqual(publicDays);
    expect(due.sent).toEqual([
      {
        kind: "github-refresh",
        portfolioId: "p1",
        requestedAt: Date.parse("2026-11-03T06:00:00.000Z"),
      },
    ]);
    expect(requests).toHaveLength(1);
  });
  it("counts an active grant's authorized calendar toward the TTL", async () => {
    // Public is fresh; the authorized calendar is old and the grant active.
    vi.setSystemTime(new Date("2026-11-03T05:00:00.000Z"));
    expect(
      (
        await visit({
          graph: frozen(1),
          authorized: true,
          withAuthorized: true,
        })
      ).sent,
    ).toEqual([]);
    vi.setSystemTime(new Date("2026-11-03T06:00:00.000Z"));
    expect(
      (
        await visit({
          graph: frozen(1),
          authorized: true,
          withAuthorized: true,
        })
      ).sent,
    ).toHaveLength(1);
  });
  it("requests nothing without a queue or a background context", async () => {
    vi.setSystemTime(new Date("2026-11-04T00:00:00.000Z"));
    const requests: unknown[][] = [];
    await serve({ graph: frozen(0), requests });
    expect(requests).toEqual([]);
  });
  it("serves the published account's retained public calendar after a draft account change", async () => {
    const retained = { id: "node-1", login: "Fixture-Owner", days: publicDays };
    const { response, sent } = await visit({
      graph: frozen(1),
      connection: { login: "someone-else", id: "node-2" },
      authorized: true,
      withAuthorized: true,
      retained,
    });
    const body = (await response.json()) as Graph & { username: string };
    expect(body.username).toBe("Fixture-Owner");
    expect(body.available).toBe(true);
    // Only public counts: the retained graph never carries authorization.
    expect(body.days).toEqual(publicDays);
    expect(JSON.stringify(body)).not.toContain('"count":9');
    expect(sent).toEqual([]);
  });
  it("never serves a retained calendar of another account", async () => {
    const body = (await (
      await serve({
        graph: frozen(0),
        connection: { login: "someone-else", id: "node-2" },
        retained: { id: "node-2", login: "someone-else", days: privateDays },
      })
    ).json()) as Graph;
    // The query is keyed by the frozen account; the mock ignores the key, so
    // the identity check in the projection is what rejects it here.
    expect(body.available).toBe(false);
  });
  it("requests a refresh that rebuilds a missing retained graph", async () => {
    const { response, sent } = await visit({
      graph: frozen(0),
      connection: { login: "someone-else", id: "node-2" },
    });
    expect(((await response.json()) as Graph).available).toBe(false);
    expect(sent).toHaveLength(1);
  });
});
