import { z } from "zod";

export type PublicationCacheEnv = {
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_CACHE_PURGE_TOKEN?: string;
  CACHE_HTTP?: Pick<Fetcher, "fetch">;
};
const credentials = z.object({
  CLOUDFLARE_ZONE_ID: z.string().regex(/^[a-f0-9]{32}$/),
  CLOUDFLARE_CACHE_PURGE_TOKEN: z.string().min(1),
});
const accepted = z.object({ success: z.literal(true) });
function send(env: PublicationCacheEnv, url: string, init?: RequestInit) {
  return env.CACHE_HTTP ? env.CACHE_HTTP.fetch(url, init) : fetch(url, init);
}
export async function purgePublicationHosts(
  env: PublicationCacheEnv,
  hosts: string[],
) {
  const config = credentials.parse(env);
  const response = await send(
    env,
    `https://api.cloudflare.com/client/v4/zones/${config.CLOUDFLARE_ZONE_ID}/purge_cache`,
    {
      method: "POST",
      // Workers fetch rejects "error". A redirect is never followed and,
      // as a non-2xx status, is classified as a rejection below.
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.CLOUDFLARE_CACHE_PURGE_TOKEN}`,
      },
      body: JSON.stringify({ hosts }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Cache purge rejected");
  }
  accepted.parse(await response.json());
}
export async function verifyPublicationUrl(
  env: PublicationCacheEnv,
  url: string,
  expected: { status: 404 } | { status: 200; sha256: string },
) {
  // Do not send no-cache headers or a cache-bypass option: that would hide a
  // stale cached response instead of observing the visitor's cache policy.
  const response = await send(env, url, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  await response.body?.cancel();
  if (
    response.status !== expected.status ||
    !response.headers
      .get("Cache-Control")
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "no-store") ||
    ["HIT", "STALE", "UPDATING"].includes(
      response.headers.get("CF-Cache-Status")?.toUpperCase() ?? "",
    ) ||
    (expected.status === 200 &&
      response.headers.get("ETag") !== `"${expected.sha256}"`)
  )
    throw new Error("Cache withdrawal is not yet observable");
}
