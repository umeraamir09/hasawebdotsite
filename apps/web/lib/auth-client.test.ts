import { afterEach, describe, expect, it, vi } from "vitest";
import { readOwner, resolveAccountEntry } from "./auth-client";

afterEach(() => vi.unstubAllGlobals());

describe("private portfolio entry", () => {
  it("keeps session probes read-only and explicitly initializes on entry", async () => {
    const owner = {
      user: { id: "owner", name: "Provider name" },
      portfolio: null,
    };
    const initialized = {
      ...owner,
      portfolio: { id: "private-portfolio" },
      entry: {
        kind: "setup",
        revision: 0,
        progress: { schemaVersion: 1, step: "address" },
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(owner))
      .mockResolvedValueOnce(Response.json(initialized));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(await readOwner()).toEqual(owner);
    expect(fetch.mock.calls[0]).toEqual([
      "/api/owner",
      { cache: "no-store", signal: null },
    ]);
    expect(await resolveAccountEntry(controller.signal)).toEqual(initialized);
    expect(fetch.mock.calls[1]).toEqual([
      "/api/owner/entry",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal: controller.signal,
      },
    ]);
  });

  it("returns an expired-session result for the existing sign-in recovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    expect(await resolveAccountEntry()).toBe(null);
  });

  it("reports storage/network failure and allows the same request to retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(
        Response.json({
          user: { id: "owner", name: "Owner" },
          portfolio: { id: "saved" },
          entry: { kind: "editor", revision: 5, firstEditorEnteredAt: 1 },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(resolveAccountEntry()).rejects.toThrow(
      "Could not open your portfolio",
    );
    await expect(resolveAccountEntry()).rejects.toThrow("connection lost");
    expect(await resolveAccountEntry()).toMatchObject({
      portfolio: { id: "saved" },
      entry: { kind: "editor" },
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      Array(3).fill("/api/owner/entry"),
    );
  });
});
