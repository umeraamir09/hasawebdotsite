import { createComponent, createEmptyDraft } from "@hasaweb/schema";
import { describe, expect, it, vi } from "vitest";
import type { DraftController } from "../draft/controller";
import {
  GraphSetupError,
  loadGraphPreview,
  readGraphStatus,
  setGitHubPrivate,
  setGitHubUsername,
  startPrivateConsent,
  withdrawGraphAccess,
} from "./github-graph";

const status = {
  connection: {
    username: "octo",
    profileUrl: "https://github.com/octo",
    generation: 3,
  },
  public: {
    state: "ready",
    fetchedAt: "2026-11-08T00:00:00.000Z",
    total: 2,
    lastError: null,
  },
  private: { state: "consent_failed", reason: "wrong_account" },
  privateAvailable: true,
  canDetect: false,
};
const reply = (body: unknown, status = 200) =>
  vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;

describe("GitHub graph browser client", () => {
  it("parses private states strictly", async () => {
    expect((await readGraphStatus(reply(status))).private).toEqual({
      state: "consent_failed",
      reason: "wrong_account",
    });
    await expect(
      readGraphStatus(reply({ ...status, private: { state: "ready" } })),
    ).rejects.toThrow();
    await expect(
      readGraphStatus(
        reply({ ...status, private: { state: "off", token: "x" } }),
      ),
    ).rejects.toThrow();
  });
  it("starts consent with a fixed editor or setup return only", async () => {
    const send = reply({ url: "https://github.com/login/oauth/authorize?x=1" });
    expect(await startPrivateConsent(send)).toBe(
      "https://github.com/login/oauth/authorize?x=1",
    );
    const [path, init] = (send as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(path).toBe("/api/owner/github/consent");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ returnTo: "editor" });
    // The setup guide names its own fixed context, never a path.
    const guide = reply({
      url: "https://github.com/login/oauth/authorize?x=2",
    });
    await startPrivateConsent(guide, "setup");
    const [, guideInit] = (guide as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(JSON.parse(String(guideInit.body))).toEqual({ returnTo: "setup" });
    await expect(
      startPrivateConsent(reply({ error: "consent_busy" }, 409)),
    ).rejects.toEqual(new GraphSetupError("consent_busy"));
    await expect(
      withdrawGraphAccess(reply({ error: "x" }, 503)),
    ).rejects.toEqual(new GraphSetupError("unavailable"));
  });
  it("asks for private preview counts only when the draft includes them", async () => {
    const send = reply({ graph: null });
    const signal = new AbortController().signal;
    await loadGraphPreview(signal, false, send);
    await loadGraphPreview(signal, true, send);
    // Cached per choice for the same revision.
    await loadGraphPreview(signal, true, send);
    expect(
      (send as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0],
      ),
    ).toEqual([
      "/api/owner/github/preview",
      "/api/owner/github/preview?private=1",
    ]);
  });
  it("turns private activity off when the account changes", () => {
    const draft = createEmptyDraft({
      themeId: "default",
      fontId: "default",
      colorMode: "system",
    });
    const graph = createComponent("github", "graph");
    graph.data = { username: "octo", includePrivate: true };
    let working = { ...draft, components: [graph] };
    const controller = {
      store: { getState: () => ({ working }) },
      update: (next: typeof working) => {
        working = next;
      },
    } as unknown as DraftController;
    const data = () =>
      working.components[0]?.type === "github"
        ? working.components[0].data
        : null;
    setGitHubUsername(controller, "graph", "Octo");
    expect(data()).toEqual({ username: "Octo", includePrivate: true });
    setGitHubUsername(controller, "graph", "someone-else");
    expect(data()).toEqual({ username: "someone-else", includePrivate: false });
    setGitHubPrivate(controller, "graph", true);
    expect(data()).toEqual({ username: "someone-else", includePrivate: true });
  });
});
