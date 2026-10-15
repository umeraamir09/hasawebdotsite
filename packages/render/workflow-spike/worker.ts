import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { Atom } from "../spike/fixtures";
import { prefix, renderAtoms, suffix } from "../spike/render";

interface Ref {
  key: string;
  size: number;
}
interface Page {
  name: string;
  fragments: number;
}
interface Payload {
  id: string;
  site: string;
  base: string;
  pages: Page[];
  fault?: "retry" | "permanent";
  source?: string;
}
interface Env {
  APP_ENV: string;
  DB: D1Database;
  BUCKET: R2Bucket;
  FLOW: Workflow<Payload>;
}
const options = {
  retries: {
    limit: 1,
    delay: "1 second" as const,
    backoff: "constant" as const,
  },
};

// FixedLengthStream makes the total known to R2 without buffering the page.
async function assemble(bucket: R2Bucket, refs: Ref[], key: string) {
  if (!refs.length || refs.length > 32)
    throw new Error("Invalid assembly fan-in");
  const stream = new FixedLengthStream(
    refs.reduce((sum, ref) => sum + ref.size, 0),
  );
  const writer = stream.writable.getWriter();
  const producing = (async () => {
    try {
      for (const ref of refs) {
        const object = await bucket.get(ref.key);
        if (!object || object.size !== ref.size)
          throw new Error("Missing assembly source");
        const reader = object.body.getReader();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          await writer.write(chunk.value);
        }
      }
      await writer.close();
    } catch (error) {
      await writer.abort(error);
      throw error;
    }
  })();
  await Promise.all([bucket.put(key, stream.readable), producing]);
  return { key, size: refs.reduce((sum, ref) => sum + ref.size, 0) };
}

export class PublishSpike extends WorkflowEntrypoint<Env, Payload> {
  async run(event: WorkflowEvent<Payload>, step: WorkflowStep) {
    if (this.env.APP_ENV !== "local") throw new Error("Local spike only");
    const payload = event.payload;
    let count = 0;
    const pages: Ref[] = [];
    for (const page of payload.pages) {
      let refs: Ref[] = [];
      for (let offset = 0; offset < page.fragments; offset += 8) {
        const batch = Array.from(
          { length: Math.min(8, page.fragments - offset) },
          (_, index) => offset + index,
        );
        const rendered = await Promise.all(
          batch.map((index) =>
            step.do(`render-${page.name}-${index}`, options, async () => {
              const input = await this.env.BUCKET.get(
                `input/${payload.source ?? payload.id}/${page.name}/${index}`,
              );
              if (!input || input.size > 8192)
                throw new Error("Invalid fragment bytes");
              const atoms = await input.json<Atom[]>();
              if (atoms.length > 64) throw new Error("Invalid fragment nodes");
              const started = performance.now();
              const html =
                (index === 0 ? prefix : "") +
                renderAtoms(atoms) +
                (index === page.fragments - 1 ? suffix : "");
              const renderMs = performance.now() - started;
              const key = `candidate/${payload.id}/${page.name}/fragment-${index}`;
              await this.env.BUCKET.put(key, html);
              if (index === 0 && payload.fault) {
                const attempt = await this.env.DB.prepare(
                  "INSERT INTO attempts(id, count) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count",
                )
                  .bind(payload.id)
                  .first<{ count: number }>();
                if (payload.fault === "permanent" || attempt?.count === 1)
                  throw new Error("Injected fault after R2 write");
              }
              return {
                key,
                size: new TextEncoder().encode(html).length,
                renderMs,
              };
            }),
          ),
        );
        refs.push(...rendered);
        count += rendered.length;
      }
      let level = 0;
      while (refs.length > 1) {
        const next: Ref[] = [];
        for (let index = 0; index < refs.length; index += 32) {
          const group = refs.slice(index, index + 32);
          next.push(
            await step.do(
              `assemble-${page.name}-${level}-${index}`,
              options,
              () =>
                assemble(
                  this.env.BUCKET,
                  group,
                  `candidate/${payload.id}/${page.name}/level-${level}-${index}`,
                ),
            ),
          );
          count++;
        }
        refs = next;
        level++;
      }
      const result = refs[0];
      if (!result) throw new Error("Empty page");
      pages.push(result);
    }
    const manifest = await step.do("manifest", options, async () => {
      const key = `candidate/${payload.id}/manifest.json`;
      await this.env.BUCKET.put(key, JSON.stringify(pages));
      return key;
    });
    const committed = await step.do("commit", options, async () => {
      const result = await this.env.DB.prepare(
        "UPDATE sites SET version=? WHERE id=? AND version=?",
      )
        .bind(payload.id, payload.site, payload.base)
        .run();
      if (result.meta.changes === 1) return true;
      // A retry after a successful write must report the committed result.
      const current = await this.env.DB.prepare(
        "SELECT version FROM sites WHERE id=?",
      )
        .bind(payload.site)
        .first<{ version: string }>();
      return current?.version === payload.id;
    });
    return { committed, manifest, pages, steps: count + 2 };
  }
}

export default {
  async fetch(request, env) {
    if (
      env.APP_ENV !== "local" ||
      new URL(request.url).hostname !== "127.0.0.1"
    )
      return new Response(null, { status: 404 });
    const url = new URL(request.url);
    const json = (value: unknown) =>
      Response.json(value, { headers: { "Cache-Control": "no-store" } });
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname === "/init" && request.method === "POST") {
      await env.DB.exec(
        "CREATE TABLE IF NOT EXISTS sites(id TEXT PRIMARY KEY, version TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, count INTEGER NOT NULL)",
      );
      return json({ ok: true });
    }
    if (url.pathname === "/site" && request.method === "POST") {
      const { site } = await request.json<{ site: string }>();
      await env.DB.prepare("INSERT INTO sites VALUES (?, 'old')")
        .bind(site)
        .run();
      return json({ ok: true });
    }
    if (url.pathname === "/object") {
      const key = url.searchParams.get("key");
      if (!key) return new Response(null, { status: 400 });
      if (request.method === "PUT") {
        await env.BUCKET.put(key, await request.arrayBuffer());
        return json({ ok: true });
      }
      if (request.method === "DELETE") {
        await env.BUCKET.delete(key);
        return json({ ok: true });
      }
      const object = await env.BUCKET.get(key);
      return object
        ? new Response(object.body)
        : new Response(null, { status: 404 });
    }
    if (url.pathname === "/start" && request.method === "POST") {
      const params = await request.json<Payload>();
      return json({
        id: (await env.FLOW.create({ id: params.id, params })).id,
      });
    }
    if (url.pathname === "/status") {
      const instance = await env.FLOW.get(
        url.searchParams.get("id") ?? "missing",
      );
      return json(await instance.status());
    }
    if (url.pathname === "/state")
      return json({
        sites: (await env.DB.prepare("SELECT * FROM sites").all()).results,
        attempts: (await env.DB.prepare("SELECT * FROM attempts").all())
          .results,
      });
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
