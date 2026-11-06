import {
  portfolioHeaders,
  unavailableResponse,
} from "@hasaweb/render/response-policy";

export type PublicEnv = {
  DB: D1Database;
  SITES_BUCKET: R2Bucket;
  PUBLIC_ASSETS_BUCKET: R2Bucket;
  ASSET_ORIGIN?: string;
};

const SITE_SUFFIX = ".hasaweb.site";
const RESERVED = new Set([
  "www",
  "app",
  "api",
  "assets",
  "mail",
  "admin",
  "status",
  "docs",
  "blog",
  "help",
  "support",
  "static",
  "cdn",
  "example",
  "demo",
]);
const LABEL = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PLATFORM =
  /^\/(?:platform|portfolio-platform)\/[a-f0-9]{16,64}[a-z0-9._-]*\.(?:css|js|ttf|webp)$/;
const ASSET = /^\/assets\/[a-zA-Z0-9_-]{1,128}$/;
const PROJECT = /^\/projects\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

type FileRow = {
  candidate_id: string;
  bucket: string;
  key: string;
  path: string;
  bytes: number;
  sha256: string;
  content_type: string;
};

function allowedPath(path: string) {
  return (
    path === "/" ||
    path === "/404" ||
    path === "/resume" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml" ||
    PROJECT.test(path) ||
    PLATFORM.test(path) ||
    ASSET.test(path)
  );
}

function expectedContentType(path: string, contentType: string) {
  if (path === "/robots.txt")
    return contentType === "text/plain; charset=utf-8";
  if (path === "/sitemap.xml") return contentType === "application/xml";
  if (path.endsWith(".css")) return contentType === "text/css; charset=utf-8";
  if (path.endsWith(".js"))
    return contentType === "text/javascript; charset=utf-8";
  if (path.endsWith(".ttf")) return contentType === "font/ttf";
  if (path.endsWith(".webp")) return contentType === "image/webp";
  if (path.startsWith("/assets/"))
    return [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ].includes(contentType);
  return contentType === "text/html; charset=utf-8";
}

function isValidFile(
  row: FileRow | null,
  requestedPath: string,
): row is FileRow {
  return !!(
    row &&
    typeof row.candidate_id === "string" &&
    typeof row.bucket === "string" &&
    typeof row.key === "string" &&
    typeof row.path === "string" &&
    typeof row.sha256 === "string" &&
    typeof row.content_type === "string" &&
    row.path === requestedPath &&
    UUID.test(row.candidate_id) &&
    (row.bucket === "sites" || row.bucket === "assets") &&
    row.key.startsWith(`candidate/${row.candidate_id}/`) &&
    row.key.length <= 512 &&
    !row.key.includes("..") &&
    Number.isSafeInteger(row.bytes) &&
    row.bytes >= 0 &&
    /^[a-f0-9]{64}$/.test(row.sha256) &&
    expectedContentType(row.path, row.content_type) &&
    (row.path.startsWith("/assets/") || PLATFORM.test(row.path)
      ? row.bucket === "assets"
      : row.bucket === "sites")
  );
}

async function portfolioFile(db: D1Database, name: string, path: string) {
  // The active pointer and the selected receipt are read in one D1 statement.
  // Retained platform files remain available to an already loaded old page.
  return db
    .prepare(
      `SELECT v.candidate_id,
        json_extract(f.value,'$.bucket') AS bucket,
        json_extract(f.value,'$.key') AS key,
        json_extract(f.value,'$.path') AS path,
        json_extract(f.value,'$.bytes') AS bytes,
        json_extract(f.value,'$.sha256') AS sha256,
        json_extract(f.value,'$.contentType') AS content_type
       FROM portfolio p
       JOIN subdomain_claim claim ON claim.portfolio_id=p.id AND claim.name=? AND claim.state='claimed'
       JOIN publish_version current ON current.portfolio_id=p.id AND current.n=p.published_version AND current.status='live'
       JOIN publish_version v ON v.portfolio_id=p.id
       JOIN publication_candidate c ON c.id=v.candidate_id AND c.status='ready'
       JOIN publication_candidate_index x ON x.candidate_id=c.id
       JOIN json_each(x.value,'$.receipts') f
       WHERE p.status='published' AND p.subdomain=claim.name
         AND NOT EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=claim.name)
         AND json_extract(f.value,'$.path')=?
         AND (v.id=current.id OR (?=1 AND v.status='superseded'))
       ORDER BY v.n DESC LIMIT 1`,
    )
    .bind(name, path, Number(PLATFORM.test(path)))
    .first<FileRow>();
}

async function assetFile(db: D1Database, candidateId: string, path: string) {
  // A retained URL remains public only while the active version includes the
  // same asset bytes. This denies removed uploads at the origin immediately
  // when the pointer changes, even before durable cleanup and purge complete.
  return db
    .prepare(
      `SELECT v.candidate_id,
        json_extract(f.value,'$.bucket') AS bucket,
        json_extract(f.value,'$.key') AS key,
        json_extract(f.value,'$.path') AS path,
        json_extract(f.value,'$.bytes') AS bytes,
        json_extract(f.value,'$.sha256') AS sha256,
        json_extract(f.value,'$.contentType') AS content_type
       FROM publish_version v
       JOIN portfolio p ON p.id=v.portfolio_id
       JOIN subdomain_claim claim ON claim.portfolio_id=p.id AND claim.name=p.subdomain AND claim.state='claimed'
       JOIN publish_version current ON current.portfolio_id=p.id AND current.n=p.published_version AND current.status='live'
       JOIN publication_candidate_index active_index ON active_index.candidate_id=current.candidate_id
       JOIN publication_candidate c ON c.id=v.candidate_id AND c.status='ready'
       JOIN publication_candidate_index x ON x.candidate_id=c.id
       JOIN json_each(x.value,'$.receipts') f
       WHERE v.candidate_id=? AND v.status IN ('live','superseded') AND p.status='published'
         AND NOT EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=claim.name)
         AND EXISTS(SELECT 1 FROM json_each(active_index.value,'$.receipts') active_file
           WHERE json_extract(active_file.value,'$.path')=json_extract(f.value,'$.path')
             AND json_extract(active_file.value,'$.sha256')=json_extract(f.value,'$.sha256')
             AND json_extract(active_file.value,'$.bucket')='assets')
         AND json_extract(f.value,'$.path')=? LIMIT 1`,
    )
    .bind(candidateId, path)
    .first<FileRow>();
}

async function serveFile(
  request: Request,
  env: PublicEnv,
  row: FileRow | null,
  path: string,
) {
  if (!isValidFile(row, path)) return unavailableResponse();
  const file = row;
  const bucket =
    file.bucket === "assets" ? env.PUBLIC_ASSETS_BUCKET : env.SITES_BUCKET;
  const object = await bucket.get(file.key);
  if (!object || object.size !== file.bytes) return unavailableResponse();
  const headers = portfolioHeaders("public", {
    assetOrigins: [env.ASSET_ORIGIN ?? "https://assets.hasaweb.site"],
  });
  headers.set("Content-Type", file.content_type);
  headers.set("ETag", `"${file.sha256}"`);
  // These files can be withdrawn. Query variants cannot extend their lifetime.
  headers.set("Cache-Control", "no-store");
  headers.set("CDN-Cache-Control", "no-store");
  if (file.content_type === "application/pdf")
    headers.set("Content-Disposition", "attachment");
  const match = request.headers
    .get("If-None-Match")
    ?.split(",")
    .some((value) => value.trim().replace(/^W\//, "") === `"${file.sha256}"`);
  if (match) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: path === "/404" ? 404 : 200,
    headers,
  });
}

export async function servePublic(request: Request, env: PublicEnv) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return unavailableResponse();
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (url.host !== host) return unavailableResponse();
  if (
    host === new URL(env.ASSET_ORIGIN ?? "https://assets.hasaweb.site").hostname
  ) {
    const match = /^\/candidate\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
    const candidateId = match?.[1];
    const assetId = match?.[2];
    if (
      !candidateId ||
      !assetId ||
      !UUID.test(candidateId) ||
      !ASSET.test(`/assets/${assetId}`)
    )
      return unavailableResponse();
    const path = `/assets/${assetId}`;
    return serveFile(
      request,
      env,
      await assetFile(env.DB, candidateId, path),
      path,
    );
  }
  if (!host.endsWith(SITE_SUFFIX)) return unavailableResponse();
  const name = host.slice(0, -SITE_SUFFIX.length);
  if (!LABEL.test(name) || RESERVED.has(name)) return unavailableResponse();
  const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "");
  if (path.startsWith("/assets/")) return unavailableResponse();
  const row = allowedPath(path)
    ? await portfolioFile(env.DB, name, path)
    : null;
  if (row || path === "/" || PLATFORM.test(path))
    return serveFile(request, env, row, path);
  // A missing or withdrawn page of a published portfolio, such as a removed
  // case study, gets that version's page-unavailable state with a route home.
  // Unpublished and unknown hosts have no live /404 and stay generic.
  return serveFile(
    request,
    env,
    await portfolioFile(env.DB, name, "/404"),
    "/404",
  );
}
