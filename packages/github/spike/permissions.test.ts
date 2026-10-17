import { describe, expect, it } from "vitest";
import { runFixtures } from "./fixtures";
import { fetchPublicBaseline, QUERY, type Transport } from "./permissions";

it("S-6 permission and privacy fixture matrix", async () => {
  const checks = await runFixtures();
  expect(checks.length).toBeGreaterThanOrEqual(35);
  expect(checks.every((check) => check.passed)).toBe(true);
});

const selected = { id: "U_TARGET", login: "target" };
const platform = { id: "U_PLATFORM", login: "platform" };
const range = { from: "2026-10-14T00:00:00Z", to: "2026-10-15T23:59:59Z" };
const fetchedAt = "2026-10-16T00:00:00.000Z";
function payload(viewer: typeof selected, restricted = 0, count = 2) {
  return {
    data: {
      viewer,
      user: {
        ...selected,
        contributionsCollection: {
          restrictedContributionsCount: restricted,
          contributionCalendar: {
            weeks: [
              {
                contributionDays: [
                  { date: "2026-10-14", contributionCount: count },
                ],
              },
            ],
          },
        },
      },
    },
  };
}
type Options = {
  status?: number;
  scope?: string;
  body?: unknown;
  network?: boolean;
  absentScopeHeader?: boolean;
};
function transport(options: Options = {}): Transport {
  return async (url, init) => {
    expect(url).toBe("https://api.github.com/graphql");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)).query).toBe(QUERY);
    if (options.network) throw new Error("SECRET_PROVIDER_ERROR");
    if (options.absentScopeHeader)
      return new Response(JSON.stringify(options.body ?? payload(platform)), {
        status: options.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    return Response.json(options.body ?? payload(platform), {
      status: options.status ?? 200,
      headers: { "X-OAuth-Scopes": options.scope ?? "" },
    });
  };
}
const load = (options: Options = {}) =>
  fetchPublicBaseline(
    transport(options),
    "platform-token",
    selected,
    range,
    fetchedAt,
  );

describe("S-6 public baseline classification for the platform credential", () => {
  it("accepts a separate zero-scope credential and returns the calendar", async () => {
    const result = await load();
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.calendar.days).toEqual([{ date: "2026-10-14", count: 2 }]);
    expect(result.calendar.fetchedAt).toBe(fetchedAt);
  });
  it("marks a baseline with restricted contributions unavailable, never summed", async () => {
    expect(await load({ body: payload(platform, 5) })).toEqual({
      status: "unavailable",
      reason: "restricted",
    });
  });
  it("classifies credential, rate, server, and network failures as platform retry", async () => {
    expect(await load({ status: 401 })).toEqual({
      status: "retry",
      reason: "credential",
    });
    expect(await load({ status: 403 })).toEqual({
      status: "retry",
      reason: "rate",
    });
    expect(await load({ status: 429 })).toEqual({
      status: "retry",
      reason: "rate",
    });
    expect(await load({ status: 503 })).toEqual({
      status: "retry",
      reason: "server",
    });
    expect(
      await load({
        body: { ...payload(platform), errors: [{ message: "SECRET" }] },
      }),
    ).toEqual({ status: "retry", reason: "server" });
    expect(await load({ network: true })).toEqual({
      status: "retry",
      reason: "network",
    });
  });
  it("fails closed on misconfigured credentials and malformed payloads", async () => {
    expect(await load({ scope: "repo" })).toEqual({
      status: "invalid",
      reason: "scope",
    });
    expect(await load({ absentScopeHeader: true })).toEqual({
      status: "invalid",
      reason: "scope",
    });
    expect(await load({ body: payload(selected) })).toEqual({
      status: "invalid",
      reason: "identity",
    });
    expect(await load({ body: { data: {} } })).toEqual({
      status: "invalid",
      reason: "payload",
    });
  });
  it("never turns a platform failure into an owner reconnect", async () => {
    const outcomes = await Promise.all([
      load({ status: 401 }),
      load({ status: 403 }),
      load({ status: 503 }),
      load({ network: true }),
      load({ scope: "repo" }),
      load({ body: payload(selected) }),
      load({ body: { data: {} } }),
    ]);
    expect(
      outcomes.every(
        (outcome) => outcome.status === "retry" || outcome.status === "invalid",
      ),
    ).toBe(true);
    expect(JSON.stringify(outcomes)).not.toContain("reconnect");
  });
});
