import type { AuthEnvironment } from "@hasaweb/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnerRouter } from "./owner-api";

vi.mock("@hasaweb/auth", () => ({
  authSettings: () => ({ origin: "https://hasaweb.site" }),
  currentOwner: async () => null,
}));

function rejectBody(body: ReadableStream<Uint8Array>, status = 401) {
  const request = new Request("https://hasaweb.site/api/owner", {
    method: "POST",
    headers: {
      Origin: status === 403 ? "https://evil.test" : "https://hasaweb.site",
      "Content-Type": status === 415 ? "text/plain" : "application/json",
    },
    body,
    duplex: "half",
  } as RequestInit);
  return createOwnerRouter().fetch(request, {} as AuthEnvironment);
}

afterEach(() => vi.useRealTimers());

describe("rejected owner request bodies", () => {
  it("finishes small bodies before returning the rejection", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
      cancel,
    });
    expect((await rejectBody(body)).status).toBe(401);
    expect(cancel).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it.each([401, 403, 415])("caps bytes while preserving %i", async (status) => {
    let chunks = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          chunks++;
          controller.enqueue(new Uint8Array(4096));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const response = await rejectBody(body, status);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(chunks).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("cancels a stalled upload without awaiting slow cancellation", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = rejectBody(body);
    await vi.advanceTimersByTimeAsync(100);
    expect((await response).status).toBe(401);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves rejection when an upload fails", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("upload disconnected"));
      },
    });
    expect((await rejectBody(body)).status).toBe(401);
    expect(body.locked).toBe(false);
  });
});
