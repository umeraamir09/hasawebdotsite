import { projectPortfolio, withinBounds } from "@hasaweb/components/model";
import {
  type Candidate,
  candidateActive,
  PUBLICATION_RENDERER_VERSION,
  publicationTasks,
  type Wake,
} from "@hasaweb/db";
import { renderFragment } from "@hasaweb/render";
import { componentContentSchema, createEmptyDraft } from "@hasaweb/schema";
import { z } from "zod";
import {
  advancePreparation,
  cursorSchema,
  decodeSqlString,
  decodeTextSlice,
  type PreparationSource,
  type SourceNode,
} from "./publication-preparation";
import { putBoundedStream } from "./publication-stream";

export type DispatchEnv = {
  DB: D1Database;
  SITES_BUCKET: R2Bucket;
  PUBLIC_ASSETS_BUCKET: R2Bucket;
  PRIVATE_SOURCE: Fetcher;
  PUBLICATION_QUEUE: Queue<Wake>;
  ASSET_ORIGIN: string;
  PUBLICATION_TASK_BATCH?: string;
};
const root = (id: string) => `candidate/${id}/`;
const chunk = (id: string, page: number, level: number, index: number) =>
  `${root(id)}page-${page}/level-${level}/${index}`;
const assemblySchema = z.strictObject({
  page: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
  count: z.number().int().positive(),
  written: z.number().int().nonnegative(),
});
const decode = (wire: string, final: boolean) =>
  decodeTextSlice(wire, final).text;
export function preparationSource(
  env: DispatchEnv,
  row: Candidate,
): PreparationSource {
  const read = async (path: string, offset?: number): Promise<SourceNode> => {
    if (path.length > 4096 || (offset ?? 0) < 0)
      throw new Error("Source path envelope");
    const link =
      /^\$\.(profileLinks|socialLinks)(?:\[(\d+)\]\.(label|href))?$/.exec(path);
    if (link) {
      const flag =
        link[1] === "profileLinks" ? "showInProfile" : "showInSocialComponent";
      const from = ` FROM publication_candidate c,json_each(c.source,'$.links') j WHERE c.id=? AND json_extract(j.value,'$.${flag}')=1`;
      if (link[2] === undefined) {
        const result = await env.DB.prepare(`SELECT count(*) AS count${from}`)
          .bind(row.id)
          .first<{ count: number }>();
        return {
          type: "array",
          length: 0,
          value: null,
          wire: "",
          count: result?.count ?? 0,
        };
      }
      const value =
        link[3] === "label"
          ? "json_extract(j.value,'$.label')"
          : "CASE WHEN json_extract(j.value,'$.kind')='email' THEN 'mailto:' ELSE '' END || json_extract(j.value,'$.value')";
      const result = await env.DB.prepare(
        `WITH value AS (SELECT ${value} AS v${from} ORDER BY j.key LIMIT 1 OFFSET ?) SELECT length(cast(json_quote(v) AS blob))-2 AS length,hex(substr(cast(json_quote(v) AS blob),?+2,min(?,length(cast(json_quote(v) AS blob))-2-?))) AS wire FROM value`,
      )
        .bind(
          row.id,
          Number(link[2]),
          offset ?? 0,
          offset === undefined ? 8192 : 4096,
          offset ?? 0,
        )
        .first<{ length: number; wire: string }>();
      if (!result) throw new Error("Source link unavailable");
      const wire = decodeSqlString(result.wire);
      return {
        type: "text",
        length: result.length,
        wire,
        count: 0,
        value: decode(
          wire,
          (offset ?? 0) + new TextEncoder().encode(wire).byteLength >=
            result.length,
        ),
      };
    }
    const node =
      await env.DB.prepare(`WITH value AS (SELECT json_type(source,?) AS type,json_extract(source,?) AS v FROM publication_candidate WHERE id=?)
 SELECT type,CASE WHEN type='text' THEN length(cast(json_quote(v) AS blob))-2 ELSE 0 END AS length,
 CASE WHEN type='text' THEN hex(substr(cast(json_quote(v) AS blob),?+2,min(?,length(cast(json_quote(v) AS blob))-2-?))) WHEN type IN ('integer','real','true','false') THEN v ELSE NULL END AS value,
 CASE WHEN type='array' THEN json_array_length(v) ELSE 0 END AS count FROM value`)
        .bind(
          path,
          path,
          row.id,
          offset ?? 0,
          offset === undefined ? 8192 : 4096,
          offset ?? 0,
        )
        .first<{
          type: string | null;
          length: number;
          value: string | number | null;
          count: number;
        }>();
    if (!node) throw new Error("Source unavailable");
    const wire =
      node.type === "text" ? decodeSqlString(String(node.value ?? "")) : "";
    return {
      ...node,
      wire,
      value:
        node.type === "text"
          ? decode(
              wire,
              (offset ?? 0) + new TextEncoder().encode(wire).byteLength >=
                node.length,
            )
          : node.value,
    };
  };
  return {
    read,
    async components(path, index) {
      const rows = await env.DB.prepare(
        `WITH RECURSIVE n(i) AS (SELECT cast(? AS INTEGER) UNION ALL SELECT i+1 FROM n WHERE i<?+15), items AS MATERIALIZED (SELECT i,json_extract(c.source,?||'['||i||']') AS v FROM publication_candidate c,n WHERE c.id=? AND i<json_array_length(c.source,?)) SELECT CASE WHEN length(cast(v AS blob))<=4096 AND sum(length(cast(v AS blob))) OVER (ORDER BY i)<=16384 THEN v ELSE NULL END AS value FROM items ORDER BY i`,
      )
        .bind(index, index, path, row.id, path)
        .all<{ value: string | null }>();
      let html = "",
        count = 0,
        bytes = 0;
      for (const item of rows.results) {
        if (item.value === null) break;
        bytes += new TextEncoder().encode(item.value).byteLength;
        if (bytes > 16384 || item.value.length > 4096) break;
        const raw: unknown = JSON.parse(item.value);
        if (
          !withinBounds(raw, {
            maxNodes: 200,
            maxDepth: 24,
            maxString: 2048,
            maxBytes: 8192,
          })
        )
          break;
        const parsed = componentContentSchema.safeParse(raw);
        if (!parsed.success || parsed.data.type === "social-links") break;
        const draft = createEmptyDraft({
          themeId: "leaf",
          fontId: "dm-sans",
          colorMode: "system",
        });
        draft.components = [parsed.data];
        const model = projectPortfolio(draft, {
          assetOrigins: [row.asset_origin],
          resolveAsset: ({ assetId }) => ({
            state: "ready",
            url: `${row.asset_origin}/${root(row.id)}assets/${assetId}`,
          }),
        });
        const result = renderFragment(
          { kind: "component", component: model.components[0] },
          { assetOrigins: [row.asset_origin] },
        );
        if (result.status !== "ready") break;
        html += result.html.replace(/<link rel="preload"[^>]*\/>/g, "");
        count++;
      }
      return { html, count };
    },
    async caseAt(index) {
      const result = await env.DB.prepare(
        `SELECT fullkey AS path,json_extract(value,'$.slug') AS slug FROM publication_candidate c,json_tree(c.source) WHERE c.id=? AND key='caseStudy' ORDER BY json_tree.id LIMIT 1 OFFSET ?`,
      )
        .bind(row.id, index)
        .first<{ path: string; slug: string }>();
      return result
        ? { path: result.path.slice(0, -10), slug: result.slug }
        : null;
    },
    async resumeAt() {
      const result = await env.DB.prepare(
        `SELECT j.key AS idx FROM publication_candidate c,json_each(c.source,'$.components') j WHERE c.id=? AND json_extract(j.value,'$.type')='resume' LIMIT 1`,
      )
        .bind(row.id)
        .first<{ idx: number }>();
      if (!result) return null;
      const count = await env.DB.prepare(
        `SELECT count(*) AS n FROM publication_candidate c,json_tree(c.source) WHERE c.id=? AND key='caseStudy'`,
      )
        .bind(row.id)
        .first<{ n: number }>();
      return {
        path: `$.components[${result.idx}]`,
        ordinal: (count?.n ?? 0) + 1,
      };
    },
    async discover(index) {
      const refs = await env.DB.prepare(
        `SELECT fullkey AS path,atom AS id FROM publication_candidate c,json_tree(c.source) WHERE c.id=? AND key='assetId' ORDER BY fullkey LIMIT 5 OFFSET ?`,
      )
        .bind(row.id, index)
        .all<{ path: string; id: string }>();
      for (const ref of refs.results.slice(0, 4)) {
        const purpose =
          ref.path === "$.profile.avatar.assetId"
            ? "avatar"
            : ref.path === "$.profile.banner.assetId"
              ? "banner"
              : ref.path === "$.profile.faceReveal.image.assetId"
                ? "face"
                : ref.path === "$.seo.ogImage.assetId"
                  ? "og"
                  : ref.path.endsWith(".data.file.assetId")
                    ? "resume"
                    : ref.path.endsWith(".image.assetId")
                      ? "project"
                      : "case_study";
        const asset = await env.DB.prepare(
          `INSERT INTO publication_transfer(candidate_id,asset_id,purpose,bytes,content_type) SELECT c.id,a.id,a.kind,a.bytes,a.content_type FROM publication_candidate c JOIN asset a ON a.portfolio_id=c.portfolio_id WHERE c.id=? AND c.lease_token=? AND c.lease_until>? AND a.id=json_extract(c.source,?) AND a.kind=? AND a.status='ready' AND ${candidateActive.replaceAll("publication_candidate.", "c.")} ON CONFLICT DO NOTHING RETURNING asset_id`,
        )
          .bind(row.id, row.lease_token, Date.now(), ref.path, purpose)
          .first();
        if (
          !asset &&
          !(await env.DB.prepare(
            "SELECT 1 AS ok FROM publication_transfer WHERE candidate_id=? AND asset_id=? AND purpose=?",
          )
            .bind(row.id, ref.id, purpose)
            .first())
        )
          throw new Error("Referenced asset unavailable");
      }
      return refs.results.length > 4;
    },
    async category(path, index) {
      const categories = await read(`${path}.data.categories`);
      if (index > categories.count) return null;
      const id =
        index === categories.count
          ? null
          : String((await read(`${path}.data.categories[${index}].id`)).value);
      const result = await env.DB.prepare(
        `SELECT count(*) AS count FROM publication_candidate c,json_each(c.source,?) e WHERE c.id=? AND json_extract(e.value,'$.categoryId') IS ?`,
      )
        .bind(`${path}.data.entries`, row.id, id)
        .first<{ count: number }>();
      return {
        id,
        count: result?.count ?? 0,
        namePath: `${path}.data.categories[${index}].name`,
      };
    },
    async skill(path, category, index) {
      const result = await env.DB.prepare(
        `SELECT e.key AS idx FROM publication_candidate c,json_each(c.source,?) e WHERE c.id=? AND json_extract(e.value,'$.categoryId') IS ? ORDER BY e.key LIMIT 1 OFFSET ?`,
      )
        .bind(`${path}.data.entries`, row.id, category, index)
        .first<{ idx: number }>();
      return result?.idx ?? null;
    },
    async image(path, purpose, side) {
      const ref = await read(`${path}.assetId`);
      if (!ref.value && purpose === "project") return "";
      const marker = "S8_CONTROLLED_IMAGE_DESCRIPTION";
      const asset = ref.value
        ? {
            state: "ready",
            url: `${row.asset_origin}/${root(row.id)}assets/${ref.value}`,
            alt: marker,
          }
        : { state: "missing" };
      const rendered = renderFragment(
        {
          kind: "asset",
          asset,
          decoration:
            purpose === "avatar"
              ? ((await read("$.profile.decorationId")).value ?? "none")
              : "none",
          usage:
            purpose === "avatar" || purpose === "banner" ? purpose : "image",
        },
        { assetOrigins: [row.asset_origin] },
      );
      if (rendered.status !== "ready")
        throw new Error("Asset renderer envelope");
      const html = rendered.html.replace(/<link rel="preload"[^>]*\/>/g, "");
      if (!ref.value) return side === "open" ? html : "";
      const index = html.indexOf(`alt="${marker}"`) + 5;
      if (index < 5) throw new Error("Image description slot missing");
      return side === "open"
        ? html.slice(0, index)
        : html.slice(index + marker.length);
    },
  };
}
async function assemble(
  env: DispatchEnv,
  row: Candidate,
): Promise<{
  cursor: string;
  outputCount: number;
  status: Candidate["status"];
}> {
  const state = assemblySchema.parse(JSON.parse(row.cursor));
  const end = Math.min(state.count, state.index + 8);
  let bytes = 0;
  for (let i = state.index; i < end; i++) {
    const object = await env.SITES_BUCKET.head(
      chunk(row.id, state.page, state.level, i),
    );
    if (!object) throw new Error("Assembly input missing");
    bytes += object.size;
  }
  const final = end === state.count && state.written === 0;
  const destination = final
    ? `${root(row.id)}pages/${state.page}.html`
    : chunk(row.id, state.page, state.level + 1, state.written);
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  async function* inputs() {
    for (let i = state.index; i < end; i++) {
      const object = await env.SITES_BUCKET.get(
        chunk(row.id, state.page, state.level, i),
      );
      if (!object) throw new Error("Assembly input disappeared");
      const reader = object.body.getReader();
      activeReader = reader;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          yield part.value;
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        activeReader = undefined;
      }
    }
  }
  const iterator = inputs();
  const input = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const part = await iterator.next();
      if (part.done) controller.close();
      else controller.enqueue(part.value);
    },
    async cancel() {
      await activeReader?.cancel().catch(() => {});
      await iterator.return();
    },
  });
  await putBoundedStream(env.SITES_BUCKET, destination, input, bytes);
  const written = state.written + 1;
  if (end === state.count && written === 1) {
    const receipt = await env.DB.prepare(
      `UPDATE publication_page SET ready=1 WHERE candidate_id=? AND ordinal=? AND EXISTS(SELECT 1 FROM publication_candidate WHERE id=? AND lease_token=? AND lease_until>? AND status='assembling' AND ${candidateActive}) RETURNING ordinal`,
    )
      .bind(row.id, state.page, row.id, row.lease_token, Date.now())
      .first();
    if (!receipt) throw new Error("Page assembly fenced");
    const next = await env.DB.prepare(
      "SELECT ordinal,parts FROM publication_page WHERE candidate_id=? AND ordinal>? ORDER BY ordinal LIMIT 1",
    )
      .bind(row.id, state.page)
      .first<{ ordinal: number; parts: number }>();
    return next
      ? {
          cursor: JSON.stringify({
            page: next.ordinal,
            level: 0,
            index: 0,
            count: next.parts,
            written: 0,
          }),
          outputCount: row.output_count,
          status: "assembling",
        }
      : { cursor: "[]", outputCount: row.output_count, status: "transferring" };
  }
  return {
    cursor: JSON.stringify(
      end === state.count
        ? {
            page: state.page,
            level: state.level + 1,
            index: 0,
            count: written,
            written: 0,
          }
        : { ...state, index: end, written },
    ),
    outputCount: row.output_count,
    status: "assembling",
  };
}
async function transfer(
  env: DispatchEnv,
  row: Candidate,
): Promise<{
  cursor: string;
  outputCount: number;
  status: Candidate["status"];
}> {
  const item = await env.DB.prepare(
    "SELECT asset_id,purpose,bytes,content_type FROM publication_transfer WHERE candidate_id=? AND complete=0 ORDER BY asset_id,purpose LIMIT 1",
  )
    .bind(row.id)
    .first<{
      asset_id: string;
      purpose: string;
      bytes: number;
      content_type: string;
    }>();
  if (!item) {
    const incomplete = await env.DB.prepare(
      "SELECT count(*) AS n FROM publication_page WHERE candidate_id=? AND ready=0",
    )
      .bind(row.id)
      .first<{ n: number }>();
    if (incomplete?.n) throw new Error("Candidate page incomplete");
    return {
      cursor: "[]",
      outputCount: row.output_count,
      status: "ready" satisfies Candidate["status"],
    };
  }
  const response = await env.PRIVATE_SOURCE.fetch(
    new Request("https://publication-source.internal/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId: row.id,
        leaseToken: row.lease_token,
        assetId: item.asset_id,
        purpose: item.purpose,
      }),
      signal: AbortSignal.timeout(30_000),
    }),
  );
  if (
    response.status !== 200 ||
    !response.body ||
    Number(response.headers.get("Content-Length")) !== item.bytes
  ) {
    await response.body?.cancel();
    throw new Error("Private source denied or inconsistent");
  }
  const key = `${root(row.id)}assets/${item.asset_id}`;
  await putBoundedStream(
    env.PUBLIC_ASSETS_BUCKET,
    key,
    response.body,
    item.bytes,
    item.content_type,
  );
  const receipt = await env.DB.prepare(
    `UPDATE publication_transfer SET complete=1 WHERE candidate_id=? AND asset_id=? AND purpose=? AND EXISTS(SELECT 1 FROM publication_candidate WHERE id=? AND lease_token=? AND lease_until>? AND status='transferring' AND ${candidateActive}) AND EXISTS(SELECT 1 FROM asset a JOIN publication_candidate c ON c.id=publication_transfer.candidate_id WHERE a.id=publication_transfer.asset_id AND a.portfolio_id=c.portfolio_id AND a.kind=publication_transfer.purpose AND a.status='ready' AND a.bytes=publication_transfer.bytes AND a.content_type=publication_transfer.content_type) RETURNING asset_id`,
  )
    .bind(
      row.id,
      item.asset_id,
      item.purpose,
      row.id,
      row.lease_token,
      Date.now(),
    )
    .first();
  if (!receipt) throw new Error("Transfer fenced after streaming");
  return {
    cursor: "[]",
    outputCount: row.output_count,
    status: "transferring" satisfies Candidate["status"],
  };
}
export async function runPublicationBatch(env: DispatchEnv, id: string) {
  const tasks = publicationTasks(env.DB),
    row = await tasks.claim(id);
  if (!row) return { claimed: false };
  try {
    if (
      row.status !== "cleaning" &&
      row.renderer_version !== PUBLICATION_RENDERER_VERSION
    )
      throw new Error("Unsupported candidate renderer version");
    let pageIndex = row.page_index;
    let next: {
      cursor: string;
      outputCount: number;
      status: Candidate["status"];
    };
    if (row.status === "preparing") {
      const stack = cursorSchema.parse(JSON.parse(row.cursor)),
        source = preparationSource(env, row);
      const batch = z.coerce
        .number()
        .int()
        .min(1)
        .max(32)
        .parse(row.task_batch);
      let html = "",
        count = row.output_count,
        cost = 0,
        commands = 0,
        pageEnded = false,
        outputBytes = 0;
      while (stack.length && commands < 128) {
        const command = stack[stack.length - 1];
        if (command?.kind === "page-start") {
          if (html) break;
          stack.pop();
          pageIndex = command.ordinal;
          count = 0;
          await env.DB.prepare(
            `INSERT INTO publication_page(candidate_id,ordinal,path) SELECT id,?,? FROM publication_candidate WHERE id=? AND lease_token=? AND lease_until>? ON CONFLICT DO NOTHING`,
          )
            .bind(
              command.ordinal,
              command.path,
              row.id,
              row.lease_token,
              Date.now(),
            )
            .run();
          break;
        }
        if (command?.kind === "page-end") {
          stack.pop();
          pageEnded = true;
          break;
        }
        const weight =
          command?.kind === "each" && command.view === "component"
            ? 16
            : command?.kind === "discover"
              ? 9
              : command?.kind === "view"
                ? 10
                : command?.kind === "frame" || command?.kind === "literal"
                  ? 0.25
                  : 1;
        if (cost && cost + weight > batch) break;
        if (outputBytes > 196608) break;
        const part = await advancePreparation(stack, source);
        outputBytes += new TextEncoder().encode(part).byteLength;
        html += part;
        cost += weight;
        commands++;
      }
      if (new TextEncoder().encode(html).byteLength > 262144)
        throw new Error("Batch output exceeded");
      if (html) {
        await env.SITES_BUCKET.put(chunk(row.id, pageIndex, 0, count), html);
        count++;
      }
      if (pageEnded)
        await env.DB.prepare(
          `UPDATE publication_page SET parts=? WHERE candidate_id=? AND ordinal=? AND EXISTS(SELECT 1 FROM publication_candidate WHERE id=? AND lease_token=? AND lease_until>?)`,
        )
          .bind(count, row.id, pageIndex, row.id, row.lease_token, Date.now())
          .run();
      const first = stack.length
        ? null
        : await env.DB.prepare(
            "SELECT parts FROM publication_page WHERE candidate_id=? AND ordinal=0",
          )
            .bind(row.id)
            .first<{ parts: number }>();
      next = stack.length
        ? {
            cursor: JSON.stringify(stack),
            outputCount: count,
            status: "preparing",
          }
        : {
            cursor: JSON.stringify({
              page: 0,
              level: 0,
              index: 0,
              count: first?.parts ?? 0,
              written: 0,
            }),
            outputCount: count,
            status: "assembling",
          };
    } else if (row.status === "assembling") next = await assemble(env, row);
    else if (row.status === "transferring") next = await transfer(env, row);
    else if (row.status === "cleaning") {
      let remaining = false;
      for (const bucket of [env.SITES_BUCKET, env.PUBLIC_ASSETS_BUCKET]) {
        const listing = await bucket.list({ prefix: root(row.id), limit: 16 });
        if (listing.objects.length) {
          await bucket.delete(listing.objects.map((o) => o.key));
          remaining = true;
        }
      }
      if (!remaining)
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE publication_candidate SET source=NULL WHERE id=? AND lease_token=?",
          ).bind(row.id, row.lease_token),
          env.DB.prepare(
            "DELETE FROM publication_transfer WHERE candidate_id=? AND EXISTS(SELECT 1 FROM publication_candidate WHERE id=? AND lease_token=?)",
          ).bind(row.id, row.id, row.lease_token),
          env.DB.prepare(
            "DELETE FROM publication_page WHERE candidate_id=? AND EXISTS(SELECT 1 FROM publication_candidate WHERE id=? AND lease_token=?)",
          ).bind(row.id, row.id, row.lease_token),
          env.DB.prepare(
            "UPDATE publication_candidate SET owner_id='',portfolio_id='' WHERE id=? AND lease_token=? AND NOT EXISTS(SELECT 1 FROM user WHERE id=publication_candidate.owner_id)",
          ).bind(row.id, row.lease_token),
        ]);
      next = {
        cursor: "[]",
        outputCount: 0,
        status: remaining ? "cleaning" : "cleaned",
      };
    } else throw new Error("Unexpected candidate phase");
    const checkpoint = await tasks.checkpoint(row, { ...next, pageIndex });
    if (checkpoint && !["ready", "cleaned"].includes(next.status))
      await env.PUBLICATION_QUEUE.send({ candidateId: id });
    return { claimed: true, checkpoint, status: next.status };
  } catch (error) {
    await tasks.retry(
      row,
      error instanceof Error ? error.message : "task_failed",
    );
    throw error;
  }
}

export async function sweepPublicationTasks(env: DispatchEnv) {
  const tasks = publicationTasks(env.DB),
    now = Date.now();
  const failed = await env.DB.prepare(
    `SELECT id FROM publication_candidate WHERE status='failed' AND coalesce(last_error,'') NOT LIKE 'cleanup:%' AND lease_until<? AND updated_at<? ORDER BY updated_at LIMIT 4`,
  )
    .bind(now - 30000, now - 30000)
    .all<{ id: string }>();
  for (const row of failed.results) await tasks.startCleanup(row.id);
  const tombstones = await env.DB.prepare(
    `SELECT id FROM publication_candidate WHERE status='cleaned' AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 4`,
  )
    .bind(now)
    .all<{ id: string }>();
  for (const row of tombstones.results) {
    let found = false;
    for (const bucket of [env.SITES_BUCKET, env.PUBLIC_ASSETS_BUCKET])
      if (
        (await bucket.list({ prefix: root(row.id), limit: 1 })).objects.length
      )
        found = true;
    await env.DB.prepare(
      `UPDATE publication_candidate SET status=?,deadline_at=?,next_attempt_at=?,updated_at=? WHERE id=? AND status='cleaned'`,
    )
      .bind(
        found ? "cleaning" : "cleaned",
        now + 3600000,
        found ? now : now + 3600000,
        now,
        row.id,
      )
      .run();
  }
  return {
    woken: await tasks.sweep(env.PUBLICATION_QUEUE),
    tombstones: tombstones.results.length,
  };
}
