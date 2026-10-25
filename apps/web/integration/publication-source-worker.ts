import { WorkerEntrypoint } from "cloudflare:workers";
import { measureDb } from "../../jobs/integration/measure-db";
import {
  type PublicationSourceEnv,
  publicationSource,
} from "../lib/assets/publication-source";

export class PublicationAssets extends WorkerEntrypoint<
  PublicationSourceEnv & { MEASURE_QUOTAS?: string }
> {
  async fetch(request: Request) {
    if (this.env.MEASURE_QUOTAS !== "true")
      return publicationSource(request, this.env);
    const measurement = measureDb(this.env.DB);
    let reads = 0;
    const bucket = new Proxy(this.env.DRAFT_BUCKET, {
      get(target, key) {
        if (key === "get")
          return (...args: Parameters<typeof target.get>) => {
            reads++;
            return target.get(...args);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const response = await publicationSource(request, {
      DB: measurement.db,
      DRAFT_BUCKET: bucket,
    });
    const headers = new Headers(response.headers);
    headers.set("X-S8-Reads", String(measurement.counts.reads));
    headers.set("X-S8-Writes", String(measurement.counts.writes));
    headers.set("X-S8-Queries", String(measurement.counts.queries));
    headers.set("X-S8-R2-Reads", String(reads));
    return new Response(response.body, { status: response.status, headers });
  }
}
export default {
  async fetch(
    request: Request,
    env: { RUNTIME_KEY: string; DRAFT_BUCKET: R2Bucket },
  ) {
    if (request.headers.get("X-Runtime-Key") !== env.RUNTIME_KEY)
      return new Response(null, { status: 404 });
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    const key = url.searchParams.get("key");
    if (!key?.startsWith("draft/s8-portfolio/"))
      return new Response(null, { status: 400 });
    if (request.method === "PUT") {
      await env.DRAFT_BUCKET.put(key, await request.arrayBuffer());
      return new Response("ok");
    }
    const object = await env.DRAFT_BUCKET.get(key);
    return new Response(object?.body ?? null, { status: object ? 200 : 404 });
  },
};
