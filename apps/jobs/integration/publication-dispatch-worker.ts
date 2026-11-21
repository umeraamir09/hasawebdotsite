import { type AuthEnvironment, currentSessionIdentity } from "@hasaweb/auth";
import {
  ownerPublicationCommit,
  ownerPublicationSite,
  PublicationCommitError,
  publicationRetainsAsset,
  publicationTasks,
  requestAccountDeletion,
  type Wake,
  wakeSchema,
} from "@hasaweb/db";
import { servePublic } from "../../site/src/public-serving";
import { runAccountDeletion } from "../src/account-deletion";
import {
  type DispatchEnv,
  runPublicationBatch,
  sweepPublicationTasks,
} from "../src/publication-dispatch";
import { withdrawUnpublished } from "../src/publication-unpublish";
import { withPublicationFault } from "./publication-faults";
import { measureDispatch } from "./publication-measure";

type Env = DispatchEnv &
  AuthEnvironment & {
    RUNTIME_KEY: string;
    MEASURE_QUOTAS?: string;
    MANUAL_DISPATCH?: string;
    SOURCE_FIXTURE: Fetcher;
  };
const counters = new WeakMap<
  object,
  ReturnType<typeof measureDispatch>["counts"]
>();
function measured(env: Env): Env {
  if (env.MEASURE_QUOTAS !== "true") return env;
  const measurement = measureDispatch(env);
  counters.set(measurement.env, measurement.counts);
  return measurement.env;
}
export default {
  async fetch(request: Request, original: Env) {
    if (request.headers.get("X-Runtime-Key") !== original.RUNTIME_KEY)
      return new Response(null, { status: 404 });
    const fault = request.headers.get("X-S8-Fault");
    if (fault === "write-after") {
      const bucket = original.SITES_BUCKET;
      original = {
        ...original,
        SITES_BUCKET: new Proxy(bucket, {
          get(target, key) {
            if (key === "put")
              return async (...args: Parameters<typeof target.put>) => {
                await target.put(...args);
                throw new Error("injected_post_write");
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      };
    }
    if (fault === "queue-after") {
      const queue = original.PUBLICATION_QUEUE;
      original = {
        ...original,
        PUBLICATION_QUEUE: new Proxy(queue, {
          get(target, key) {
            if (key === "send")
              return async (...args: Parameters<typeof target.send>) => {
                await target.send(...args);
                throw new Error("injected_lost_enqueue_ack");
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      };
    }
    const base = measured(original);
    const env = withPublicationFault(base, fault);
    const counter = counters.get(base);
    if (counter) counters.set(env, counter);
    const url = new URL(request.url);
    const reply = (value: unknown, status = 200) =>
      Response.json(
        { value, counts: counters.get(env)?.() ?? null },
        { status },
      );
    try {
      if (url.pathname === "/health") return reply("ok");
      if (url.pathname === "/sql" && request.method === "POST") {
        const input = await request.json<{ sql: string; values: unknown[] }>();
        return reply(
          await env.DB.prepare(input.sql)
            .bind(...input.values)
            .all(),
        );
      }
      if (url.pathname === "/create" && request.method === "POST") {
        const identity = await currentSessionIdentity(env, request.headers);
        if (!identity) return reply("unauthorized", 401);
        const body = await request.json<{ revision: number }>();
        const id = await publicationTasks(env.DB).create(
          identity,
          "s8-portfolio",
          body.revision,
          {
            batchSize: Number(env.PUBLICATION_TASK_BATCH ?? 16),
            assetOrigin: env.ASSET_ORIGIN,
          },
        );
        if (env.MANUAL_DISPATCH !== "true")
          await env.PUBLICATION_QUEUE.send({ candidateId: id });
        return reply({ id });
      }
      if (url.pathname === "/commit" && request.method === "POST") {
        const identity = await currentSessionIdentity(env, request.headers);
        if (!identity) return reply({ code: "unauthorized" }, 401);
        return reply(
          await ownerPublicationCommit(env.DB, identity, {
            assetOrigin: env.ASSET_ORIGIN,
          }).commit(await request.json()),
        );
      }
      // Phase 48: the owner's Unpublish, with its cleanup driven by
      // /withdraw-unpublished rather than the queue.
      if (url.pathname === "/unpublish" && request.method === "POST") {
        const identity = await currentSessionIdentity(env, request.headers);
        if (!identity) return reply({ code: "unauthorized" }, 401);
        const woken: unknown[] = [];
        const site = await ownerPublicationSite(env.DB, identity).unpublish(
          "s8-portfolio",
          { send: async (body) => void woken.push(body) },
        );
        return reply({ site, woken });
      }
      // Phase 49: the owner's account deletion, with its cleanup driven by
      // /run-deletion rather than the queue.
      if (url.pathname === "/delete-account" && request.method === "POST") {
        const identity = await currentSessionIdentity(env, request.headers);
        if (!identity) return reply({ code: "unauthorized" }, 401);
        return reply(await requestAccountDeletion(env.DB, identity));
      }
      if (url.pathname === "/draft-objects")
        return env.SOURCE_FIXTURE.fetch(
          new Request("https://fixture.internal/list", {
            headers: { "X-Runtime-Key": env.RUNTIME_KEY },
          }),
        );
      if (url.pathname === "/serve" && request.method === "POST") {
        const body = await request.json<{
          url: string;
          method?: "GET" | "HEAD";
          ifNoneMatch?: string;
        }>();
        return servePublic(
          new Request(body.url, {
            method: body.method ?? "GET",
            headers: body.ifNoneMatch
              ? { "If-None-Match": body.ifNoneMatch }
              : {},
          }),
          env,
        );
      }
      if (url.pathname === "/seed-asset")
        return env.SOURCE_FIXTURE.fetch(
          new Request(
            `https://fixture.internal/object?key=${encodeURIComponent(url.searchParams.get("key") ?? "")}`,
            {
              method: request.method,
              headers: { "X-Runtime-Key": env.RUNTIME_KEY },
              body: request.body,
            },
          ),
        );
      if (url.pathname === "/seed-live") {
        await env.SITES_BUCKET.put(
          "live/s8-portfolio/7.html",
          "<p>Previous complete version</p>",
        );
        return reply(true);
      }
      if (url.pathname === "/retains")
        return reply(
          await publicationRetainsAsset(
            env.DB,
            "s8-portfolio",
            url.searchParams.get("asset") ?? "",
          ),
        );
      const id = url.searchParams.get("id");
      if (!id) return reply("missing id", 400);
      if (url.pathname === "/status")
        return reply(await publicationTasks(env.DB).get(id));
      if (url.pathname === "/advance" && env.MANUAL_DISPATCH === "true") {
        return reply(await runPublicationBatch(env, id));
      }
      if (url.pathname === "/source-check")
        return env.PRIVATE_SOURCE.fetch(
          new Request("https://publication-source.internal/source", {
            method: "POST",
            body: await request.text(),
          }),
        );
      if (url.pathname === "/checkpoint") {
        const body = await request.json<{
          row: import("@hasaweb/db").Candidate;
        }>();
        return reply(
          await publicationTasks(env.DB).checkpoint(body.row, {
            cursor: body.row.cursor,
            outputCount: body.row.output_count,
            pageIndex: body.row.page_index,
            status: body.row.status,
          }),
        );
      }
      if (url.pathname === "/claim")
        return reply(await publicationTasks(env.DB).claim(id));
      if (url.pathname === "/withdraw-unpublished")
        return reply(
          await withdrawUnpublished(
            {
              ...env,
              APP_ENV: "test",
              PUBLICATION_QUEUE: { send: async () => {} } as never,
            },
            id,
          ),
        );
      if (url.pathname === "/run-deletion") {
        const woken: unknown[] = [];
        const stage = await runAccountDeletion(
          {
            ...env,
            APP_ENV: "test",
            PUBLICATION_QUEUE: {
              send: async (body: unknown) => void woken.push(body),
            },
          },
          id,
        );
        return reply({ stage, woken });
      }
      if (url.pathname === "/sweep")
        return reply(await sweepPublicationTasks(env));
      if (url.pathname === "/cleanup") {
        const accepted = await publicationTasks(env.DB).startCleanup(id);
        if (accepted && env.MANUAL_DISPATCH !== "true")
          await env.PUBLICATION_QUEUE.send({ candidateId: id });
        return reply(accepted);
      }
      if (url.pathname === "/objects")
        return reply({
          sites: await env.SITES_BUCKET.list({
            prefix: `candidate/${id}/`,
            limit: 1000,
          }),
          assets: await env.PUBLIC_ASSETS_BUCKET.list({
            prefix: `candidate/${id}/`,
            limit: 1000,
          }),
        });
      if (url.pathname === "/live") {
        const object = await env.SITES_BUCKET.get("live/s8-portfolio/7.html");
        return new Response(object?.body ?? null, {
          status: object ? 200 : 404,
        });
      }
      if (url.pathname === "/file") {
        const key = url.searchParams.get("key") ?? "";
        if (!key.startsWith(`candidate/${id}/`))
          return reply("invalid key", 400);
        const bucket =
          url.searchParams.get("bucket") === "assets"
            ? env.PUBLIC_ASSETS_BUCKET
            : env.SITES_BUCKET;
        const object = await bucket.get(key);
        return new Response(object?.body ?? null, {
          status: object ? 200 : 404,
          headers: {
            "Content-Type":
              object?.httpMetadata?.contentType ?? "application/octet-stream",
          },
        });
      }
      if (url.pathname === "/output") {
        const object = await env.SITES_BUCKET.get(
          `candidate/${id}/pages/${Number(url.searchParams.get("page") ?? 0)}.html`,
        );
        return new Response(object?.body ?? null, {
          status: object ? 200 : 404,
        });
      }
      if (url.pathname === "/asset") {
        const object = await env.PUBLIC_ASSETS_BUCKET.get(
          `candidate/${id}/assets/${url.searchParams.get("asset")}`,
        );
        return new Response(object?.body ?? null, {
          status: object ? 200 : 404,
        });
      }
      return reply("missing route", 404);
    } catch (error) {
      if (error instanceof PublicationCommitError)
        return reply({ code: error.code, error: error.message }, 409);
      return reply(
        { error: error instanceof Error ? error.message : "failed" },
        500,
      );
    }
  },
  async queue(batch: MessageBatch<Wake>, original: Env) {
    if (original.MANUAL_DISPATCH === "true") {
      batch.ackAll();
      return;
    }
    let processed = false;
    for (const message of batch.messages) {
      if (processed) {
        message.retry({ delaySeconds: 2 });
        continue;
      }
      processed = true;
      const input = wakeSchema.safeParse(message.body);
      if (!input.success) {
        message.ack();
        continue;
      }
      const env = measured(original);
      try {
        await runPublicationBatch(env, input.data.candidateId);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 2 });
      }
      if (env.MEASURE_QUOTAS === "true")
        console.log(
          JSON.stringify({
            kind: "s8_quota",
            candidateId: input.data.candidateId,
            counts: counters.get(env)?.(),
          }),
        );
    }
  },
  async scheduled(_event: ScheduledController, env: Env) {
    await sweepPublicationTasks(env);
  },
} satisfies ExportedHandler<Env, Wake>;
