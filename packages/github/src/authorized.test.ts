import { describe, expect, it } from "vitest";
import {
  authorizedRefreshResult,
  fetchAuthorizedActivity,
  fetchViewer,
} from "./authorized";

const selected = { id: "node-owner", login: "Fixture-Owner" };
const range = {
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-03T12:00:00.000Z",
};
const fetchedAt = "2026-10-03T12:00:00.000Z";
const days = [
  { date: "2026-10-01", contributionCount: 3 },
  { date: "2026-10-02", contributionCount: 0 },
  { date: "2026-10-03", contributionCount: 9 },
];
const answer = (
  data: unknown,
  {
    status = 200,
    scopes = "read:user",
    errors,
  }: { status?: number; scopes?: string; errors?: unknown } = {},
) =>
  new Response(JSON.stringify({ data, ...(errors ? { errors } : {}) }), {
    status,
    headers: { "Content-Type": "application/json", "X-OAuth-Scopes": scopes },
  });
const user = (login = "fixture-owner", id = "node-owner") => ({
  id,
  login,
  contributionsCollection: {
    restrictedContributionsCount: 0,
    contributionCalendar: { weeks: [{ contributionDays: days }] },
    // Never requested, never kept.
    commitContributionsByRepository: [{ repository: { name: "secret" } }],
  },
});
const run = (response: Response | (() => Promise<Response>)) =>
  fetchAuthorizedActivity(
    async (url, init) => {
      expect(url).toBe("https://api.github.com/graphql");
      expect(init.redirect).toBe("manual");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer owner-token",
      );
      return typeof response === "function" ? response() : response;
    },
    "owner-token",
    selected,
    range,
    fetchedAt,
  );

describe("authorized activity fetch", () => {
  it("returns the matching account's complete calendar as an allowlist", async () => {
    const result = await run(
      answer({
        viewer: { id: "node-owner", login: "fixture-owner" },
        user: user(),
      }),
    );
    expect(result).toEqual({
      status: "answered",
      viewer: { id: "node-owner", login: "fixture-owner" },
      scopes: "read:user",
      error: null,
      calendar: {
        fetchedAt,
        days: [
          { date: "2026-10-01", count: 3 },
          { date: "2026-10-02", count: 0 },
          { date: "2026-10-03", count: 9 },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(authorizedRefreshResult(result, selected)).toEqual({
      kind: "authorized",
      calendar: result.status === "answered" ? result.calendar : null,
    });
  });
  it("names the token's account when it is not the selected one", async () => {
    const result = await run(
      answer({ viewer: { id: "node-other", login: "other" }, user: user() }),
    );
    expect(result).toMatchObject({
      status: "answered",
      viewer: { id: "node-other", login: "other" },
      calendar: null,
      error: "identity",
    });
    expect(authorizedRefreshResult(result, selected)).toEqual({
      kind: "error",
      source: "authorized",
      error: "identity",
    });
  });
  it("treats a renamed or missing selected login as an identity error", async () => {
    const result = await run(
      answer(
        { viewer: { id: "node-owner", login: "renamed" }, user: null },
        { errors: [{ type: "NOT_FOUND", path: ["user"] }] },
      ),
    );
    expect(result).toMatchObject({ status: "answered", error: "identity" });
    expect(authorizedRefreshResult(result, selected)).toMatchObject({
      error: "identity",
    });
  });
  it("requires exactly read:user", async () => {
    for (const scopes of ["", "read:user, repo", "user"]) {
      const result = await run(
        answer(
          {
            viewer: { id: "node-owner", login: "fixture-owner" },
            user: user(),
          },
          { scopes },
        ),
      );
      expect(authorizedRefreshResult(result, selected)).toEqual({
        kind: "error",
        source: "authorized",
        error: "scope",
      });
    }
  });
  it("classifies transport and provider failures", async () => {
    expect(await run(new Response(null, { status: 401 }))).toEqual({
      status: "failed",
      error: "credential",
    });
    expect(await run(new Response(null, { status: 403 }))).toEqual({
      status: "failed",
      error: "rate",
    });
    expect(await run(new Response(null, { status: 502 }))).toEqual({
      status: "failed",
      error: "server",
    });
    expect(await run(new Response(null, { status: 302 }))).toEqual({
      status: "failed",
      error: "server",
    });
    expect(await run(new Response("not json"))).toEqual({
      status: "failed",
      error: "payload",
    });
    expect(
      await run(async () => {
        throw new Error("offline");
      }),
    ).toEqual({ status: "failed", error: "network" });
  });
  it("keeps the verified viewer when the calendar payload is invalid", async () => {
    const broken = user();
    broken.contributionsCollection.contributionCalendar.weeks = [];
    const result = await run(
      answer({
        viewer: { id: "node-owner", login: "fixture-owner" },
        user: broken,
      }),
    );
    expect(result).toMatchObject({
      status: "answered",
      viewer: { id: "node-owner" },
      calendar: null,
      error: "payload",
    });
    expect(authorizedRefreshResult(result, selected)).toMatchObject({
      error: "payload",
    });
  });
});

describe("token viewer", () => {
  const viewer = (response: Response | (() => Promise<Response>)) =>
    fetchViewer(async (url, init) => {
      expect(url).toBe("https://api.github.com/graphql");
      expect(init.redirect).toBe("manual");
      expect(String(init.body)).not.toContain("user(");
      return typeof response === "function" ? response() : response;
    }, "owner-token");
  it("names the token's account and reports its scopes", async () => {
    expect(
      await viewer(
        answer(
          { viewer: { id: "node-owner", login: "Fixture-Owner" } },
          { scopes: "read:user, user:email" },
        ),
      ),
    ).toEqual({
      status: "answered",
      viewer: selected,
      scopes: "read:user, user:email",
    });
  });
  it("classifies refused, failed and unusable answers", async () => {
    expect(await viewer(answer(null, { status: 401 }))).toEqual({
      status: "failed",
      error: "credential",
    });
    expect(await viewer(answer(null, { status: 403 }))).toEqual({
      status: "failed",
      error: "rate",
    });
    expect(await viewer(answer(null, { status: 502 }))).toEqual({
      status: "failed",
      error: "server",
    });
    expect(await viewer(answer({ viewer: { id: "x" } }))).toEqual({
      status: "failed",
      error: "payload",
    });
    expect(
      await viewer(async () => {
        throw new TypeError("offline");
      }),
    ).toEqual({ status: "failed", error: "network" });
  });
});
