import type { AuthEnvironment } from "@hasaweb/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const db = vi.hoisted(() => ({
  connected: vi.fn(),
  remove: vi.fn(),
  withdraw: vi.fn(),
  cleanups: vi.fn(),
}));
const owner = vi.hoisted(() => ({ current: true }));
vi.mock("@hasaweb/auth", () => ({
  authSettings: () => ({ origin: "https://hasaweb.site" }),
  currentOwner: async () =>
    owner.current
      ? { identity: { user: { id: "owner-1" }, session: { id: "s" } } }
      : null,
}));
vi.mock("@hasaweb/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hasaweb/db")>()),
  ownerSignInProviders: () => ({
    connected: db.connected,
    remove: async (provider: string) => {
      calls.push(`remove:${provider}`);
      return db.remove(provider);
    },
  }),
  withdrawSignInGraph: async () => {
    calls.push("withdraw");
    return db.withdraw();
  },
  runGitHubCleanups: async () => {
    calls.push("cleanup");
    return db.cleanups();
  },
}));

import { createOwnerRouter } from "./owner-api";

// 32 bytes of 7, base64: an activity app is configured, so cleanup runs.
const env = {
  APP_ENV: "production",
  DB: {} as D1Database,
  GITHUB_CLIENT_ID: "sign-in-client",
  GITHUB_CLIENT_SECRET: "sign-in-secret",
  GITHUB_ACTIVITY_CLIENT_ID: "activity-client",
  GITHUB_ACTIVITY_CLIENT_SECRET: "activity-secret",
  GITHUB_ACTIVITY_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
} as unknown as AuthEnvironment;

function disconnect(
  body: unknown,
  headers: Record<string, string> = { "X-Expected-Owner-Id": "owner-1" },
) {
  return createOwnerRouter().fetch(
    new Request("https://hasaweb.site/api/owner/providers/disconnect", {
      method: "POST",
      headers: {
        Origin: "https://hasaweb.site",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    env,
  );
}

beforeEach(() => {
  owner.current = true;
  calls.length = 0;
  for (const fn of Object.values(db)) fn.mockReset();
  db.connected.mockResolvedValue(["github", "google"]);
  db.remove.mockResolvedValue("removed");
  db.withdraw.mockResolvedValue(true);
  db.cleanups.mockResolvedValue([]);
});

describe("connected sign-in provider routes", () => {
  it("lists both providers as private, no-store JSON without identities", async () => {
    db.connected.mockResolvedValue(["google"]);
    const response = await createOwnerRouter().fetch(
      new Request("https://hasaweb.site/api/owner/providers"),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      providers: [
        { provider: "github", connected: false },
        { provider: "google", connected: true },
      ],
    });
  });

  it("withdraws private activity, then removes GitHub sign-in and starts revocation", async () => {
    const response = await disconnect({ provider: "github" });
    expect(response.status).toBe(200);
    expect(calls).toEqual(["withdraw", "remove:github", "cleanup"]);
  });

  it("keeps GitHub sign-in when the withdrawal cannot commit", async () => {
    db.withdraw.mockResolvedValue(false);
    const response = await disconnect({ provider: "github" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict" });
    expect(calls).toEqual(["withdraw"]);
  });

  it("disconnects Google without touching GitHub activity", async () => {
    expect((await disconnect({ provider: "google" })).status).toBe(200);
    expect(calls).toEqual(["remove:google"]);
  });

  it("never removes the last sign-in method", async () => {
    db.connected.mockResolvedValue(["github"]);
    const response = await disconnect({ provider: "github" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "last_method" });
    expect(calls).toEqual([]);
    // A concurrent removal that wins the race is still reported, and the
    // GitHub withdrawal it already made is revoked.
    db.connected.mockResolvedValue(["github", "google"]);
    db.remove.mockResolvedValue("last_method");
    const raced = await disconnect({ provider: "github" });
    expect(raced.status).toBe(409);
    expect(await raced.json()).toEqual({ error: "last_method" });
    expect(calls).toEqual(["withdraw", "remove:github", "cleanup"]);
  });

  it("rejects providers that are not connected", async () => {
    db.connected.mockResolvedValue(["github"]);
    const response = await disconnect({ provider: "google" });
    expect(await response.json()).toEqual({ error: "not_connected" });
    expect(calls).toEqual([]);
  });

  it("requires the expected owner and strict input", async () => {
    expect((await disconnect({ provider: "github" }, {})).status).toBe(400);
    const changed = await disconnect(
      { provider: "github" },
      { "X-Expected-Owner-Id": "owner-2" },
    );
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ error: "owner_changed" });
    for (const body of [
      {},
      { provider: "credential" },
      { provider: "github", accountId: "other" },
    ])
      expect((await disconnect(body)).status).toBe(422);
    owner.current = false;
    expect((await disconnect({ provider: "github" })).status).toBe(401);
    expect(calls).toEqual([]);
  });
});
