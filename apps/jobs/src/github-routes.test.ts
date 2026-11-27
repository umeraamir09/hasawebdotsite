import type { AuthEnvironment } from "@hasaweb/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = {
  status: vi.fn(),
  preview: vi.fn(),
  detect: vi.fn(),
  setup: vi.fn(),
  connectSignIn: vi.fn(),
  retry: vi.fn(),
};
const consent = {
  start: vi.fn(),
  startSwitch: vi.fn(),
  callback: vi.fn(),
};
const db = vi.hoisted(() => ({
  withdraw: vi.fn(),
  cleanups: vi.fn(),
  refresh: vi.fn(),
  sweep: vi.fn(),
  enqueue: vi.fn(),
  setupEnv: vi.fn(),
}));
const owner = vi.hoisted(() => ({ current: true }));
vi.mock("@hasaweb/auth", () => ({
  authSettings: () => ({ origin: "https://hasaweb.site" }),
  signInAccessToken: async (_env: unknown, stored: string) => `plain:${stored}`,
  currentOwner: async () =>
    owner.current
      ? { identity: { user: { id: "owner-1" }, session: { id: "s" } } }
      : null,
}));
vi.mock("@hasaweb/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hasaweb/db")>()),
  ownerGraphSetup: (_db: unknown, _identity: unknown, env: unknown) => {
    db.setupEnv(env);
    return service;
  },
  runGitHubRefresh: db.refresh,
  dueGitHubSweep: db.sweep,
  enqueueGitHubRefresh: db.enqueue,
  ownerPrivateActivity: () => consent,
  withdrawPrivateActivity: db.withdraw,
  runGitHubCleanups: db.cleanups,
}));

import { processGitHubRefresh, sweepGitHubRefreshes } from "./github-routes";
import { createOwnerRouter } from "./owner-api";

const env = {
  APP_ENV: "production",
  DB: {} as D1Database,
  GITHUB_SERVICE_TOKEN: "platform-token",
} as unknown as AuthEnvironment;
function call(
  path: string,
  init: { method?: string; body?: unknown; env?: object } = {},
) {
  const method = init.method ?? "GET";
  return createOwnerRouter().fetch(
    new Request(`https://hasaweb.site/api/owner/github${path}`, {
      method,
      headers:
        method === "GET"
          ? {}
          : {
              Origin: "https://hasaweb.site",
              "Content-Type": "application/json",
            },
      ...(method === "GET" ? {} : { body: JSON.stringify(init.body ?? {}) }),
    }),
    { ...env, ...init.env } as AuthEnvironment,
  );
}
const status = {
  connection: null,
  public: { state: "pending" },
  githubSignIn: false,
};

// 32 bytes of 7, base64.
const ACTIVITY = {
  GITHUB_CLIENT_ID: "sign-in-client",
  GITHUB_CLIENT_SECRET: "sign-in-secret",
  GITHUB_ACTIVITY_CLIENT_ID: "activity-client",
  GITHUB_ACTIVITY_CLIENT_SECRET: "activity-secret",
  GITHUB_ACTIVITY_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
};

beforeEach(() => {
  owner.current = true;
  for (const fn of [
    ...Object.values(service),
    ...Object.values(consent),
    ...Object.values(db),
  ])
    fn.mockReset();
  db.cleanups.mockResolvedValue([]);
});

describe("owner GitHub graph routes", () => {
  it("serves status and owner preview as private, no-store JSON", async () => {
    service.status.mockResolvedValue(status);
    service.preview.mockResolvedValue({ username: "octo", days: [] });
    const first = await call("");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(status);
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(first.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(first.headers.get("Vary")).toBe("Cookie");
    const second = await call("/preview");
    expect(await second.json()).toEqual({
      graph: { username: "octo", days: [] },
    });
  });
  it("rejects signed-out requests before reaching the service", async () => {
    owner.current = false;
    for (const request of [
      call(""),
      call("/preview"),
      call("/setup", { method: "POST", body: { username: "octo" } }),
    ])
      expect((await request).status).toBe(401);
    expect(service.setup).not.toHaveBeenCalled();
  });
  it("needs the platform credential and never exposes provider detail", async () => {
    const missing = await call("", {
      env: { GITHUB_SERVICE_TOKEN: undefined },
    });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "unavailable" });
    service.status.mockRejectedValue(new Error("secret provider payload"));
    const failed = await call("");
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("secret");
  });
  it("maps a missing portfolio and malformed input to closed errors", async () => {
    service.status.mockRejectedValue(
      new Error("An active owner portfolio is required"),
    );
    expect((await call("")).status).toBe(409);
    for (const body of [
      {},
      { username: "" },
      { username: "a", extra: 1 },
      { username: 7 },
    ])
      expect((await call("/setup", { method: "POST", body })).status).toBe(422);
    expect(service.setup).not.toHaveBeenCalled();
  });
  it("sets up a typed username and reports each failure honestly", async () => {
    service.setup.mockResolvedValueOnce({ ok: true, status });
    const ok = await call("/setup", {
      method: "POST",
      body: { username: "octo-cat" },
    });
    expect(ok.status).toBe(200);
    expect(service.setup).toHaveBeenCalledWith("octo-cat");
    for (const [error, code] of [
      ["invalid_username", 422],
      ["not_found", 422],
      ["unavailable", 503],
      ["misconfigured", 503],
      ["too_soon", 429],
      ["conflict", 409],
    ] as const) {
      service.setup.mockResolvedValueOnce({ ok: false, error });
      const response = await call("/setup", {
        method: "POST",
        body: { username: "octo" },
      });
      expect(response.status).toBe(code);
      expect(await response.json()).toEqual({ error });
    }
  });
  it("retries only with an empty body and detects without selecting", async () => {
    service.retry.mockResolvedValue({ ok: true, status });
    expect((await call("/retry", { method: "POST" })).status).toBe(200);
    expect(
      (await call("/retry", { method: "POST", body: { username: "x" } }))
        .status,
    ).toBe(422);
    service.detect.mockResolvedValue({ ok: true, login: "octo" });
    const detected = await call("/detect", { method: "POST" });
    expect(await detected.json()).toEqual({ login: "octo" });
    expect(service.setup).not.toHaveBeenCalled();
  });
  it("keeps the shared origin, content type and method guards", async () => {
    const hostile = await createOwnerRouter().fetch(
      new Request("https://hasaweb.site/api/owner/github/setup", {
        method: "POST",
        headers: {
          Origin: "https://evil.test",
          "Content-Type": "application/json",
        },
        body: '{"username":"octo"}',
      }),
      env,
    );
    expect(hostile.status).toBe(403);
    const text = await createOwnerRouter().fetch(
      new Request("https://hasaweb.site/api/owner/github/setup", {
        method: "POST",
        headers: {
          Origin: "https://hasaweb.site",
          "Content-Type": "text/plain",
        },
        body: "{}",
      }),
      env,
    );
    expect(text.status).toBe(415);
    expect((await call("/setup")).status).toBe(405);
    expect((await call("", { method: "POST" })).status).toBe(405);
    expect(service.setup).not.toHaveBeenCalled();
  });
});

describe("private activity consent routes", () => {
  it("passes only the owner's private preview choice", async () => {
    service.preview.mockResolvedValue(null);
    await call("/preview");
    await call("/preview?private=1");
    await call("/preview?private=true");
    expect(service.preview.mock.calls).toEqual([[false], [true], [false]]);
  });
  it("needs the separate activity app before starting consent", async () => {
    const missing = await call("/consent", {
      method: "POST",
      body: { returnTo: "editor" },
    });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "private_unavailable" });
    expect(consent.start).not.toHaveBeenCalled();
  });
  it("starts consent with a fixed return and closed errors", async () => {
    consent.start.mockResolvedValueOnce({
      ok: true,
      url: "https://github.com/login/oauth/authorize?x",
    });
    const ok = await call("/consent", {
      method: "POST",
      body: { returnTo: "editor" },
      env: ACTIVITY,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      url: "https://github.com/login/oauth/authorize?x",
    });
    expect(consent.start).toHaveBeenCalledWith("editor");
    // The setup guide (Phase 42D) names its own fixed context.
    consent.start.mockResolvedValueOnce({
      ok: true,
      url: "https://github.com/login/oauth/authorize?y",
    });
    expect(
      (
        await call("/consent", {
          method: "POST",
          body: { returnTo: "setup" },
          env: ACTIVITY,
        })
      ).status,
    ).toBe(200);
    expect(consent.start).toHaveBeenLastCalledWith("setup");
    for (const error of ["no_graph", "already_authorized", "consent_busy"]) {
      consent.start.mockResolvedValueOnce({ ok: false, error });
      const response = await call("/consent", {
        method: "POST",
        body: { returnTo: "editor" },
        env: ACTIVITY,
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error });
    }
    // Arbitrary return destinations and extra fields are refused.
    for (const body of [
      {},
      { returnTo: "/somewhere" },
      { returnTo: "https://evil.test" },
      { returnTo: "editor", url: "x" },
      { returnTo: "/auth/entry?github=consent" },
      { returnTo: "Setup" },
    ])
      expect(
        (await call("/consent", { method: "POST", body, env: ACTIVITY }))
          .status,
      ).toBe(422);
    expect(consent.start).toHaveBeenCalledTimes(5);
    consent.startSwitch.mockResolvedValueOnce({
      ok: true,
      url: "https://github.com/login/oauth/authorize?switch",
    });
    const switched = await call("/consent", {
      method: "POST",
      body: { returnTo: "editor", intent: "switch" },
      env: ACTIVITY,
    });
    expect(switched.status).toBe(200);
    expect(consent.startSwitch).toHaveBeenCalledWith("editor");
    expect(consent.start).toHaveBeenCalledTimes(5);
  });
  it("returns every callback to the fixed editor path with no referrer", async () => {
    consent.callback.mockResolvedValueOnce({
      returnTo: "editor",
      outcome: "connected",
    });
    const response = await call("/consent/callback?code=c&state=s", {
      env: ACTIVITY,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/editor?github=consent");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(consent.callback).toHaveBeenCalledWith({
      state: "s",
      code: "c",
      error: null,
    });
    // A failed consent queued a token revocation, which starts at once.
    consent.callback.mockResolvedValueOnce({
      returnTo: "editor",
      outcome: "wrong_account",
    });
    await call("/consent/callback?code=c&state=s", { env: ACTIVITY });
    expect(db.cleanups).toHaveBeenCalledTimes(1);
    // A guide attempt returns to the fixed account entry, which resolves the
    // saved setup step. The URL still carries no outcome.
    for (const outcome of ["connected", "cancelled", "invalid"]) {
      consent.callback.mockResolvedValueOnce({ returnTo: "setup", outcome });
      const guide = await call("/consent/callback?code=c&state=s", {
        env: ACTIVITY,
      });
      expect(guide.status).toBe(303);
      expect(guide.headers.get("Location")).toBe("/auth/entry?github=consent");
      expect(guide.headers.get("Referrer-Policy")).toBe("no-referrer");
    }
    expect(db.cleanups).toHaveBeenCalledTimes(2);
    // A storage failure still returns to the editor and leaks nothing.
    consent.callback.mockRejectedValueOnce(new Error("secret"));
    const failed = await call("/consent/callback?code=c&state=s", {
      env: ACTIVITY,
    });
    expect(failed.status).toBe(303);
    expect(await failed.text()).toBe("");
    // That failure may have queued an issued token, so revocation starts too.
    expect(db.cleanups).toHaveBeenCalledTimes(3);
  });
  it("keeps the public graph up and reports a broken activity key", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...ACTIVITY, GITHUB_ACTIVITY_KEY: btoa("short") };
    service.status.mockResolvedValue(status);
    service.preview.mockResolvedValue(null);
    expect((await call("", { env: broken })).status).toBe(200);
    expect((await call("/preview", { env: broken })).status).toBe(200);
    // Private consent fails closed.
    const start = await call("/consent", {
      method: "POST",
      body: { returnTo: "editor" },
      env: broken,
    });
    expect(start.status).toBe(503);
    expect(consent.start).not.toHaveBeenCalled();
    // The sweep cannot decrypt queued tokens. It says so instead of passing
    // as an unconfigured app, and the rows stay queued for a repaired key.
    const { sweepGitHubCleanups } = await import("./github-routes");
    await expect(
      sweepGitHubCleanups({ ...env, ...broken } as never),
    ).rejects.toThrow("Invalid activity key");
    expect(db.cleanups).not.toHaveBeenCalled();
    expect(
      errors.mock.calls.some((args: unknown[]) =>
        String(args[0]).includes("activity app misconfigured"),
      ),
    ).toBe(true);
    // Unset is still a quiet no-op.
    await expect(sweepGitHubCleanups(env as never)).resolves.toEqual([]);
    errors.mockRestore();
  });
  it("returns a signed-out callback without touching consent", async () => {
    owner.current = false;
    const response = await call("/consent/callback?code=c&state=s", {
      env: ACTIVITY,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/editor?github=consent");
    expect(consent.callback).not.toHaveBeenCalled();
    // Every other signed-out request is still a plain 401.
    expect((await call("/withdraw", { method: "POST" })).status).toBe(401);
    expect((await call("/consent", { method: "POST" })).status).toBe(401);
  });
  it("connects the GitHub sign-in with a decrypted token and closed errors", async () => {
    service.connectSignIn.mockImplementationOnce(
      async (decrypt: (stored: string) => Promise<string>) => {
        expect(await decrypt("envelope")).toBe("plain:envelope");
        return { ok: true, status };
      },
    );
    const connected = await call("/connect", { method: "POST", env: ACTIVITY });
    expect(connected.status).toBe(200);
    expect(await connected.json()).toEqual(status);
    for (const [error, code] of [
      ["reauthorize", 409],
      ["consent_busy", 409],
      ["too_soon", 429],
      ["unavailable", 503],
      ["private_unavailable", 503],
    ] as const) {
      service.connectSignIn.mockResolvedValueOnce({ ok: false, error });
      const failed = await call("/connect", { method: "POST" });
      expect(failed.status).toBe(code);
      expect(await failed.json()).toEqual({ error });
    }
    // The body must be empty: the browser never names an account or token.
    expect(
      (await call("/connect", { method: "POST", body: { token: "x" } })).status,
    ).toBe(422);
    expect((await call("/connect")).status).toBe(405);
    expect(service.connectSignIn).toHaveBeenCalledTimes(6);
  });
  it("gives the sign-in app to private activity and its revocation", async () => {
    service.status.mockResolvedValue(status);
    await call("", { env: ACTIVITY });
    expect(db.setupEnv.mock.calls[0]?.[0].activity.signInApp).toEqual({
      id: "sign-in-client",
      secret: "sign-in-secret",
    });
    const { sweepGitHubCleanups } = await import("./github-routes");
    await sweepGitHubCleanups({ ...env, ...ACTIVITY } as never);
    expect(db.cleanups.mock.calls[0]?.[1].signInApp.id).toBe("sign-in-client");
  });
  it("withdraws without any provider configuration", async () => {
    db.withdraw.mockResolvedValueOnce(true);
    const withdrawn = await call("/withdraw", {
      method: "POST",
      env: { GITHUB_SERVICE_TOKEN: undefined },
    });
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toEqual({ ok: true });
    db.withdraw.mockResolvedValueOnce(false);
    expect((await call("/withdraw", { method: "POST" })).status).toBe(409);
    expect(
      (await call("/withdraw", { method: "POST", body: { all: true } })).status,
    ).toBe(422);
    expect((await call("/withdraw")).status).toBe(405);
    expect(db.withdraw).toHaveBeenCalledTimes(2);
    // Public-only graphs no longer exist.
    expect((await call("/public-only", { method: "POST" })).status).toBe(404);
  });
});

describe("independent refresh (Phase 42)", () => {
  const message = {
    kind: "github-refresh" as const,
    portfolioId: "p1",
    requestedAt: 1_794_000_000_000,
  };
  it("lets a due status read request a background refresh only with a queue", async () => {
    service.status.mockResolvedValue(status);
    db.enqueue.mockResolvedValue(message);
    await call("");
    expect(db.setupEnv.mock.calls[0]?.[0]).not.toHaveProperty("requestRefresh");
    const queue = { send: vi.fn(), sendBatch: vi.fn() };
    await call("", { env: { GITHUB_QUEUE: queue } });
    const env = db.setupEnv.mock.calls[1]?.[0] as {
      requestRefresh(portfolioId: string): Promise<unknown> | undefined;
    };
    await env.requestRefresh("p1");
    expect(db.enqueue).toHaveBeenCalledWith(expect.anything(), queue, "p1");
  });
  it("refreshes with the platform credential and the activity app, and revokes a refused grant", async () => {
    db.refresh.mockResolvedValueOnce({
      claimed: true,
      withdrawn: true,
      failed: [],
    });
    const env = {
      APP_ENV: "production",
      DB: {} as D1Database,
      GITHUB_SERVICE_TOKEN: "platform-token",
      ...ACTIVITY,
    };
    await processGitHubRefresh(env, message, 1);
    const [, sent, environments] = db.refresh.mock.calls[0] ?? [];
    expect(sent).toEqual(message);
    expect(environments.public.platformToken).toBe("platform-token");
    expect(environments.authorized.key).toBeDefined();
    // The refused grant is revoked at once; the cron retries the rest.
    expect(db.cleanups).toHaveBeenCalledTimes(1);
  });
  it("still refreshes public activity without a usable activity app", async () => {
    db.refresh.mockResolvedValue({
      claimed: true,
      withdrawn: false,
      failed: [],
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const activity of [{}, { ...ACTIVITY, GITHUB_ACTIVITY_KEY: "AAAA" }]) {
      await processGitHubRefresh(
        {
          APP_ENV: "production",
          DB: {} as D1Database,
          GITHUB_SERVICE_TOKEN: "platform-token",
          ...activity,
        },
        message,
      );
    }
    expect(
      db.refresh.mock.calls.map(
        (call: { authorized?: unknown }[]) => call[2]?.authorized,
      ),
    ).toEqual([null, null]);
    expect(db.cleanups).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
  it("sends one bounded batch of due private connections per sweep", async () => {
    const queue = { send: vi.fn(), sendBatch: vi.fn() };
    db.sweep.mockResolvedValueOnce([message]).mockResolvedValueOnce([]);
    const env = {
      APP_ENV: "production",
      DB: {} as D1Database,
      GITHUB_QUEUE: queue as unknown as Queue<typeof message>,
    };
    expect(await sweepGitHubRefreshes(env, 5)).toEqual([message]);
    expect(queue.sendBatch).toHaveBeenCalledWith([{ body: message }]);
    await sweepGitHubRefreshes(env, 6);
    expect(queue.sendBatch).toHaveBeenCalledTimes(1);
    expect(
      await sweepGitHubRefreshes({ ...env, GITHUB_QUEUE: undefined } as never),
    ).toEqual([]);
  });
});
