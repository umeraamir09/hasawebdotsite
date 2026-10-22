import { providerPhotoUrl } from "@hasaweb/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_BYTES } from "./formats";
import { fetchProviderPhoto } from "./provider-photo";

afterEach(() => vi.unstubAllGlobals());
const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const url = "https://avatars.githubusercontent.com/u/123?v=4";
describe("private provider photo retrieval", () => {
  it("permits only exact HTTPS provider image hosts without credentials, fragments or nondefault ports", () => {
    expect(providerPhotoUrl(url)).toBe(url);
    expect(
      providerPhotoUrl("https://lh3.googleusercontent.com/a/photo=s96-c"),
    ).not.toBeNull();
    for (const value of [
      null,
      undefined,
      "",
      "bad",
      "http://avatars.githubusercontent.com/u/1",
      "https://avatars.githubusercontent.com.evil.test/u/1",
      "https://evil.test/@avatars.githubusercontent.com",
      "https://avatars.githubusercontent.com@127.0.0.1/",
      "https://x:secret@avatars.githubusercontent.com/u/1",
      "https://avatars.githubusercontent.com:8443/u/1",
      "https://avatars.githubusercontent.com./u/1",
      "https://127.0.0.1/a",
      "data:image/png;base64,a",
      "file:///etc/passwd",
      `${url}#fragment`,
    ])
      expect(providerPhotoUrl(value)).toBeNull();
  });
  it("returns validated bytes without forwarding credentials or following redirects", async () => {
    const network = vi.fn(
      async () =>
        new Response(signature, { headers: { "Content-Type": "image/png" } }),
    );
    vi.stubGlobal("fetch", network);
    const signal = new AbortController().signal;
    const photo = await fetchProviderPhoto(url, signal);
    expect(photo.type).toBe("image/png");
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(signature);
    expect(network).toHaveBeenCalledWith(url, {
      redirect: "manual",
      credentials: "omit",
      headers: { Accept: "image/jpeg, image/png, image/webp" },
      signal,
    });
  });
  it("does not contact an untrusted host", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    await expect(
      fetchProviderPhoto(
        "https://localhost/private",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 415 });
    expect(network).not.toHaveBeenCalled();
  });
  it.each([
    [302, "image/png", signature, null, 502],
    [404, "image/png", signature, null, 502],
    [200, "image/svg+xml", signature, null, 415],
    [200, "image/png", new Uint8Array([1, 2, 3]), null, 415],
    [200, "image/jpeg", signature, null, 415],
    [200, "image/png", signature, String(IMAGE_BYTES + 1), 413],
    [200, "image/png", signature, "13", 400],
    [200, "image/png", new Uint8Array(0), null, 411],
  ])(
    "rejects provider status %s, media %s and invalid framing",
    async (status, type, body, declared, error) => {
      const headers = new Headers({ "Content-Type": type });
      if (declared) headers.set("Content-Length", declared);
      vi.stubGlobal(
        "fetch",
        async () => new Response(body, { status, headers }),
      );
      await expect(
        fetchProviderPhoto(url, new AbortController().signal),
      ).rejects.toMatchObject({ status: error });
    },
  );
  it("counts streamed bytes without trusting missing or smaller Content-Length and cancels overflow", async () => {
    for (const declared of [null, "12"]) {
      const cancelled = vi.fn();
      const headers = new Headers({ "Content-Type": "image/png" });
      if (declared) headers.set("Content-Length", declared);
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(signature);
                controller.enqueue(new Uint8Array(IMAGE_BYTES));
              },
              cancel: cancelled,
            }),
            { headers },
          ),
      );
      await expect(
        fetchProviderPhoto(url, new AbortController().signal),
      ).rejects.toMatchObject({ status: 413 });
      expect(cancelled).toHaveBeenCalled();
    }
  });
  it("accepts the exact byte ceiling and signatures split across chunks", async () => {
    const body = new Uint8Array(IMAGE_BYTES);
    body.set(signature);
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(body.slice(0, 2));
              controller.enqueue(body.slice(2));
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Type": "image/png",
              "Content-Length": String(IMAGE_BYTES),
            },
          },
        ),
    );
    expect(
      (await fetchProviderPhoto(url, new AbortController().signal)).size,
    ).toBe(IMAGE_BYTES);
  });
});
