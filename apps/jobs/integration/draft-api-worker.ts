// Isolated correctness/benchmark entry. Never imported by product code.
import { WorkerEntrypoint } from "cloudflare:workers";
import type { AuthEnvironment } from "@hasaweb/auth";
import { privateJson } from "@hasaweb/db";
import { servePublic } from "../../site/src/public-serving";
import jobsWorker from "../src/index";
import { ownerRouter } from "../src/owner-api";
import { purgePublicationHosts } from "../src/publication-cache";
import type { DispatchEnv } from "../src/publication-dispatch";
import { withdrawPublication } from "../src/publication-withdrawal";
import { measureDb } from "./measure-db";

type Env = AuthEnvironment &
  DispatchEnv & {
    RUNTIME_KEY: string;
    RUNTIME_ENABLED: string;
    MEASURE_DB?: string;
  };
let previousEnvironment: Env | undefined;
let previousDatabase: D1Database | undefined;
export class RuntimeOwnerApi extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    if (
      this.env.RUNTIME_ENABLED !== "true" ||
      request.headers.get("X-Runtime-Key") !== this.env.RUNTIME_KEY
    )
      return privateJson(null, 404);
    const sameEnvironment = previousEnvironment === this.env;
    const sameDatabase = previousDatabase === this.env.DB;
    previousEnvironment = this.env;
    previousDatabase = this.env.DB;
    const preparation = request.headers.get("X-Fixture-Prepare");
    if (preparation) {
      const commands = JSON.parse(preparation) as {
        query: string;
        values?: unknown[];
      }[];
      for (const command of commands)
        await this.env.DB.prepare(command.query)
          .bind(...(command.values ?? []))
          .run();
    }
    const revoke = request.headers.get("X-Fixture-Revoke"),
      deleting = request.headers.get("X-Fixture-Delete"),
      failRead = request.headers.get("X-Fixture-Fail-Read"),
      fail = request.headers.get("X-Fixture-Fail");
    let injected = false;
    const measured =
      this.env.MEASURE_DB === "true" || revoke || deleting || fail || failRead
        ? measureDb(this.env.DB, async (query) => {
            if (failRead && /FROM\s+"?portfolio"?/i.test(query))
              throw new Error("D1_ERROR: controlled fixture read failure");
            if (injected || !/UPDATE\s+"?portfolio"?\s+SET/i.test(query))
              return;
            injected = true;
            if (fail) throw new Error("D1_ERROR: controlled fixture failure");
            if (revoke)
              await this.env.DB.prepare("DELETE FROM session WHERE id=?")
                .bind(revoke)
                .run();
            if (deleting)
              await this.env.DB.prepare(
                "UPDATE user SET deleting_at=? WHERE id=?",
              )
                .bind(Date.now(), deleting)
                .run();
          })
        : null;
    const response = await ownerRouter.fetch(
      request,
      measured ? { ...this.env, DB: measured.db } : this.env,
      this.ctx,
    );
    response.headers.set("X-Fixture-Same-Environment", String(sameEnvironment));
    response.headers.set("X-Fixture-Same-Database", String(sameDatabase));
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
  }
}
export default {
  async fetch(request: Request, env: Env) {
    if (
      env.RUNTIME_ENABLED !== "true" ||
      request.headers.get("X-Runtime-Key") !== env.RUNTIME_KEY
    )
      return privateJson(null, 404);
    if (new URL(request.url).pathname === "/__fixture/public-object")
      return privateJson({
        exists: !!(await env.PUBLIC_ASSETS_BUCKET.head(
          new URL(request.url).searchParams.get("key") ?? "",
        )),
      });
    if (new URL(request.url).pathname === "/__fixture/withdraw-check") {
      const id = new URL(request.url).searchParams.get("id") ?? "";
      const verified = request.headers.get("X-Fixture-Verified") === "true";
      // Every URL the cleanup observed, so tests can prove what it verified.
      const observed: string[] = [];
      try {
        const checked = {
          ...env,
          APP_ENV: "production",
          CLOUDFLARE_ZONE_ID: "0".repeat(32),
          CLOUDFLARE_CACHE_PURGE_TOKEN: "fixture-only",
          CACHE_HTTP: {
            fetch: async (input: RequestInfo | URL) => {
              const url = String(input);
              observed.push(url);
              if (url.startsWith("https://api.cloudflare.com/"))
                return Response.json({ success: true });
              return verified
                ? servePublic(new Request(url), env)
                : new Response("stale cached content", {
                    headers: {
                      "Cache-Control": "public,max-age=3600",
                      "CF-Cache-Status": "HIT",
                    },
                  });
            },
          },
        };
        await purgePublicationHosts(checked, [
          "publication-final.hasaweb.site",
        ]);
        await withdrawPublication(checked, id);
        return privateJson({ complete: true, observed });
      } catch {
        return privateJson({ complete: false, observed }, 503);
      }
    }
    if (
      new URL(request.url).pathname === "/__fixture/public" &&
      request.method === "POST"
    ) {
      const body = await request.json<{ url: string; method?: string }>();
      return servePublic(
        new Request(body.url, { method: body.method ?? "GET" }),
        env,
      );
    }
    if (
      new URL(request.url).pathname === "/__fixture/sql" &&
      request.method === "POST"
    ) {
      const { query, values = [] } = await request.json<{
        query: string;
        values?: unknown[];
      }>();
      return privateJson(
        await env.DB.prepare(query)
          .bind(...values)
          .all(),
      );
    }
    return privateJson(null, 404);
  },
  async queue(
    batch: Parameters<typeof jobsWorker.queue>[0],
    env: Parameters<typeof jobsWorker.queue>[1],
  ) {
    const failure = await env.DB.prepare(
      "SELECT value FROM runtime_probe WHERE key='publication-withdrawal-failure'",
    ).first();
    if (!failure) return jobsWorker.queue(batch, env);
    const bucket = env.PUBLIC_ASSETS_BUCKET;
    return jobsWorker.queue(batch, {
      ...env,
      PUBLIC_ASSETS_BUCKET: new Proxy(bucket, {
        get(target, key) {
          if (key === "delete")
            return async () => {
              throw new Error("injected_withdrawal_delete_failure");
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
  },
  scheduled: jobsWorker.scheduled,
};
