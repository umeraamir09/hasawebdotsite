import {
  type ComponentModel,
  projectPortfolio,
  withinBounds,
} from "@hasaweb/components/model";
import {
  type Candidate,
  candidateActive,
  PUBLICATION_RENDERER_VERSION,
  PUBLICATION_TOMBSTONE_MS,
  preparePublicationIndex,
  publicationTasks,
  type Wake,
} from "@hasaweb/db";
import { renderFragment } from "@hasaweb/render";
import {
  componentContentSchema,
  createEmptyDraft,
  idSchema,
} from "@hasaweb/schema";
import { z } from "zod";
import { finalizePublication } from "./publication-finalization";
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
  PLATFORM_ASSETS: Fetcher;
  PUBLICATION_QUEUE: Queue<Wake>;
  ASSET_ORIGIN: string;
  PUBLICATION_TASK_BATCH?: string;
};
const root = (id: string) => `candidate/${id}/`;
// Resume PDFs download from the asset URL and embed from its /view variant.
const publicAsset = (
  origin: string,
  candidateId: string,
  assetId: string,
  purpose: string,
) => {
  const url = `${origin}/${root(candidateId)}assets/${assetId}`;
  return {
    state: "ready" as const,
    url,
    ...(purpose === "resume" ? { viewUrl: `${url}/view` } : {}),
  };
};
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
  let textWindow:
    | { path: string; offset: number; length: number; hex: string }
    | undefined;
  const read = async (path: string, offset?: number): Promise<SourceNode> => {
    if (path.length > 4096 || (offset ?? 0) < 0)
      throw new Error("Source path envelope");
    if (
      offset !== undefined &&
      textWindow?.path === path &&
      offset >= textWindow.offset
    ) {
      const relative = offset - textWindow.offset;
      const available = textWindow.hex.length / 2 - relative;
      if (
        available >= 4096 ||
        (available > 0 && offset + available >= textWindow.length)
      ) {
        const wire = decodeSqlString(
          textWindow.hex.slice(relative * 2, relative * 2 + 8192),
        );
        return {
          type: "text",
          length: textWindow.length,
          value: null,
          wire,
          count: 0,
        };
      }
    }
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
          offset === undefined ? 8192 : 32768,
          offset ?? 0,
        )
        .first<{ length: number; wire: string }>();
      if (!result) throw new Error("Source link unavailable");
      if (offset !== undefined)
        textWindow = { path, offset, length: result.length, hex: result.wire };
      const wire = decodeSqlString(
        offset === undefined ? result.wire : result.wire.slice(0, 8192),
      );
      return {
        type: "text",
        length: result.length,
        wire,
        count: 0,
        value:
          offset === undefined
            ? decode(
                wire,
                (offset ?? 0) + new TextEncoder().encode(wire).byteLength >=
                  result.length,
              )
            : null,
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
          offset === undefined ? 8192 : 32768,
          offset ?? 0,
        )
        .first<{
          type: string | null;
          length: number;
          value: string | number | null;
          count: number;
        }>();
    if (!node) throw new Error("Source unavailable");
    const hex = String(node.value ?? "");
    if (node.type === "text" && offset !== undefined)
      textWindow = { path, offset, length: node.length, hex };
    const wire =
      node.type === "text"
        ? decodeSqlString(offset === undefined ? hex : hex.slice(0, 8192))
        : "";
    return {
      ...node,
      wire,
      value:
        node.type === "text" && offset === undefined
          ? decode(
              wire,
              (offset ?? 0) + new TextEncoder().encode(wire).byteLength >=
                node.length,
            )
          : node.type === "text"
            ? null
            : node.value,
    };
  };
  return {
    read,
    async project(path) {
      const item = await env.DB.prepare(
        "SELECT CASE WHEN length(cast(json_extract(source,?) AS blob))<=4096 THEN json_extract(source,?) ELSE NULL END AS value FROM publication_candidate WHERE id=?",
      )
        .bind(path, path, row.id)
        .first<{ value: string | null }>();
      if (!item?.value) return null;
      const raw: unknown = JSON.parse(item.value);
      if (
        !withinBounds(raw, {
          maxNodes: 150,
          maxDepth: 24,
          maxString: 2048,
          maxBytes: 8192,
        })
      )
        return null;
      const parsed = componentContentSchema.safeParse({
        id: "entry",
        type: "projects",
        version: 1,
        data: { entries: [raw] },
      });
      if (!parsed.success) return null;
      const draft = createEmptyDraft({
        themeId: "leaf",
        fontId: "dm-sans",
        colorMode: "system",
      });
      draft.components = [parsed.data];
      const component = projectPortfolio(draft, {
        assetOrigins: [row.asset_origin],
        resolveAsset: ({ assetId, purpose }) =>
          publicAsset(row.asset_origin, row.id, assetId, purpose),
      }).components[0];
      if (component?.type !== "projects" || !component.data.entries[0])
        return null;
      const result = renderFragment(
        { kind: "project", entry: component.data.entries[0] },
        { assetOrigins: [row.asset_origin] },
      );
      return result.status === "ready"
        ? result.html.replace(/<link rel="preload"[^>]*\/>/g, "")
        : null;
    },
    async components(path, index) {
      const rows = await env.DB.prepare(
        `WITH RECURSIVE n(i) AS (SELECT cast(? AS INTEGER) UNION ALL SELECT i+1 FROM n WHERE i<?+31), items AS MATERIALIZED (SELECT i,json_extract(c.source,?||'['||i||']') AS v FROM publication_candidate c,n WHERE c.id=? AND i<json_array_length(c.source,?)) SELECT CASE WHEN length(cast(v AS blob))<=4096 AND sum(length(cast(v AS blob))) OVER (ORDER BY i)<=16384 THEN v ELSE NULL END AS value FROM items ORDER BY i`,
      )
        .bind(index, index, path, row.id, path)
        .all<{ value: string | null }>();
      const draft = createEmptyDraft({
        themeId: "leaf",
        fontId: "dm-sans",
        colorMode: "system",
      });
      let bytes = 0;
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
        draft.components.push(parsed.data);
      }
      const model = projectPortfolio(draft, {
        assetOrigins: [row.asset_origin],
        resolveAsset: ({ assetId, purpose }) =>
          publicAsset(row.asset_origin, row.id, assetId, purpose),
        // A snapshot never holds counts. The page asks the graph endpoint.
        graph: "live",
        contact: "live",
      });
      const render = (
        components: ComponentModel[],
      ): { html: string; count: number } => {
        if (!components.length) return { html: "", count: 0 };
        const result = renderFragment(
          { kind: "components", components },
          { assetOrigins: [row.asset_origin] },
        );
        if (result.status === "ready")
          return {
            html: result.html.replace(/<link rel="preload"[^>]*\/>/g, ""),
            count: components.length,
          };
        if (components.length === 1) return { html: "", count: 0 };
        const middle = Math.ceil(components.length / 2);
        const left = render(components.slice(0, middle));
        if (left.count < middle) return left;
        const right = render(components.slice(middle));
        return {
          html: left.html + right.html,
          count: left.count + right.count,
        };
      };
      const { html, count } = render(model.components);
      return { html, count };
    },
    async caseAt(index) {
      return env.DB.prepare(
        "SELECT json_extract(value,?||'.path') AS path,json_extract(value,?||'.slug') AS slug FROM publication_candidate_index WHERE candidate_id=? AND json_type(value,?)='object'",
      )
        .bind(
          `$.cases[${index}]`,
          `$.cases[${index}]`,
          row.id,
          `$.cases[${index}]`,
        )
        .first<{ path: string; slug: string }>();
    },
    async resumeAt() {
      return env.DB.prepare(
        "SELECT json_extract(value,'$.resume.path') AS path,json_extract(value,'$.resume.ordinal') AS ordinal FROM publication_candidate_index WHERE candidate_id=? AND json_type(value,'$.resume')='object'",
      )
        .bind(row.id)
        .first<{ path: string; ordinal: number }>();
    },
    async resume(path, variant) {
      const id = idSchema.parse((await read(`${path}.id`)).value);
      const assetId = (await read(`${path}.data.file.assetId`)).value;
      const url =
        typeof assetId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(assetId)
          ? `${row.asset_origin}/${root(row.id)}assets/${assetId}`
          : null;
      const file = url
        ? { state: "ready" as const, url, viewUrl: `${url}/view` }
        : { state: "missing" as const };
      const rendered = renderFragment(
        variant === "page"
          ? { kind: "resume-page", file }
          : {
              kind: "component",
              component: { id, type: "resume", data: { file } },
            },
        { assetOrigins: [row.asset_origin] },
      );
      if (rendered.status !== "ready")
        throw new Error("Resume renderer envelope");
      return rendered.html;
    },
    async discover(index) {
      if (index === 0) await preparePublicationIndex(env.DB, row);
      const refs = await env.DB.prepare(
        `WITH RECURSIVE n(i) AS (SELECT cast(? AS INTEGER) UNION ALL SELECT i+1 FROM n WHERE i<?+4)
        SELECT i,json_extract(value,'$.assets['||i||'].id') AS id,json_extract(value,'$.assets['||i||'].purpose') AS purpose
        FROM publication_candidate_index,n WHERE candidate_id=? AND i<json_array_length(value,'$.assets') ORDER BY i`,
      )
        .bind(index, index, row.id)
        .all<{ i: number; id: string; purpose: string }>();
      for (const ref of refs.results.slice(0, 4)) {
        const asset = await env.DB.prepare(
          `INSERT INTO publication_transfer(candidate_id,asset_id,purpose,bytes,content_type) SELECT c.id,a.id,a.kind,a.bytes,a.content_type FROM publication_candidate c JOIN asset a ON a.portfolio_id=c.portfolio_id JOIN publication_candidate_index x ON x.candidate_id=c.id WHERE c.id=? AND c.lease_token=? AND c.lease_until>? AND a.id=json_extract(x.value,?) AND a.kind=? AND a.status='ready' AND ${candidateActive.replaceAll("publication_candidate.", "c.")} ON CONFLICT DO NOTHING RETURNING asset_id`,
        )
          .bind(
            row.id,
            row.lease_token,
            Date.now(),
            `$.assets[${ref.i}].id`,
            ref.purpose,
          )
          .first();
        if (
          !asset &&
          !(await env.DB.prepare(
            "SELECT 1 AS ok FROM publication_transfer WHERE candidate_id=? AND asset_id=? AND purpose=?",
          )
            .bind(row.id, ref.id, ref.purpose)
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
      const faceMarker = "S8_CONTROLLED_FACE_DESCRIPTION";
      const url = (id: unknown) =>
        `${row.asset_origin}/${root(row.id)}assets/${id}`;
      const asset = ref.value
        ? { state: "ready", url: url(ref.value), alt: marker }
        : { state: "missing" };
      // The enabled Face Reveal photo shares the avatar markup. Its
      // description streams between the avatar's ("face") and the end.
      const face =
        purpose === "avatar" ? await faceRevealAsset(read) : undefined;
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
          ...(face
            ? {
                faceReveal: { state: "ready", url: url(face), alt: faceMarker },
              }
            : {}),
        },
        { assetOrigins: [row.asset_origin] },
      );
      if (rendered.status !== "ready")
        throw new Error("Asset renderer envelope");
      const html = rendered.html.replace(/<link rel="preload"[^>]*\/>/g, "");
      if (!ref.value) {
        if (face) throw new Error("Face Reveal requires the avatar");
        return side === "open" ? html : "";
      }
      const index = html.indexOf(`alt="${marker}"`) + 5;
      if (index < 5) throw new Error("Image description slot missing");
      const faceIndex = face ? html.indexOf(`alt="${faceMarker}"`) + 5 : -1;
      if (face && faceIndex < index)
        throw new Error("Face description slot missing");
      if (side === "open") return html.slice(0, index);
      if (side === "face") {
        if (!face) throw new Error("Face Reveal photo is not enabled");
        return html.slice(index + marker.length, faceIndex);
      }
      return face
        ? html.slice(faceIndex + faceMarker.length)
        : html.slice(index + marker.length);
    },
  };
}
// The Face Reveal photo's asset ID when the candidate enables it. Candidate
// sources omit a disabled photo; the enabled flag is checked as well.
async function faceRevealAsset(
  read: (path: string) => Promise<SourceNode>,
): Promise<string | undefined> {
  if ((await read("$.profile.faceReveal.enabled")).type !== "true") return;
  const id = (await read("$.profile.faceReveal.image.assetId")).value;
  return typeof id === "string" && id ? id : undefined;
}
async function copyParts(
  env: DispatchEnv,
  keys: string[],
  destination: string,
  shell?: { open: string; close: string },
) {
  const encoder = new TextEncoder();
  let bytes = shell ? encoder.encode(shell.open + shell.close).byteLength : 0;
  for (const key of keys) {
    const object = await env.SITES_BUCKET.head(key);
    if (!object) throw new Error("Assembly input missing");
    bytes += object.size;
  }
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  async function* inputs() {
    if (shell) yield encoder.encode(shell.open);
    for (const key of keys) {
      const object = await env.SITES_BUCKET.get(key);
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
    if (shell) yield encoder.encode(shell.close);
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
  await putBoundedStream(
    env.SITES_BUCKET,
    destination,
    input,
    bytes,
    destination.endsWith(".json")
      ? "application/json"
      : destination.endsWith(".xml")
        ? "application/xml"
        : "text/html; charset=utf-8",
  );
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
  const end = Math.min(state.count, state.index + 16);
  const final = end === state.count && state.written === 0;
  const destination = final
    ? `${root(row.id)}pages/${state.page}.html`
    : chunk(row.id, state.page, state.level + 1, state.written);
  await copyParts(
    env,
    Array.from({ length: end - state.index }, (_, i) =>
      chunk(row.id, state.page, state.level, state.index + i),
    ),
    destination,
  );
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
    return finalizePublication(env, row, (keys, destination, shell) =>
      copyParts(env, keys, destination, shell),
    );
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
        profileEnded = false,
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
        if (command?.kind === "profile-end") {
          stack.pop();
          profileEnded = true;
          break;
        }
        if (
          command?.kind === "view" &&
          command.view === "profile" &&
          pageIndex > 0
        ) {
          if (html) break;
          const cached = await env.DB.prepare(
            "SELECT json_extract(value,'$.profileParts') AS parts FROM publication_candidate_index WHERE candidate_id=?",
          )
            .bind(row.id)
            .first<{ parts: number }>();
          if (!cached?.parts) throw new Error("Prepared profile missing");
          stack.pop();
          stack.push({ kind: "reuse-profile", index: 0, count: cached.parts });
          continue;
        }
        if (command?.kind === "reuse-profile") {
          if (html) break;
          const end = Math.min(command.count, command.index + 16);
          await copyParts(
            env,
            Array.from({ length: end - command.index }, (_, i) =>
              chunk(row.id, 0, 0, command.index + i),
            ),
            chunk(row.id, pageIndex, 0, count),
          );
          count++;
          stack.pop();
          if (end < command.count) stack.push({ ...command, index: end });
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
      if (profileEnded) {
        const receipt = await env.DB.prepare(
          `UPDATE publication_candidate_index SET value=json_set(value,'$.profileParts',?) WHERE candidate_id=? AND EXISTS(SELECT 1 FROM publication_candidate WHERE id=? AND sequence=? AND lease_token=? AND lease_until>? AND status='preparing' AND ${candidateActive}) RETURNING candidate_id`,
        )
          .bind(
            count,
            row.id,
            row.id,
            row.sequence,
            row.lease_token,
            Date.now(),
          )
          .first();
        if (!receipt) throw new Error("Profile preparation fenced");
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
      if (!remaining) {
        const guard =
          "id=? AND sequence=? AND lease_token=? AND lease_until>? AND status='cleaning'";
        const values = [row.id, row.sequence, row.lease_token, Date.now()];
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE publication_candidate SET source=NULL,facts=NULL,owner_id='',portfolio_id='' WHERE ${guard}`,
          ).bind(...values),
          ...[
            "publication_transfer",
            "publication_candidate_index",
            "publication_page",
          ].map((table) =>
            env.DB.prepare(
              `DELETE FROM ${table} WHERE candidate_id=? AND EXISTS(SELECT 1 FROM publication_candidate WHERE ${guard})`,
            ).bind(row.id, ...values),
          ),
        ]);
      }
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
  const exhausted = await env.DB.prepare(
    "SELECT id FROM publication_candidate WHERE status='failed' AND last_error LIKE 'cleanup:%' AND source IS NOT NULL AND lease_until<=? LIMIT 4",
  )
    .bind(now)
    .all<{ id: string }>();
  for (const row of exhausted.results) {
    const guard =
      "id=? AND status='failed' AND last_error LIKE 'cleanup:%' AND lease_until<=?";
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE publication_candidate SET source=NULL,facts=NULL,owner_id='',portfolio_id='',last_error='cleanup:exhausted' WHERE ${guard}`,
      ).bind(row.id, now),
      ...[
        "publication_transfer",
        "publication_candidate_index",
        "publication_page",
      ].map((table) =>
        env.DB.prepare(
          `DELETE FROM ${table} WHERE candidate_id=? AND EXISTS(SELECT 1 FROM publication_candidate WHERE ${guard})`,
        ).bind(row.id, row.id, now),
      ),
    ]);
  }
  const failed = await env.DB.prepare(
    `SELECT id FROM publication_candidate WHERE status='failed' AND coalesce(last_error,'') NOT LIKE 'cleanup:%' AND lease_until<? AND updated_at<? ORDER BY updated_at LIMIT 4`,
  )
    .bind(now - 30000, now - 30000)
    .all<{ id: string }>();
  for (const row of failed.results) await tasks.startCleanup(row.id);
  const tombstones = await env.DB.prepare(
    `SELECT id,coalesce(cleaned_at,updated_at) AS cleaned_at FROM publication_candidate WHERE status='cleaned' AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 4`,
  )
    .bind(now)
    .all<{ id: string; cleaned_at: number }>();
  for (const row of tombstones.results) {
    let found = false;
    for (const bucket of [env.SITES_BUCKET, env.PUBLIC_ASSETS_BUCKET])
      if (
        (await bucket.list({ prefix: root(row.id), limit: 1 })).objects.length
      )
        found = true;
    if (!found && row.cleaned_at <= now - PUBLICATION_TOMBSTONE_MS) {
      await env.DB.prepare(
        "DELETE FROM publication_candidate WHERE id=? AND status='cleaned' AND lease_until<=?",
      )
        .bind(row.id, now)
        .run();
      continue;
    }
    await env.DB.prepare(
      `UPDATE publication_candidate SET status=?,cleaned_at=coalesce(cleaned_at,?),attempts=0,deadline_at=?,next_attempt_at=?,updated_at=? WHERE id=? AND status='cleaned'`,
    )
      .bind(
        found ? "cleaning" : "cleaned",
        row.cleaned_at,
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
