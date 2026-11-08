import { describe, expect, it } from "vitest";
import { parseCalendar } from "./contracts";
import {
  fetchPublicBaseline,
  type GitHubTransport,
  isGitHubLogin,
  lastYearRange,
  lookupLoginById,
  publicRefreshResult,
  resolvePublicIdentity,
} from "./public";

const selected = { id: "owner-node", login: "Fixture-Owner" };
const platform = { id: "platform-node", login: "platform" };
const now = new Date("2026-11-08T12:00:00Z");
const range = lastYearRange(now);
const fetchedAt = now.toISOString();

function days(count: number, total = 0) {
  const start = Date.parse(range.from);
  return [
    {
      contributionDays: Array.from({ length: count }, (_, index) => ({
        date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
        contributionCount: total && index === 0 ? total : 0,
      })),
    },
  ];
}
function reply(
  body: unknown,
  init: { status?: number; scopes?: string | null } = {},
): GitHubTransport {
  return async () => {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (init.scopes !== null) headers.set("X-OAuth-Scopes", init.scopes ?? "");
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers,
    });
  };
}
const calendarBody = (overrides: Record<string, unknown> = {}) => ({
  data: {
    viewer: platform,
    user: {
      ...selected,
      contributionsCollection: {
        restrictedContributionsCount: 0,
        contributionCalendar: { weeks: days(5, 3) },
        ...overrides,
      },
    },
  },
});
const baseline = (transport: GitHubTransport) =>
  fetchPublicBaseline(transport, "platform-token", selected, range, fetchedAt);

describe("public baseline classifier", () => {
  it("serves an available calendar with the stable fetch date", async () => {
    const result = await baseline(reply(calendarBody()));
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.calendar.fetchedAt).toBe(fetchedAt);
    expect(result.calendar.days).toHaveLength(5);
    expect(() => parseCalendar(result.calendar)).not.toThrow();
  });
  it("treats zero contributions as a valid, successful result", async () => {
    const body = calendarBody({
      contributionCalendar: { weeks: days(7, 0) },
    });
    const result = await baseline(reply(body));
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.calendar.days.every((day) => day.count === 0)).toBe(true);
    expect(publicRefreshResult(result)).toEqual({
      kind: "public",
      calendar: result.calendar,
    });
  });
  it("sends the platform credential without trusting a redirect", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    await baseline(async (url, init) => {
      seen = { url, init };
      return reply(calendarBody())(url, init);
    });
    expect(seen?.url).toBe("https://api.github.com/graphql");
    expect(seen?.init.redirect).toBe("manual");
    expect(new Headers(seen?.init.headers).get("Authorization")).toBe(
      "Bearer platform-token",
    );
    expect(JSON.parse(String(seen?.init.body)).variables).toEqual({
      login: "Fixture-Owner",
      ...range,
    });
  });
  it("never builds a calendar when private contributions are shown", async () => {
    const result = await baseline(
      reply(calendarBody({ restrictedContributionsCount: 432 })),
    );
    expect(result).toEqual({ status: "unavailable", reason: "restricted" });
    expect(publicRefreshResult(result)).toEqual({
      kind: "public",
      calendar: null,
    });
  });
  it.each([
    [401, "credential"],
    [403, "rate"],
    [429, "rate"],
    [500, "server"],
    [502, "server"],
  ] as const)(
    "classifies HTTP %i as a platform %s retry",
    async (status, reason) => {
      const result = await baseline(reply({}, { status }));
      expect(result).toEqual({ status: "retry", reason });
      // A platform failure is never an owner reconnect.
      expect(publicRefreshResult(result)).toEqual({
        kind: "error",
        source: "public",
        error: reason,
      });
    },
  );
  it("treats a redirect as a provider failure instead of following it", async () => {
    expect(
      await baseline(async () => new Response(null, { status: 302 })),
    ).toEqual({ status: "retry", reason: "server" });
  });
  it("classifies network failures and partial GraphQL errors as retries", async () => {
    expect(
      await baseline(async () => {
        throw new TypeError("network");
      }),
    ).toEqual({ status: "retry", reason: "network" });
    expect(
      await baseline(reply({ data: {}, errors: [{ type: "INTERNAL" }] })),
    ).toEqual({ status: "retry", reason: "server" });
  });
  it("fails closed on credential scope, identity and payload problems", async () => {
    for (const scopes of ["read:user", null])
      expect(await baseline(reply(calendarBody(), { scopes }))).toEqual({
        status: "invalid",
        reason: "scope",
      });
    const same = calendarBody();
    same.data.viewer = { ...selected };
    expect(await baseline(reply(same))).toEqual({
      status: "invalid",
      reason: "identity",
    });
    for (const bad of [
      calendarBody({ restrictedContributionsCount: -1 }),
      calendarBody({ contributionCalendar: { weeks: [] } }),
      calendarBody({
        contributionCalendar: {
          weeks: [
            {
              contributionDays: [{ date: "1999-01-01", contributionCount: 1 }],
            },
          ],
        },
      }),
      calendarBody({
        contributionCalendar: {
          weeks: [
            {
              contributionDays: [
                { date: range.from.slice(0, 10), contributionCount: 1.5 },
              ],
            },
          ],
        },
      }),
      { data: [] },
    ])
      expect((await baseline(reply(bad))).status).toBe("invalid");
    const result = publicRefreshResult({ status: "invalid", reason: "scope" });
    expect(result).toEqual({ kind: "error", source: "public", error: "scope" });
  });
  it("reports a missing, renamed or reassigned account as not found", async () => {
    expect(
      await baseline(
        reply({
          data: { viewer: platform, user: null },
          errors: [{ type: "NOT_FOUND", path: ["user"] }],
        }),
      ),
    ).toEqual({ status: "not_found" });
    const reassigned = calendarBody();
    reassigned.data.user.id = "someone-else";
    expect(await baseline(reply(reassigned))).toEqual({
      status: "not_found",
    });
    expect(publicRefreshResult({ status: "not_found" })).toEqual({
      kind: "error",
      source: "public",
      error: "identity",
    });
  });
  it("returns only the allowlisted calendar fields", async () => {
    const body = calendarBody();
    const week = body.data.user.contributionsCollection.contributionCalendar
      .weeks[0]?.contributionDays[0] as Record<string, unknown>;
    week.repository = "private/repo";
    week.color = "#fff";
    const result = await baseline(reply(body));
    expect(JSON.stringify(result)).not.toContain("private/repo");
    expect(JSON.stringify(result)).not.toContain("#fff");
  });
});

describe("username resolution", () => {
  it("returns the canonical login and stable account ID", async () => {
    const result = await resolvePublicIdentity(
      reply({ data: { viewer: platform, user: selected } }),
      "t",
      "fixture-owner",
    );
    expect(result).toEqual({ status: "found", identity: selected });
  });
  it("rejects invalid names before any request", async () => {
    let called = false;
    const transport: GitHubTransport = async () => {
      called = true;
      return new Response("{}");
    };
    for (const login of [
      "",
      "-bad",
      "bad-",
      "two--hyphens",
      "a".repeat(40),
      "a b",
    ])
      expect(await resolvePublicIdentity(transport, "t", login)).toEqual({
        status: "not_found",
      });
    expect(called).toBe(false);
    expect(isGitHubLogin("octo-cat")).toBe(true);
    expect(isGitHubLogin("octo--cat")).toBe(false);
  });
  it("distinguishes unknown accounts from platform failures", async () => {
    expect(
      await resolvePublicIdentity(
        reply({
          data: { viewer: platform, user: null },
          errors: [{ type: "NOT_FOUND", path: ["user"] }],
        }),
        "t",
        "nobody",
      ),
    ).toEqual({ status: "not_found" });
    expect(
      await resolvePublicIdentity(reply({}, { status: 500 }), "t", "nobody"),
    ).toEqual({ status: "retry", reason: "server" });
  });
  it("refuses the platform account and a login that does not match", async () => {
    expect(
      await resolvePublicIdentity(
        reply({ data: { viewer: platform, user: platform } }),
        "t",
        "platform",
      ),
    ).toEqual({ status: "invalid", reason: "identity" });
    expect(
      await resolvePublicIdentity(
        reply({ data: { viewer: platform, user: selected } }),
        "t",
        "someone-else",
      ),
    ).toEqual({ status: "invalid", reason: "identity" });
  });
});

describe("sign-in username suggestion", () => {
  const user = (body: Record<string, unknown>, status = 200) =>
    reply(body, { status, scopes: null });
  it("suggests the login for a numeric GitHub account", async () => {
    let url = "";
    const result = await lookupLoginById(
      async (target, init) => {
        url = target;
        return user({ id: 4242, login: "octo-cat", type: "User" })(
          target,
          init,
        );
      },
      "t",
      "4242",
    );
    expect(url).toBe("https://api.github.com/user/4242");
    expect(result).toEqual({ status: "found", login: "octo-cat" });
  });
  it("does not suggest organizations, mismatches or provider failures", async () => {
    expect(
      await lookupLoginById(
        user({ id: 4242, login: "org", type: "Organization" }),
        "t",
        "4242",
      ),
    ).toEqual({ status: "invalid" });
    expect(
      await lookupLoginById(
        user({ id: 1, login: "other", type: "User" }),
        "t",
        "4242",
      ),
    ).toEqual({ status: "invalid" });
    expect(await lookupLoginById(user({}, 404), "t", "4242")).toEqual({
      status: "not_found",
    });
    expect(await lookupLoginById(user({}, 500), "t", "4242")).toEqual({
      status: "retry",
    });
    expect(await lookupLoginById(user({}), "t", "not-a-number")).toEqual({
      status: "not_found",
    });
  });
});
