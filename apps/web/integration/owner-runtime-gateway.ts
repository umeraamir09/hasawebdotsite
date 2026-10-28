// External fixture authority is translated only in this separately built experiment.
import { privateJson } from "@hasaweb/db";
import { measureDb } from "../../jobs/integration/measure-db";
import worker from "../worker";

export { PublicationAssets } from "../lib/assets/publication-source";

import {
  providerRequests,
  releaseProviderPhoto,
} from "./provider-photo-fixture";

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
    if (url.pathname === "/__fixture/provider-photo") {
      if (request.method === "POST") releaseProviderPhoto();
      return privateJson({ requests: providerRequests });
    }
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
    const fault = request.headers.get("X-Fixture-Setup-SQL");
    let injected = false;
    const measured = url.pathname.startsWith("/api/owner/setup/")
      ? measureDb(env.DB, async (query) => {
          if (
            injected ||
            !/UPDATE portfolio SET first_editor_entered_at/.test(query)
          )
            return;
          injected = true;
          if (request.headers.has("X-Fixture-Setup-Fail"))
            throw new Error("D1_ERROR: controlled handoff failure");
          if (fault) {
            const commands = JSON.parse(fault) as {
              query: string;
              values?: unknown[];
            }[];
            for (const command of commands)
              await env.DB.prepare(command.query)
                .bind(...(command.values ?? []))
                .run();
          }
        })
      : null;
    const response = await worker.fetch(
      forwarded,
      {
        ...env,
        ...(measured ? { DB: measured.db } : {}),
        APP_ORIGIN: virtual.origin,
      } as unknown as CloudflareEnv,
      ctx,
    );
    if (measured) {
      response.headers.set(
        "X-Fixture-Rows-Read",
        String(measured.counts.reads),
      );
      response.headers.set(
        "X-Fixture-Rows-Written",
        String(measured.counts.writes),
      );
      response.headers.set(
        "X-Fixture-Queries",
        String(measured.counts.queries),
      );
    }
    return response;
  },
};
