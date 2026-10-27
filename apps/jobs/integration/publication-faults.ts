import type { DispatchEnv } from "../src/publication-dispatch";

// Imported only by the keyed synthetic fixture, never a product entry point.
export function withPublicationFault<T extends DispatchEnv>(
  env: T,
  fault: string | null,
): T {
  if (fault?.startsWith("source-")) {
    const source = env.PRIVATE_SOURCE;
    return {
      ...env,
      PRIVATE_SOURCE: new Proxy(source, {
        get(target, key) {
          if (key !== "fetch") {
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return async (...args: Parameters<Fetcher["fetch"]>) => {
            const response = await target.fetch(...args);
            if (!response.ok || !response.body) return response;
            const reader = response.body.getReader();
            const body = new ReadableStream<Uint8Array>({
              async start(controller) {
                if (fault === "source-idle") return;
                const part = await reader.read();
                if (!part.done)
                  controller.enqueue(
                    part.value.subarray(
                      0,
                      Math.max(1, Math.floor(part.value.byteLength / 2)),
                    ),
                  );
                if (fault === "source-interrupted")
                  controller.error(new Error("injected_source_interrupted"));
                else controller.close();
                await reader.cancel().catch(() => {});
              },
              async cancel() {
                await reader.cancel().catch(() => {});
              },
            });
            return new Response(body, {
              status: response.status,
              headers: response.headers,
            });
          };
        },
      }),
    };
  }
  if (fault === "checkpoint-before" || fault === "checkpoint-after") {
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, key) {
          if (key === "bind")
            return (...args: unknown[]) => wrap(target.bind(...args));
          if (key === "first")
            return async (...args: Parameters<typeof target.first>) => {
              if (fault === "checkpoint-before")
                throw new Error("injected_checkpoint_before");
              await target.first(...args);
              throw new Error("injected_checkpoint_after");
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    return {
      ...env,
      DB: new Proxy(env.DB, {
        get(target, key) {
          if (key === "prepare")
            return (sql: string) =>
              sql.startsWith("UPDATE publication_candidate SET cursor=")
                ? wrap(target.prepare(sql))
                : target.prepare(sql);
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
  }
  if (
    ["r2-before", "r2-after", "delete-during-copy", "cleanup-delete"].includes(
      fault ?? "",
    )
  ) {
    const bucket = (value: R2Bucket) =>
      new Proxy(value, {
        get(target, key) {
          if (key === "delete" && fault === "cleanup-delete")
            return () => {
              throw new Error("injected_cleanup_delete");
            };
          if (key === "put")
            return async (...args: Parameters<typeof target.put>) => {
              if (fault === "r2-before") throw new Error("injected_r2_before");
              if (fault === "delete-during-copy")
                await env.DB.prepare(
                  "UPDATE user SET deleting_at=? WHERE id='s8-owner'",
                )
                  .bind(Date.now())
                  .run();
              const result = await target.put(...args);
              if (fault === "r2-after") throw new Error("injected_r2_after");
              return result;
            };
          const item = Reflect.get(target, key);
          return typeof item === "function" ? item.bind(target) : item;
        },
      });
    return {
      ...env,
      SITES_BUCKET: bucket(env.SITES_BUCKET),
      PUBLIC_ASSETS_BUCKET: bucket(env.PUBLIC_ASSETS_BUCKET),
    };
  }
  return env;
}
