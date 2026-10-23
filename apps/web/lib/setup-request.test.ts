import { afterEach, describe, expect, it, vi } from "vitest";
import { setupRequest } from "./setup-request";

vi.mock("@hasaweb/auth", () => ({
  currentSessionIdentity: async () => null,
}));

const env = {
  APP_ENV: "test",
  APP_ORIGIN: "https://hasaweb.site",
  DB: {
    prepare: vi.fn(),
    batch: vi.fn(),
    exec: vi.fn(),
    dump: vi.fn(),
    withSession: vi.fn(),
  },
  DRAFT_BUCKET: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
} satisfies Parameters<typeof setupRequest>[1];

function rejectBody(
  body: ReadableStream<Uint8Array>,
  status = 415,
  path = "/api/owner/setup/handoff",
) {
  const request = new Request(`${env.APP_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      Origin: status === 403 ? "https://evil.test" : env.APP_ORIGIN,
      "Content-Type": status === 415 ? "text/plain" : "application/json",
    },
    body,
    ...{ duplex: "half" },
  });
  return setupRequest(request, env);
}

afterEach(() => vi.useRealTimers());

describe("rejected setup request bodies", () => {
  it.each(["/api/owner/setup/check", "/api/owner/setup/handoff"])(
    "finishes a small upload before returning 415 from %s",
    async (path) => {
      let chunks = 0;
      let finished = false;
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (chunks++ === 0)
              controller.enqueue(new TextEncoder().encode("{}"));
            else {
              finished = true;
              controller.close();
            }
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      expect((await rejectBody(body, 415, path))?.status).toBe(415);
      expect(finished).toBe(true);
      expect(cancel).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);
    },
  );

  it.each([401, 403, 415])(
    "bounds oversized uploads and preserves %i",
    async (status) => {
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
      expect(response?.status).toBe(status);
      expect(response?.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response?.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(response?.headers.get("Vary")).toBe("Cookie");
      expect(chunks).toBe(2);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    },
  );

  it("bounds stalled uploads without waiting for slow cancellation", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = rejectBody(body);
    await vi.advanceTimersByTimeAsync(100);
    expect((await response)?.status).toBe(415);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the rejection after an upload disconnects", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("upload disconnected"));
      },
    });
    expect((await rejectBody(body))?.status).toBe(415);
    expect(body.locked).toBe(false);
  });

  it("leaves unrelated routes' bodies available for the next handler", async () => {
    const request = new Request(`${env.APP_ORIGIN}/api/owner/draft`, {
      method: "POST",
      body: "{}",
    });
    expect(await setupRequest(request, env)).toBeNull();
    expect(await request.text()).toBe("{}");
  });
});
