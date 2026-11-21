import type { AuthEnvironment } from "@hasaweb/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({
  withdraw: true,
  started: true as boolean,
  secure: true,
}));
vi.mock("@hasaweb/auth", () => ({
  authSettings: () => ({
    origin: "https://hasaweb.site",
    secure: state.secure,
  }),
  currentOwner: async () => ({
    identity: { user: { id: "owner-1" }, session: { id: "s" } },
  }),
}));
vi.mock("@hasaweb/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hasaweb/db")>()),
  withdrawPrivateActivity: async () => {
    calls.push("withdraw");
    return state.withdraw;
  },
  requestAccountDeletion: async () => {
    calls.push("delete");
    return state.started
      ? { deletionId: "8c4c2ab0-63a4-4d0b-a3f6-5b8a8d0f7a11" }
      : null;
  },
}));

import { createOwnerRouter } from "./owner-api";

const woken: unknown[] = [];
const env = {
  APP_ENV: "production",
  DB: {} as D1Database,
  PUBLICATION_QUEUE: { send: async (body: unknown) => void woken.push(body) },
} as unknown as AuthEnvironment;

function remove(
  body: unknown,
  headers: Record<string, string> = { "X-Expected-Owner-Id": "owner-1" },
) {
  return createOwnerRouter().fetch(
    new Request("https://hasaweb.site/api/owner/account/delete", {
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
  calls.length = 0;
  woken.length = 0;
  state.withdraw = true;
  state.started = true;
  state.secure = true;
});

describe("account deletion route", () => {
  it("withdraws private activity, starts deletion, wakes cleanup and clears the auth cookies", async () => {
    const response = await remove({ confirm: "delete-account" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(calls).toEqual(["withdraw", "delete"]);
    expect(woken).toEqual([
      { deletionId: "8c4c2ab0-63a4-4d0b-a3f6-5b8a8d0f7a11" },
    ]);
    expect(response.headers.getSetCookie()).toEqual(
      ["session_token", "session_data", "dont_remember"].map(
        (name) =>
          `__Host-hasaweb.${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
      ),
    );
  });

  it("uses the loopback cookie names without Secure locally", async () => {
    state.secure = false;
    const response = await remove({ confirm: "delete-account" });
    expect(response.headers.getSetCookie()[0]).toBe(
      "hasaweb-local.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    );
  });

  it("requires the confirmation body and the expected owner", async () => {
    for (const body of [
      {},
      { confirm: "yes" },
      { confirm: "delete-account", x: 1 },
    ])
      expect((await remove(body)).status).toBe(422);
    expect((await remove({ confirm: "delete-account" }, {})).status).toBe(400);
    const other = await remove(
      { confirm: "delete-account" },
      { "X-Expected-Owner-Id": "owner-2" },
    );
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: "owner_changed" });
    expect(calls).toEqual([]);
  });

  it("keeps the account when private access cannot be withdrawn", async () => {
    state.withdraw = false;
    const response = await remove({ confirm: "delete-account" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict" });
    expect(calls).toEqual(["withdraw"]);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("answers 401 when the session ended before the batch", async () => {
    state.started = false;
    const response = await remove({ confirm: "delete-account" });
    expect(response.status).toBe(401);
    expect(woken).toEqual([]);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
