import { describe, expect, it, vi } from "vitest";
import { ownerEntryActive } from "../owner-entry-gate";
import { EDITOR_PREVIEW_SHELL, editorPreviewRequest } from "./preview-document";

const ORIGIN = "https://hasaweb.site";
function environment(
  gate: string | undefined,
  respond: () => Response = () =>
    Response.json({ user: { id: "alice" }, portfolio: { id: "p1" } }),
) {
  const fetch = vi.fn(async () => respond());
  return {
    env: {
      APP_ORIGIN: ORIGIN,
      OWNER_API: { fetch } as unknown as Fetcher,
      ...(gate === undefined ? {} : { OWNER_ENTRY_ACTIVATION: gate }),
    },
    fetch,
  };
}
const get = (path: string, init: RequestInit = {}) =>
  new Request(`${ORIGIN}${path}`, init);

describe("owner-entry activation gate", () => {
  it("opens only for the exact value active", () => {
    expect(ownerEntryActive({})).toBe(false);
    for (const value of ["", "true", "Active", "on", "1", " active"])
      expect(ownerEntryActive({ OWNER_ENTRY_ACTIVATION: value }), value).toBe(
        false,
      );
    expect(ownerEntryActive({ OWNER_ENTRY_ACTIVATION: "active" })).toBe(true);
  });
});

describe("editor iframe preview document", () => {
  it("is not registered while the gate is closed", async () => {
    for (const gate of [undefined, "inactive"]) {
      const { env, fetch } = environment(gate);
      expect(editorPreviewRequest(get("/editor/preview"), env)).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    }
  });
  it("leaves other paths to the application", () => {
    const { env } = environment("active");
    for (const path of ["/editor", "/editor/preview/", "/editor/previews"])
      expect(editorPreviewRequest(get(path), env), path).toBeNull();
  });
  it("serves the data-free shell to the signed-in owner only", async () => {
    const { env, fetch } = environment("active");
    const response = await editorPreviewRequest(
      get("/editor/preview", { headers: { Cookie: "session=1" } }),
      env,
    );
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe(EDITOR_PREVIEW_SHELL);
    expect(response?.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response?.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(response?.headers.get("Vary")).toBe("Cookie");
    expect(response?.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(response?.headers.get("Content-Security-Policy")).toMatch(
      /frame-ancestors 'self'/,
    );
    const forwarded = fetch.mock.calls[0] as unknown as [Request];
    expect(forwarded[0].headers.get("Cookie")).toBe("session=1");
    expect(EDITOR_PREVIEW_SHELL).toMatch(/noindex/);
    expect(EDITOR_PREVIEW_SHELL).not.toMatch(/<script>|draft|portfolio-id/i);
  });
  it("refuses signed-out, portfolio-less, foreign-origin and non-GET requests", async () => {
    const signedOut = environment("active", () =>
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    expect(
      (await editorPreviewRequest(get("/editor/preview"), signedOut.env))
        ?.status,
    ).toBe(401);
    const empty = environment("active", () =>
      Response.json({ user: { id: "alice" }, portfolio: null }),
    );
    expect(
      (await editorPreviewRequest(get("/editor/preview"), empty.env))?.status,
    ).toBe(409);
    const { env, fetch } = environment("active");
    expect(
      (
        await editorPreviewRequest(
          new Request("https://evil.example/editor/preview"),
          env,
        )
      )?.status,
    ).toBe(404);
    expect(
      (
        await editorPreviewRequest(
          get("/editor/preview", { method: "POST" }),
          env,
        )
      )?.status,
    ).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
