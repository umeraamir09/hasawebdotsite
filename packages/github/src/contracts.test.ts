import { describe, expect, it } from "vitest";
import {
  type GraphState,
  parseCalendar,
  projectPublishedActivity,
} from "./contracts";
import {
  activityCleanupKind,
  credentialBinding,
  decryptActivityToken,
  deleteActivityCredential,
  deleteActivityGrant,
  encryptActivityToken,
} from "./credentials";

const identity = { id: "fixture-id", login: "fixture-owner" };
const calendar = (count: number) => ({
  days: [{ date: "2026-10-16", count }],
  fetchedAt: "2026-10-17T00:00:00Z",
  token: "must not appear",
});
const state = (): GraphState => ({
  identity,
  generation: 2,
  privateAuthorized: true,
  activity: {
    generation: 2,
    publicCalendar: calendar(2),
    authorizedCalendar: calendar(7),
  },
});

describe("published GitHub calendar contract", () => {
  it("selects the complete authorized calendar without adding or subtracting", () => {
    const result = projectPublishedActivity(
      { ...identity, includePrivate: true },
      state(),
    );
    expect(result).toEqual({
      username: identity.login,
      profileUrl: `https://github.com/${identity.login}`,
      available: true,
      fetchedAt: "2026-10-17T00:00:00.000Z",
      days: [{ date: "2026-10-16", count: 7 }],
    });
    expect(JSON.stringify(result)).not.toContain("token");
  });
  it("requires a published private choice despite a valid draft grant", () => {
    expect(projectPublishedActivity(null, state())).toBeNull();
    expect(
      projectPublishedActivity({ ...identity, includePrivate: false }, state())
        ?.days[0]?.count,
    ).toBe(2);
  });
  it("falls back only to an independently safe baseline after withdrawal", () => {
    const value = state();
    value.privateAuthorized = false;
    expect(
      projectPublishedActivity({ ...identity, includePrivate: true }, value)
        ?.days[0]?.count,
    ).toBe(2);
    if (value.activity) value.activity.publicCalendar = null;
    expect(
      projectPublishedActivity({ ...identity, includePrivate: true }, value)
        ?.available,
    ).toBe(false);
  });
  it("checks stable identity, case-insensitive username, and generation", () => {
    expect(
      projectPublishedActivity(
        {
          ...identity,
          login: identity.login.toUpperCase(),
          includePrivate: true,
        },
        state(),
      )?.available,
    ).toBe(true);
    for (const changed of [{ id: "wrong" }, { login: "wrong" }])
      expect(
        projectPublishedActivity(
          { ...identity, ...changed, includePrivate: true },
          state(),
        )?.available,
      ).toBe(false);
    const value = state();
    value.generation++;
    expect(
      projectPublishedActivity({ ...identity, includePrivate: true }, value)
        ?.available,
    ).toBe(false);
  });
  it("does not reinterpret legacy arrays or corrupt caches", () => {
    const value = state();
    if (value.activity)
      value.activity.authorizedCalendar = [{ date: "2026-10-16", count: 7 }];
    expect(
      projectPublishedActivity({ ...identity, includePrivate: true }, value)
        ?.available,
    ).toBe(false);
  });
  it("allows zero contributions and strips unexpected provider fields", () => {
    expect(
      parseCalendar({
        ...calendar(0),
        days: [{ date: "2026-10-16", count: 0, repository: "private" }],
      }),
    ).toEqual({
      days: [{ date: "2026-10-16", count: 0 }],
      fetchedAt: "2026-10-17T00:00:00.000Z",
    });
  });
  it("rejects invalid dates, duplicate dates, negative/fractional counts and empty caches", () => {
    for (const days of [
      [],
      [{ date: "2026-02-30", count: 1 }],
      [{ date: "2026-10-16", count: -1 }],
      [{ date: "2026-10-16", count: 1.2 }],
      [
        { date: "2026-10-16", count: 1 },
        { date: "2026-10-16", count: 2 },
      ],
    ])
      expect(() => parseCalendar({ ...calendar(1), days })).toThrow();
  });
});

describe("activity credentials and grant deletion", () => {
  it("encrypts with random IVs and binds ciphertext to portfolio, app, account and operation", async () => {
    const key = (await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    )) as CryptoKey;
    const parts = ["portfolio", "app", "account", "operation"] as const;
    const binding = credentialBinding(...parts);
    const first = await encryptActivityToken(key, "fixture-secret", binding);
    expect(first).not.toContain("fixture-secret");
    expect(first).not.toBe(
      await encryptActivityToken(key, "fixture-secret", binding),
    );
    expect(await decryptActivityToken(key, first, binding)).toBe(
      "fixture-secret",
    );
    for (let i = 0; i < parts.length; i++) {
      const changed = [...parts] as [string, string, string, string];
      changed[i] = "different";
      await expect(
        decryptActivityToken(key, first, credentialBinding(...changed)),
      ).rejects.toThrow();
    }
    const otherKey = (await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    )) as CryptoKey;
    await expect(
      decryptActivityToken(otherKey, first, binding),
    ).rejects.toThrow();
  });
  it("uses only confirmed 204 deletion to release cleanup", async () => {
    const app = { id: "activity-app", secret: "fixture-client-secret" };
    for (const status of [
      204, 301, 302, 303, 307, 308, 401, 403, 404, 422, 429, 500,
    ]) {
      const outcome = await deleteActivityGrant(
        async (url, init) => {
          expect(url).toBe(
            "https://api.github.com/applications/activity-app/grant",
          );
          expect(init.method).toBe("DELETE");
          // Workers reject "error"; a redirect must stay a retry.
          expect(init.redirect).toBe("manual");
          expect(JSON.parse(String(init.body))).toEqual({
            access_token: "fixture-token",
          });
          return new Response(null, { status });
        },
        app,
        "fixture-token",
      );
      expect(outcome).toBe(status === 204 ? "deleted" : "retry");
    }
  });
  it("authenticates token-only cleanup purpose without changing existing grant bindings", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(32).fill(17),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
    const parts = ["portfolio", "app", "account", "operation"] as const;
    const binding = credentialBinding(...parts, "token");
    const envelope = await encryptActivityToken(key, "rejected-token", binding);
    expect(activityCleanupKind(binding)).toBe("token");
    expect(activityCleanupKind(credentialBinding(...parts))).toBe("grant");
    expect(() => activityCleanupKind('["unknown-purpose"]')).toThrow();
    await expect(
      decryptActivityToken(key, envelope, credentialBinding(...parts)),
    ).rejects.toThrow();
    expect(
      await deleteActivityCredential(
        async (url, init) => {
          expect(url).toBe("https://api.github.com/applications/app/token");
          expect(init.method).toBe("DELETE");
          expect(JSON.parse(String(init.body))).toEqual({
            access_token: "rejected-token",
          });
          return new Response(null, { status: 204 });
        },
        { id: "app", secret: "secret" },
        await decryptActivityToken(key, envelope, binding),
        activityCleanupKind(binding),
      ),
    ).toBe("deleted");
  });
  it("treats a redirect as a retry for both credential kinds", async () => {
    for (const kind of ["grant", "token"] as const)
      for (const status of [301, 302, 303, 307, 308])
        expect(
          await deleteActivityCredential(
            async () => new Response(null, { status }),
            { id: "app", secret: "secret" },
            "token",
            kind,
          ),
        ).toBe("retry");
  });
  it("passes a transport that rejects the redirect values Workers reject", async () => {
    // A model of workerd's check: only "follow" and "manual" are accepted.
    const workerd = async (_url: string, init: RequestInit) => {
      if (!["follow", "manual", undefined].includes(init.redirect))
        throw new TypeError(`Invalid redirect value ${init.redirect}`);
      return new Response(null, { status: 204 });
    };
    expect(
      await deleteActivityGrant(workerd, { id: "app", secret: "s" }, "token"),
    ).toBe("deleted");
  });
  it("releases a provider-rejected credential only when GitHub's token check also reports it invalid", async () => {
    const app = { id: "app", secret: "secret" };
    const calls: string[] = [];
    const transport =
      (deleteStatus: number, checkStatus: number | "throw") =>
      async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${new URL(url).pathname}`);
        if (init.method === "DELETE")
          return new Response(null, { status: deleteStatus });
        if (checkStatus === "throw") throw new Error("network");
        return new Response(null, { status: checkStatus });
      };
    const rejected = { providerRejected: true };
    expect(
      await deleteActivityCredential(
        transport(404, 404),
        app,
        "t",
        "grant",
        rejected,
      ),
    ).toBe("gone");
    expect(calls).toEqual([
      "DELETE /applications/app/grant",
      "POST /applications/app/token",
    ]);
    expect(
      await deleteActivityCredential(
        transport(422, 404),
        app,
        "t",
        "grant",
        rejected,
      ),
    ).toBe("gone");
    // A valid token, a server failure or a lost check never releases.
    for (const check of [200, 500, "throw"] as const)
      expect(
        await deleteActivityCredential(
          transport(404, check),
          app,
          "t",
          "grant",
          rejected,
        ),
      ).toBe("retry");
    // Without an earlier provider 401, a 404 is not proof.
    calls.length = 0;
    expect(
      await deleteActivityCredential(transport(404, 404), app, "t", "grant"),
    ).toBe("retry");
    expect(calls).toEqual(["DELETE /applications/app/grant"]);
    // Other failures do not trigger the check.
    for (const status of [401, 403, 429, 500, 302])
      expect(
        await deleteActivityCredential(
          transport(status, 404),
          app,
          "t",
          "grant",
          rejected,
        ),
      ).toBe("retry");
  });
  it("keeps ambiguous network failures fenced instead of permitting consent", async () => {
    expect(
      await deleteActivityGrant(
        async () => {
          throw new Error("sensitive transport error");
        },
        { id: "app", secret: "secret" },
        "token",
      ),
    ).toBe("uncertain");
  });
});
