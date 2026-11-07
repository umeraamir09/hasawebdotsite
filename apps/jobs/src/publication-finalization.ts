import { Buffer } from "node:buffer";
import { appearanceModelSchema, fontFileName } from "@hasaweb/components";
import { type Candidate, candidateActive } from "@hasaweb/db";
import {
  documentShell,
  PAGE_UNAVAILABLE_HTML,
  portfolioDocumentFrame,
} from "@hasaweb/render";
import { z } from "zod";
import type { DispatchEnv } from "./publication-dispatch";
import { putBoundedStream } from "./publication-stream";

const platformFile = z.strictObject({
  path: z
    .string()
    .regex(
      /^\/(platform|portfolio-platform)\/[a-f0-9]{16,64}[a-z0-9._-]*\.(css|js|ttf|webp)$/,
    ),
  bytes: z.number().int().positive().max(1_048_576),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.enum([
    "text/css; charset=utf-8",
    "text/javascript; charset=utf-8",
    "font/ttf",
    "image/webp",
  ]),
  role: z.enum(["css", "script", "font", "cat"]),
});
const packSchema = z.strictObject({
  files: z.array(platformFile).min(3).max(8),
});
const receiptSchema = z.strictObject({
  bucket: z.enum(["sites", "assets"]),
  key: z.string().max(512),
  path: z.string().max(256),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.string().max(128),
});
export const candidateManifestSchema = z.strictObject({
  format: z.literal("hasaweb-candidate-v1"),
  candidateId: z.string().uuid(),
  sourceRevision: z.number().int().nonnegative(),
  rendererVersion: z.string(),
  files: z.array(receiptSchema).max(8192),
});
const cursorSchema = z.discriminatedUnion("stage", [
  z.object({
    stage: z.literal("platform"),
    index: z.number().int().nonnegative(),
  }),
  z.object({
    stage: z.enum(["snapshot", "manifest", "sitemap"]),
    index: z.number().int().nonnegative(),
  }),
  z.object({
    stage: z.enum([
      "snapshot-assembly",
      "manifest-assembly",
      "sitemap-assembly",
    ]),
    level: z.number().int().nonnegative(),
    count: z.number().int().positive(),
    index: z.number().int().nonnegative(),
    written: z.number().int().nonnegative(),
  }),
  z.object({
    stage: z.literal("pages"),
    index: z.number().int().nonnegative(),
  }),
  z.object({
    stage: z.literal("assets"),
    index: z.number().int().nonnegative(),
  }),
  z.object({ stage: z.literal("seal") }),
]);
const prefix = (row: Candidate) => `candidate/${row.id}/`;
const snapshotPart = (
  row: Candidate,
  level: number,
  index: number,
  kind = "snapshot",
) => `${prefix(row)}${kind}-parts/${level}/${index}`;
const hex = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("hex");

async function digest(object: R2ObjectBody) {
  const stream = new crypto.DigestStream("SHA-256");
  await object.body.pipeTo(stream);
  return hex(await stream.digest);
}
async function receipt(
  env: DispatchEnv,
  row: Candidate,
  file: z.infer<typeof receiptSchema>,
) {
  const result = await env.DB.prepare(
    `UPDATE publication_candidate_index SET value=json_set(value,'$.receipts',json_insert(coalesce(json_extract(value,'$.receipts'),'[]'),'$[#]',json(?))) WHERE candidate_id=? AND NOT EXISTS(SELECT 1 FROM json_each(value,'$.receipts') r WHERE json_extract(r.value,'$.key')=?) AND EXISTS(SELECT 1 FROM publication_candidate WHERE id=? AND lease_token=? AND lease_until>? AND status='transferring' AND ${candidateActive}) RETURNING candidate_id`,
  )
    .bind(
      JSON.stringify(file),
      row.id,
      file.key,
      row.id,
      row.lease_token,
      Date.now(),
    )
    .first();
  if (!result) {
    const exists = await env.DB.prepare(
      `SELECT 1 FROM publication_candidate_index,json_each(value,'$.receipts') r WHERE candidate_id=? AND json_extract(r.value,'$.key')=? AND r.value=json(?)`,
    )
      .bind(row.id, file.key, JSON.stringify(file))
      .first();
    if (!exists) throw new Error("Candidate receipt fenced or changed");
  }
}
async function recordObject(
  env: DispatchEnv,
  row: Candidate,
  bucket: "sites" | "assets",
  key: string,
  path: string,
  contentType: string,
) {
  const object = await (bucket === "sites"
    ? env.SITES_BUCKET
    : env.PUBLIC_ASSETS_BUCKET
  ).get(key);
  if (!object) throw new Error("Candidate output missing");
  await receipt(env, row, {
    bucket,
    key,
    path,
    bytes: object.size,
    sha256: await digest(object),
    contentType,
  });
}

export async function finalizePublication(
  env: DispatchEnv,
  row: Candidate,
  copy: (
    keys: string[],
    destination: string,
    shell?: { open: string; close: string },
  ) => Promise<void>,
) {
  const root = prefix(row);
  const raw: unknown = JSON.parse(row.cursor);
  let cursor = Array.isArray(raw)
    ? { stage: "platform" as const, index: 0 }
    : cursorSchema.parse(raw);
  let ready = false;
  if (cursor.stage === "platform") {
    let packed = await env.DB.prepare(
      "SELECT json_extract(value,'$.platform') AS pack FROM publication_candidate_index WHERE candidate_id=?",
    )
      .bind(row.id)
      .first<{ pack: string | null }>();
    if (!packed?.pack) {
      const response = await env.PLATFORM_ASSETS.fetch(
        "https://platform.internal/manifest.json",
      );
      if (!response.ok || Number(response.headers.get("Content-Length")) > 8192)
        throw new Error("Platform pack unavailable");
      const pack = packSchema.parse(await response.json());
      const selected = await env.DB.prepare(
        "SELECT json_extract(source,'$.profile.decorationId') AS decoration,json_extract(source,'$.appearance.fontId') AS font FROM publication_candidate WHERE id=?",
      )
        .bind(row.id)
        .first<{ decoration: string | null; font: string | null }>();
      // Only the saved font and decoration art are retained with a version.
      // The stylesheet declares every approved face, but a browser fetches
      // only the family that the page's data-font selects.
      const font = fontFileName(selected?.font ?? "");
      pack.files = pack.files.filter(
        (file) =>
          (file.role !== "cat" || selected?.decoration === "cat") &&
          (file.role !== "font" ||
            (font !== undefined && file.path.endsWith(`-${font}`))),
      );
      if (
        ["css", "script", "font"].some(
          (role) =>
            pack.files.filter((file) => file.role === role).length !== 1,
        )
      )
        throw new Error("Incomplete platform pack");
      const result = await env.DB.prepare(
        `UPDATE publication_candidate_index SET value=json_set(value,'$.platform',json(?)) WHERE candidate_id=? AND EXISTS(SELECT 1 FROM publication_candidate WHERE id=? AND lease_token=? AND lease_until>? AND ${candidateActive}) RETURNING candidate_id`,
      )
        .bind(JSON.stringify(pack), row.id, row.id, row.lease_token, Date.now())
        .first();
      if (!result) throw new Error("Platform capture fenced");
      packed = { pack: JSON.stringify(pack) };
    }
    const pack = packSchema.parse(JSON.parse(packed.pack ?? "null"));
    const file = pack.files[cursor.index];
    if (file) {
      const response = await env.PLATFORM_ASSETS.fetch(
        `https://platform.internal${file.path}`,
      );
      if (!response.ok || !response.body)
        throw new Error("Retained platform input missing");
      const key = `${root}${file.path.slice(1)}`;
      await putBoundedStream(
        env.PUBLIC_ASSETS_BUCKET,
        key,
        response.body,
        file.bytes,
        file.contentType,
      );
      const output = await env.PUBLIC_ASSETS_BUCKET.get(key);
      if (!output || (await digest(output)) !== file.sha256)
        throw new Error("Platform content hash mismatch");
      await receipt(env, row, {
        bucket: "assets",
        key,
        path: file.path,
        bytes: file.bytes,
        sha256: file.sha256,
        contentType: file.contentType,
      });
      cursor = { stage: "platform", index: cursor.index + 1 };
    } else cursor = { stage: "snapshot", index: 0 };
  } else if (
    cursor.stage === "snapshot" ||
    cursor.stage === "manifest" ||
    cursor.stage === "sitemap"
  ) {
    const kind = cursor.stage,
      size = 32768;
    const value =
      kind === "snapshot"
        ? "source"
        : kind === "sitemap"
          ? `'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'||(SELECT group_concat('<url><loc>https://'||json_extract(c.facts,'$.address.name')||'.hasaweb.site'||path||'</loc></url>','') FROM (SELECT path FROM publication_page WHERE candidate_id=c.id ORDER BY ordinal))||'</urlset>'`
          : "json_object('format','hasaweb-candidate-v1','candidateId',c.id,'sourceRevision',c.source_revision,'rendererVersion',c.renderer_version,'files',json(json_extract(x.value,'$.receipts')))";
    const part = await env.DB.prepare(
      `WITH body AS (SELECT ${value} AS value FROM publication_candidate c JOIN publication_candidate_index x ON x.candidate_id=c.id WHERE c.id=?) SELECT length(cast(value AS blob)) AS bytes,hex(substr(cast(value AS blob),?,?)) AS data FROM body`,
    )
      .bind(row.id, cursor.index * size + 1, size)
      .first<{ bytes: number; data: string }>();
    if (!part?.data) throw new Error("Candidate JSON input missing");
    await env.SITES_BUCKET.put(
      snapshotPart(row, 0, cursor.index, kind),
      Buffer.from(part.data, "hex"),
    );
    cursor =
      (cursor.index + 1) * size < part.bytes
        ? { stage: kind, index: cursor.index + 1 }
        : {
            stage:
              kind === "snapshot"
                ? "snapshot-assembly"
                : kind === "sitemap"
                  ? "sitemap-assembly"
                  : "manifest-assembly",
            level: 0,
            count: cursor.index + 1,
            index: 0,
            written: 0,
          };
  } else if (
    cursor.stage === "snapshot-assembly" ||
    cursor.stage === "manifest-assembly" ||
    cursor.stage === "sitemap-assembly"
  ) {
    const state = cursor,
      kind =
        state.stage === "snapshot-assembly"
          ? "snapshot"
          : state.stage === "sitemap-assembly"
            ? "sitemap"
            : "manifest";
    const end = Math.min(state.count, state.index + 16),
      final = end === state.count && state.written === 0;
    const key = `${root}${kind}.${kind === "sitemap" ? "xml" : "json"}`;
    await copy(
      Array.from({ length: end - state.index }, (_, i) =>
        snapshotPart(row, state.level, state.index + i, kind),
      ),
      final ? key : snapshotPart(row, state.level + 1, state.written, kind),
    );
    if (final) {
      if (kind === "snapshot")
        await recordObject(
          env,
          row,
          "sites",
          key,
          "snapshot.json",
          "application/json",
        );
      else if (kind === "sitemap") {
        await recordObject(
          env,
          row,
          "sites",
          key,
          "/sitemap.xml",
          "application/xml",
        );
      } else {
        const output = await env.SITES_BUCKET.get(key);
        if (!output) throw new Error("Candidate manifest missing");
        const result = await env.DB.prepare(
          `UPDATE publication_candidate_index SET value=json_set(value,'$.manifest',json(?)) WHERE candidate_id=? AND EXISTS(SELECT 1 FROM publication_candidate WHERE id=? AND lease_token=? AND lease_until>? AND ${candidateActive}) RETURNING candidate_id`,
        )
          .bind(
            JSON.stringify({
              key,
              bytes: output.size,
              sha256: await digest(output),
            }),
            row.id,
            row.id,
            row.lease_token,
            Date.now(),
          )
          .first();
        if (!result) throw new Error("Manifest seal fenced");
      }
      cursor =
        kind === "snapshot"
          ? { stage: "pages", index: 0 }
          : kind === "sitemap"
            ? { stage: "assets", index: 0 }
            : { stage: "seal" };
    } else if (end === state.count)
      cursor = {
        ...state,
        level: state.level + 1,
        count: state.written + 1,
        index: 0,
        written: 0,
      };
    else cursor = { ...state, index: end, written: state.written + 1 };
  } else if (cursor.stage === "pages") {
    const page = await env.DB.prepare(
      "SELECT ordinal,path FROM publication_page WHERE candidate_id=? ORDER BY ordinal LIMIT 1 OFFSET ?",
    )
      .bind(row.id, cursor.index)
      .first<{ ordinal: number; path: string }>();
    if (page) {
      // The sealed source's appearance applies to every page of this version.
      // Publication validation already checked catalog membership; the strict
      // parse fails the candidate rather than publish a different appearance.
      const packed = await env.DB.prepare(
        "SELECT json_extract(x.value,'$.platform') AS pack,json_object('themeId',json_extract(c.source,'$.appearance.themeId'),'fontId',json_extract(c.source,'$.appearance.fontId'),'colorMode',json_extract(c.source,'$.appearance.colorMode')) AS appearance FROM publication_candidate_index x JOIN publication_candidate c ON c.id=x.candidate_id WHERE x.candidate_id=?",
      )
        .bind(row.id)
        .first<{ pack: string; appearance: string }>();
      const files = packSchema.parse(JSON.parse(packed?.pack ?? "null")).files;
      const appearance = appearanceModelSchema.parse(
        JSON.parse(packed?.appearance ?? "null"),
      );
      const css = files.find((file) => file.role === "css"),
        script = files.find((file) => file.role === "script");
      if (!css || !script) throw new Error("Candidate platform incomplete");
      const marker = "HASA_CONTROLLED_DOCUMENT_BODY";
      const frame = portfolioDocumentFrame();
      const shell = documentShell({
        markup: frame.open + marker + frame.close,
        title: "Portfolio",
        context: "public",
        assets: { cssUrl: css.path, scriptUrl: script.path },
        appearance,
      });
      // Resource paths remain rooted for Phase 25's manifest-authorized serving.
      const [open, close] = shell.split(marker);
      if (!open || !close) throw new Error("Document shell missing");
      const destination = `${root}documents/${page.ordinal}.html`;
      await copy([`${root}pages/${page.ordinal}.html`], destination, {
        open,
        close,
      });
      await recordObject(
        env,
        row,
        "sites",
        destination,
        page.path,
        "text/html; charset=utf-8",
      );
      cursor = { stage: "pages", index: cursor.index + 1 };
    } else {
      await env.SITES_BUCKET.put(`${root}404.html`, PAGE_UNAVAILABLE_HTML);
      await recordObject(
        env,
        row,
        "sites",
        `${root}404.html`,
        "/404",
        "text/html; charset=utf-8",
      );
      await env.SITES_BUCKET.put(
        `${root}robots.txt`,
        "User-agent: *\nAllow: /\n",
      );
      await recordObject(
        env,
        row,
        "sites",
        `${root}robots.txt`,
        "/robots.txt",
        "text/plain; charset=utf-8",
      );
      cursor = { stage: "sitemap", index: 0 };
    }
  } else if (cursor.stage === "assets") {
    const item = await env.DB.prepare(
      "SELECT asset_id,content_type FROM publication_transfer WHERE candidate_id=? AND complete=1 ORDER BY asset_id,purpose LIMIT 1 OFFSET ?",
    )
      .bind(row.id, cursor.index)
      .first<{ asset_id: string; content_type: string }>();
    if (item) {
      await recordObject(
        env,
        row,
        "assets",
        `${root}assets/${item.asset_id}`,
        `/assets/${item.asset_id}`,
        item.content_type,
      );
      cursor = { stage: "assets", index: cursor.index + 1 };
    } else cursor = { stage: "manifest", index: 0 };
  } else {
    const complete = await env.DB.prepare(
      `SELECT 1 AS ok FROM publication_candidate_index x WHERE candidate_id=? AND json_type(value,'$.manifest')='object' AND json_array_length(value,'$.receipts')=(SELECT count(*) FROM publication_page WHERE candidate_id=x.candidate_id AND ready=1)+4+(SELECT count(*) FROM publication_transfer WHERE candidate_id=x.candidate_id AND complete=1)+json_array_length(value,'$.platform.files')`,
    )
      .bind(row.id)
      .first();
    if (!complete) throw new Error("Candidate manifest incomplete");
    ready = true;
  }
  return {
    cursor: JSON.stringify(cursor),
    outputCount: row.output_count,
    status: ready ? ("ready" as const) : ("transferring" as const),
  };
}
