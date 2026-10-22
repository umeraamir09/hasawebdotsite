import type { AssetPurpose } from "@hasaweb/schema";
import { resolvePrivateAsset } from "../lib/assets";
import worker from "../worker";

type Env = CloudflareEnv & { RUNTIME_KEY: string; RUNTIME_ORIGIN: string };
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (
      request.headers.get("X-Runtime-Key") !== env.RUNTIME_KEY ||
      new URL(request.url).origin !== env.RUNTIME_ORIGIN
    )
      return new Response(null, { status: 404 });
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/__fixture/page")
      return new Response("<!doctype html><title>Uploads</title>", {
        headers: { "Content-Type": "text/html" },
      });
    if (url.pathname === "/__fixture/sql") {
      const { query, values = [] } = await request.json<{
        query: string;
        values?: unknown[];
      }>();
      return Response.json(
        await env.DB.prepare(query)
          .bind(...values)
          .all(),
      );
    }
    if (url.pathname === "/__fixture/objects")
      return Response.json(
        (await env.DRAFT_BUCKET.list()).objects.map(({ key, size }) => ({
          key,
          size,
        })),
      );
    if (url.pathname === "/__fixture/remove-object") {
      await env.DRAFT_BUCKET.delete(url.searchParams.get("key") ?? "");
      return new Response("ok");
    }
    if (url.pathname === "/__fixture/resolve") {
      const identity = {
        user: { id: "upload-alice" },
        session: { id: "upload-session-alice" },
      };
      const id = url.searchParams.get("id") ?? "";
      const purpose = url.searchParams.get("purpose");
      if (purpose !== "avatar" && purpose !== "resume")
        return new Response(null, { status: 400 });
      const result = await resolvePrivateAsset(
        env,
        identity,
        id,
        purpose satisfies AssetPurpose,
      );
      if (result) await result.object.body.cancel();
      return new Response(null, { status: result ? 200 : 404 });
    }
    const mode = request.headers.get("X-Fixture-Mode");
    let intercepted = false;
    let finalizeFailed = false;
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === "prepare")
          return (query: string) => wrap(target.prepare(query), query);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    function wrap(
      statement: D1PreparedStatement,
      query: string,
    ): D1PreparedStatement {
      return new Proxy(statement, {
        get(target, key) {
          if (key === "bind")
            return (...values: unknown[]) =>
              wrap(target.bind(...values), query);
          if (
            key === "raw" ||
            key === "run" ||
            key === "all" ||
            key === "first"
          )
            return async (...args: unknown[]) => {
              const finalize =
                /^update "asset" set /i.test(query) &&
                query.includes('"status" =') &&
                query.includes('"bytes" =');
              if (finalizeFailed && mode === "uncertain")
                throw new Error("Fixture unavailable D1");
              if (finalize && !intercepted) {
                intercepted = true;
                if (mode === "revoke")
                  await env.DB.prepare(
                    "DELETE FROM session WHERE id='upload-session-alice'",
                  ).run();
                if (mode === "delete")
                  await env.DB.prepare(
                    "UPDATE user SET deleting_at=? WHERE id='upload-alice'",
                  )
                    .bind(Date.now())
                    .run();
                if (mode === "delete-portfolio")
                  await env.DB.prepare(
                    "UPDATE portfolio SET status='deleting' WHERE id='upload-portfolio-alice'",
                  ).run();
                if (
                  mode === "finalize-before" ||
                  mode === "uncertain" ||
                  mode === "cleanup-failure"
                ) {
                  finalizeFailed = true;
                  throw new Error("Fixture failed before D1 finalization");
                }
                if (mode === "finalize-after") {
                  await target.raw();
                  throw new Error("Fixture lost committed D1 response");
                }
              }
              const method = Reflect.get(target, key);
              return Reflect.apply(method, target, args);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    const bucket = new Proxy(env.DRAFT_BUCKET, {
      get(target, key) {
        if (key === "put")
          return (...args: Parameters<R2Bucket["put"]>) => {
            if (mode === "storage-sync")
              throw new Error("Fixture synchronous storage failure");
            return (async () => {
              if (mode === "storage-before" || mode === "storage-before-stall")
                throw new Error("Fixture storage rejected");
              if (mode === "storage-stall")
                await new Promise((resolve) => setTimeout(resolve, 31_000));
              if (mode === "collision")
                await target.put(args[0], new Uint8Array([1, 2, 3]));
              const result = await target.put(...args);
              if (mode === "storage-delay")
                await new Promise((resolve) => setTimeout(resolve, 31_000));
              if (mode === "storage-after")
                throw new Error("Fixture lost R2 response");
              return result;
            })();
          };
        if (key === "get" && mode === "get-revoke")
          return async (...args: Parameters<R2Bucket["get"]>) => {
            const result = await target.get(...args);
            await env.DB.prepare(
              "DELETE FROM session WHERE id='upload-session-alice'",
            ).run();
            return result;
          };
        if (key === "delete" && mode === "cleanup-failure")
          return async () => {
            throw new Error("Fixture cleanup unavailable");
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const virtual = new URL(request.url);
    virtual.protocol = "https:";
    virtual.host = "hasaweb.site";
    virtual.port = "";
    const headers = new Headers(request.headers);
    if (headers.get("Origin") === env.RUNTIME_ORIGIN)
      headers.set("Origin", virtual.origin);
    let body = request.body;
    let canceled = false;
    if (
      mode === "chunked" ||
      mode === "short" ||
      mode === "stall" ||
      mode === "total" ||
      mode === "abort" ||
      mode === "interrupt" ||
      mode === "storage-before-stall" ||
      mode === "storage-stall" ||
      mode === "storage-sync" ||
      mode === "aborted"
    ) {
      headers.delete("Content-Length");
      const bytes = new Uint8Array(await request.arrayBuffer());
      let offset = 0;
      let pullTimer: ReturnType<typeof setTimeout>;
      body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (
            mode === "storage-before-stall" ||
            mode === "storage-sync" ||
            mode === "aborted"
          )
            return new Promise(() => {});
          if (offset < Math.min(12, bytes.length)) {
            controller.enqueue(bytes.subarray(offset, ++offset));
            return;
          }
          if (mode === "stall" || mode === "abort")
            return new Promise(() => {});
          if (mode === "total")
            return new Promise<void>((resolve) => {
              pullTimer = setTimeout(() => {
                controller.enqueue(bytes.subarray(offset, ++offset));
                resolve();
              }, 1_000);
            });
          if (mode === "interrupt") {
            controller.error(new Error("Fixture interrupted"));
            return;
          }
          if (mode === "short") {
            controller.close();
            return;
          }
          if (offset < bytes.length) {
            controller.enqueue(bytes.subarray(offset));
            offset = bytes.length;
            return;
          }
          controller.close();
        },
        cancel() {
          clearTimeout(pullTimer);
          canceled = true;
        },
      });
    }
    const abortController = new AbortController();
    if (mode === "aborted") abortController.abort();
    const abortTimer =
      mode === "abort"
        ? setTimeout(() => abortController.abort(), 100)
        : undefined;
    const forwarded = new Request(virtual, {
      method: request.method,
      headers,
      body,
      signal:
        mode === "aborted" || mode === "abort"
          ? abortController.signal
          : request.signal,
      redirect: "manual",
    });
    const result = await worker.fetch(
      forwarded,
      { ...env, DB: db, DRAFT_BUCKET: bucket, APP_ORIGIN: virtual.origin },
      ctx,
    );
    clearTimeout(abortTimer);
    result.headers.set(
      "X-Fixture-Content-Length",
      headers.get("Content-Length") ?? "absent",
    );
    result.headers.set("X-Fixture-Canceled", String(canceled));
    result.headers.set("X-Fixture-Finalize-Intercepted", String(intercepted));
    return result;
  },
};
