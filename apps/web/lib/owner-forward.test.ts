import { describe, expect, it, vi } from "vitest";
import { forwardOwnerRequest } from "./owner-forward";

describe("owner Worker adapter", () => {
  it("passes the original request and body stream only for owner API paths", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response("ok"));
    const env = {
      APP_ORIGIN: "https://hasaweb.site",
      OWNER_API: { fetch } as unknown as Fetcher,
    };
    const request = new Request("https://hasaweb.site/api/owner/draft", {
      method: "POST",
      headers: { Cookie: "signed-session", Origin: env.APP_ORIGIN },
      body: "draft body",
    });
    expect((await forwardOwnerRequest(request, env))?.status).toBe(200);
    expect(fetch.mock.calls[0]?.[0]).toBe(request);
    expect(request.bodyUsed).toBe(false);
    for (const path of ["/api/ownership", "/api/auth/get-session", "/editor"])
      expect(
        await forwardOwnerRequest(new Request(`${env.APP_ORIGIN}${path}`), env),
      ).toBe(null);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects alternate authorities regardless of forwarded headers and fails privately", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("binding unavailable");
    });
    const env = {
      APP_ORIGIN: "https://hasaweb.site",
      OWNER_API: { fetch } as unknown as Fetcher,
    };
    for (const origin of [
      "https://alice.hasaweb.site",
      "https://evil.test",
      "http://hasaweb.site",
      "https://hasaweb.site:444",
    ]) {
      const response = await forwardOwnerRequest(
        new Request(`${origin}/api/owner`, {
          headers: { "x-forwarded-host": "hasaweb.site" },
        }),
        env,
      );
      expect(response?.status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
    const response = await forwardOwnerRequest(
      new Request(`${env.APP_ORIGIN}/api/owner`),
      env,
    );
    expect(response?.status).toBe(503);
    expect(response?.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
