// External fixture authority is translated only in this separately built experiment.
import { privateJson } from "@hasaweb/db";
import worker from "../worker";

type Env = {
  RUNTIME_ORIGIN: string;
  RUNTIME_ENABLED: string;
  RUNTIME_KEY: string;
  OWNER_API: Fetcher;
  JOBS: Fetcher;
  DB: D1Database;
  DRAFT_BUCKET: R2Bucket;
};
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (
      env.RUNTIME_ENABLED !== "true" ||
      url.origin !== env.RUNTIME_ORIGIN ||
      request.headers.get("X-Runtime-Key") !== env.RUNTIME_KEY
    )
      return privateJson(null, 404);
    if (url.pathname === "/health") return privateJson({ ok: true });
    if (url.pathname === "/__fixture/direct-owner")
      return env.JOBS.fetch(
        new Request("https://hasaweb.site/api/owner", request),
      );
    if (url.pathname.startsWith("/__fixture/")) return env.JOBS.fetch(request);
    const virtual = new URL(request.url);
    virtual.protocol = "https:";
    virtual.host = "hasaweb.site";
    virtual.port = "";
    const headers = new Headers(request.headers);
    // Preserve a deliberately bad Origin for failure checks.
    if (headers.get("Origin") === env.RUNTIME_ORIGIN)
      headers.set("Origin", virtual.origin);
    const forwarded = new Request(virtual, new Request(request, { headers }));
    return worker.fetch(
      forwarded,
      { ...env, APP_ORIGIN: virtual.origin } as unknown as CloudflareEnv,
      ctx,
    );
  },
};
