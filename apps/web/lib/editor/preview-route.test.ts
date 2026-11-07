import { describe, expect, it, vi } from "vitest";
import {
  PREVIEW_SHELL,
  previewPolicy,
  previewRequest,
  previewRoute,
} from "./preview-route";

const ORIGIN = "https://hasaweb.site";
const owner = () =>
  Response.json({ user: { id: "alice" }, portfolio: { id: "p1" } });
function environment(
  respond: (request: Request) => Response | Promise<Response> = owner,
) {
  const fetch = vi.fn(async (request: Request) => respond(request));
  return {
    env: { APP_ORIGIN: ORIGIN, OWNER_API: { fetch } as unknown as Fetcher },
    fetch,
  };
}
const get = (path: string, init: RequestInit = {}) =>
  new Request(`${ORIGIN}${path}`, init);
// A response any shared cache, crawler or embedding page must refuse.
function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Robots-Tag")).toBe(
    "noindex, nofollow, noarchive",
  );
  expect(response.headers.get("Vary")).toBe("Cookie");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

describe("full-page preview routes", () => {
  it("recognizes only the portfolio, resume and case-study pages", () => {
    expect(previewRoute("/preview")).toEqual({ path: "/", resume: false });
    expect(previewRoute("/preview/")).toEqual({ path: "/", resume: false });
    expect(previewRoute("/preview/resume")).toEqual({
      path: "/resume",
      resume: true,
    });
    expect(previewRoute("/preview/projects/build-pipeline-2")).toEqual({
      path: "/projects/build-pipeline-2",
      resume: false,
    });
    for (const path of [
      "/preview/projects",
      "/preview/projects/",
      "/preview/projects/Bad_Slug",
      "/preview/projects/a/b",
      "/preview/projects/-a",
      "/preview/resume/extra",
      "/preview/_/contact",
      "/preview/%2e%2e/api/owner",
      "/preview//resume",
    ])
      expect(previewRoute(path), path).toBe("invalid");
    for (const path of [
      "/",
      "/previews",
      "/preview-assets/app.js",
      "/editor",
      "/api/owner",
      "/resume",
    ])
      expect(previewRoute(path), path).toBe(null);
  });
  it("serves a private, no-store, noindex shell with no inline code to the owner", async () => {
    const { env, fetch } = environment();
    for (const path of [
      "/preview",
      "/preview/resume",
      "/preview/projects/build-pipeline",
    ]) {
      const response = await previewRequest(
        get(path, { headers: { Cookie: "session=alice" } }),
        env,
      );
      expect(response?.status, path).toBe(200);
      if (!response) return;
      expectPrivate(response);
      expect(response.headers.get("Content-Type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(await response.text()).toBe(PREVIEW_SHELL);
    }
    // The owner service sees the original cookie and nothing else.
    const forwarded = fetch.mock.calls[0]?.[0];
    expect(forwarded?.headers.get("Cookie")).toBe("session=alice");
    expect(new URL(forwarded?.url ?? "").pathname).toBe("/api/owner");
    expect(PREVIEW_SHELL).toContain(
      '<meta name="robots" content="noindex,nofollow,noarchive">',
    );
    // Only external files: no inline script, style or handler.
    expect(PREVIEW_SHELL).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(PREVIEW_SHELL).not.toMatch(/<style|style=|\son[a-z]+=|<form/);
    expect(PREVIEW_SHELL).not.toContain("draft");
  });
  it("sets a closed policy that allows an embedded object only on the resume page", async () => {
    const { env } = environment();
    const policy = async (path: string) =>
      (await previewRequest(get(path), env))?.headers.get(
        "Content-Security-Policy",
      ) ?? "";
    for (const path of ["/preview", "/preview/projects/a"]) {
      const value = await policy(path);
      expect(value).toBe(previewPolicy(false));
      expect(value).toContain("object-src 'none'");
      expect(value).toContain("frame-src 'none'");
    }
    const resume = await policy("/preview/resume");
    expect(resume).toContain("object-src 'self'");
    expect(resume).toContain("frame-src 'self'");
    for (const value of [await policy("/preview"), resume]) {
      expect(value).toContain("default-src 'none'");
      expect(value).toContain("script-src 'self'");
      expect(value).toContain("form-action 'none'");
      expect(value).toContain("frame-ancestors 'none'");
      expect(value).toContain("base-uri 'none'");
      expect(value).not.toMatch(/unsafe-|nonce-|sha(?:256|384|512)-|\*/);
    }
  });
  it("answers every non-owner request with the same empty private 404", async () => {
    const signedOut = environment(() => new Response(null, { status: 401 }));
    const noPortfolio = environment(() =>
      Response.json({ user: { id: "alice" }, portfolio: null }),
    );
    const missing = environment(() => Response.json({}));
    const attempts: [string, Request, ReturnType<typeof environment>][] = [
      ["no session", get("/preview"), signedOut],
      ["expired session", get("/preview/resume"), signedOut],
      ["no portfolio", get("/preview"), noPortfolio],
      ["foreign identity shape", get("/preview"), missing],
      [
        "other origin",
        new Request("https://alice.hasaweb.site/preview"),
        environment(),
      ],
      ["http", new Request("http://hasaweb.site/preview"), environment()],
      ["post", get("/preview", { method: "POST", body: "{}" }), environment()],
      ["head", get("/preview", { method: "HEAD" }), environment()],
      ["invalid path", get("/preview/projects/Bad"), environment()],
      ["contact replay", get("/preview/_/contact"), environment()],
    ];
    const bodies: string[] = [];
    for (const [label, request, { env }] of attempts) {
      const response = await previewRequest(request, env);
      expect(response?.status, label).toBe(404);
      if (!response) return;
      expectPrivate(response);
      expect(response.headers.get("Content-Security-Policy"), label).toBe(null);
      bodies.push(await response.text());
    }
    // Nothing distinguishes the reasons, including unsigned from no portfolio.
    expect(new Set(bodies)).toEqual(new Set([""]));
    expect(
      (await previewRequest(get("/preview"), signedOut.env))?.headers.get(
        "Content-Length",
      ),
    ).toBe(
      (await previewRequest(get("/preview"), noPortfolio.env))?.headers.get(
        "Content-Length",
      ),
    );
  });
  it("skips the owner service for requests outside the shell, origin or method", async () => {
    const { env, fetch } = environment();
    await previewRequest(new Request("https://evil.test/preview"), env);
    await previewRequest(get("/preview", { method: "POST", body: "x" }), env);
    await previewRequest(get("/preview/nope/x"), env);
    expect(fetch).not.toHaveBeenCalled();
    expect(await previewRequest(get("/editor"), env)).toBe(null);
    expect(await previewRequest(get("/api/owner"), env)).toBe(null);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports an owner-service outage privately without revealing the account", async () => {
    for (const respond of [
      () => new Response(null, { status: 503 }),
      () => new Response("not json", { status: 200 }),
      () => {
        throw new Error("binding unavailable");
      },
    ]) {
      const response = await previewRequest(
        get("/preview"),
        environment(respond).env,
      );
      expect(response?.status).toBe(503);
      if (response) expectPrivate(response);
      expect(await response?.text()).toBe("");
    }
  });
});
