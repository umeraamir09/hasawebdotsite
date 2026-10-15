import { classifyHost } from "./host-policy";

interface Env {
  SITES_BUCKET: R2Bucket;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = classifyHost(url.host);
    const headers = {
      "Cache-Control": "no-store",
      "X-Spike-Target": "site",
      "X-Content-Type-Options": "nosniff",
    };
    if (target !== "portfolio" && target !== "internal-example")
      return new Response("Host rejected", { status: 421, headers });
    // The only published fixture. No draft, auth, arbitrary R2 key or owner API.
    if (url.hostname !== "routingprobe.hasaweb.site" || url.pathname !== "/")
      return new Response("This portfolio is unavailable.", {
        status: 404,
        headers,
      });
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405, headers });
    const object = await env.SITES_BUCKET.get("routing-probe/index.html");
    if (!object)
      return new Response("Fixture unavailable", { status: 503, headers });
    return new Response(request.method === "HEAD" ? null : object.body, {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;
