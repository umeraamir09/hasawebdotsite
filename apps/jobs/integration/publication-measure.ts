import type { DispatchEnv } from "../src/publication-dispatch";
import { measureDb } from "./measure-db";
export function measureDispatch<T extends DispatchEnv>(env: T) {
  const db = measureDb(env.DB),
    counts = {
      ...db.counts,
      r2Reads: 0,
      r2Writes: 0,
      r2Lists: 0,
      r2Deletes: 0,
      queueWrites: 0,
      sourceCalls: 0,
      platformCalls: 0,
      sourceReads: 0,
      sourceWrites: 0,
      sourceQueries: 0,
      sourceR2Reads: 0,
    };
  const bucket = (value: R2Bucket) =>
    new Proxy(value, {
      get(target, key) {
        const fn = Reflect.get(target, key);
        if (typeof fn !== "function") return fn;
        return (...args: unknown[]) => {
          if (key === "get" || key === "head") counts.r2Reads++;
          else if (key === "put") counts.r2Writes++;
          else if (key === "list") counts.r2Lists++;
          else if (key === "delete") counts.r2Deletes++;
          return fn.apply(target, args);
        };
      },
    });
  const source = new Proxy(env.PRIVATE_SOURCE, {
    get(target, key) {
      if (key === "fetch")
        return async (...args: Parameters<Fetcher["fetch"]>) => {
          counts.sourceCalls++;
          const response = await target.fetch(...args);
          counts.sourceReads += Number(response.headers.get("X-S8-Reads") ?? 0);
          counts.sourceWrites += Number(
            response.headers.get("X-S8-Writes") ?? 0,
          );
          counts.sourceQueries += Number(
            response.headers.get("X-S8-Queries") ?? 0,
          );
          counts.sourceR2Reads += Number(
            response.headers.get("X-S8-R2-Reads") ?? 0,
          );
          return response;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const queue = new Proxy(env.PUBLICATION_QUEUE, {
    get(target, key) {
      if (key === "send")
        return (...args: Parameters<typeof target.send>) => {
          counts.queueWrites++;
          return target.send(...args);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    env: {
      ...env,
      DB: db.db,
      SITES_BUCKET: bucket(env.SITES_BUCKET),
      PUBLIC_ASSETS_BUCKET: bucket(env.PUBLIC_ASSETS_BUCKET),
      PRIVATE_SOURCE: source,
      PLATFORM_ASSETS: new Proxy(env.PLATFORM_ASSETS, {
        get(target, key) {
          if (key === "fetch")
            return (...args: Parameters<Fetcher["fetch"]>) => {
              counts.platformCalls++;
              return target.fetch(...args);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
      PUBLICATION_QUEUE: queue,
    },
    counts: () => ({ ...counts, ...db.counts }),
  };
}
