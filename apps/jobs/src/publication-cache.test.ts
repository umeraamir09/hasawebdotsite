import { expect, it, vi } from "vitest";
import {
  purgePublicationHosts,
  verifyPublicationUrl,
} from "./publication-cache";

it("purges every query key by host without treating acceptance as observed absence", async () => {
  const send = vi.fn<typeof fetch>(async () =>
    Response.json({ success: true }),
  );
  const env = {
    CLOUDFLARE_ZONE_ID: "0".repeat(32),
    CLOUDFLARE_CACHE_PURGE_TOKEN: "fixture-only",
    CACHE_HTTP: { fetch: send },
  };
  await purgePublicationHosts(env, [
    "owner.hasaweb.site",
    "assets.hasaweb.site",
  ]);
  expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toEqual({
    hosts: ["owner.hasaweb.site", "assets.hasaweb.site"],
  });
  send.mockImplementation(
    async () =>
      new Response("removed content", {
        headers: { "Cache-Control": "no-store", "CF-Cache-Status": "HIT" },
      }),
  );
  await expect(
    verifyPublicationUrl(
      env,
      "https://assets.hasaweb.site/removed?variant=warm",
      { status: 404 },
    ),
  ).rejects.toThrow("not yet observable");
  expect(send.mock.calls[1]?.[1]?.headers).toBeUndefined();
  expect(send.mock.calls[1]?.[1]?.cache).toBeUndefined();
});
it("purges without following redirects and treats a redirect as a failed purge", async () => {
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://example.com/elsewhere" },
      }),
  );
  await expect(
    purgePublicationHosts(
      {
        CLOUDFLARE_ZONE_ID: "0".repeat(32),
        CLOUDFLARE_CACHE_PURGE_TOKEN: "fixture-only",
        CACHE_HTTP: { fetch: send },
      },
      ["owner.hasaweb.site"],
    ),
  ).rejects.toThrow("Cache purge rejected");
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[1]?.redirect).toBe("manual");
});
it("requires no-store absence and the current page hash without following redirects", async () => {
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store", "CF-Cache-Status": "MISS" },
      }),
  );
  const env = { CACHE_HTTP: { fetch: send } };
  await verifyPublicationUrl(env, "https://assets.hasaweb.site/removed", {
    status: 404,
  });
  send.mockImplementation(
    async () =>
      new Response(null, {
        status: 200,
        headers: { "Cache-Control": "no-store", ETag: '"new-hash"' },
      }),
  );
  await expect(
    verifyPublicationUrl(env, "https://owner.hasaweb.site/", {
      status: 200,
      sha256: "old-hash",
    }),
  ).rejects.toThrow();
  await verifyPublicationUrl(env, "https://owner.hasaweb.site/", {
    status: 200,
    sha256: "new-hash",
  });
  expect(send.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(
    true,
  );
});
