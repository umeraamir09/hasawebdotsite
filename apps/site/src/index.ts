import { health, isLocalProbe } from "@hasaweb/config";
import type { RefreshMessage } from "@hasaweb/github";
import { servePublic } from "./public-serving";

interface Env {
  APP_ENV: string;
  DB: D1Database;
  SITES_BUCKET: R2Bucket;
  PUBLIC_ASSETS_BUCKET: R2Bucket;
  CONTACT_QUEUE: Queue;
  GITHUB_QUEUE: Queue<RefreshMessage>;
  ASSET_ORIGIN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_VERIFY_ORIGIN?: string;
}
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === "/health") return health("site");
    if (
      isLocalProbe(request, env.APP_ENV) &&
      path === "/__dev/resources" &&
      request.method === "GET"
    ) {
      const row = await env.DB.prepare(
        "SELECT value FROM runtime_probe WHERE key = 'seed'",
      ).first();
      const site = await env.SITES_BUCKET.get("runtime/site.txt");
      const asset = await env.PUBLIC_ASSETS_BUCKET.get("runtime/asset.txt");
      return Response.json({
        row,
        site: await site?.text(),
        asset: await asset?.text(),
      });
    }
    return servePublic(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
