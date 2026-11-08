import type { AuthEnvironment } from "@hasaweb/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = {
  status: vi.fn(),
  preview: vi.fn(),
  detect: vi.fn(),
  setup: vi.fn(),
  retry: vi.fn(),
};
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
  ownerGraphSetup: () => service,
}));

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
  canDetect: false,
};

beforeEach(() => {
  owner.current = true;
  for (const fn of Object.values(service)) fn.mockReset();
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
