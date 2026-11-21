import {
  collectAbandonedUploads,
  orphanDraftKeys,
  readMaintenanceCursor,
  UPLOAD_FAILED_MS,
  writeMaintenanceCursor,
} from "@hasaweb/db";

const ORPHAN_CURSOR = "draft-orphans";

/**
 * Phase 51. One bounded pass of private upload collection, run for the jobs
 * cron through the `PublicationAssets` entry, which alone holds the draft
 * bucket. It takes no input: what to delete comes only from D1.
 *
 * 1. Abandoned uploads: `collectAbandonedUploads` deletes the eligible rows
 *    (see its guards) and this deletes their objects.
 * 2. Orphans: one page of the `draft/` listing, resumed from a stored cursor;
 *    an object older than a day with no asset row and no unfinished account
 *    deletion is deleted. This also catches anything a finished account
 *    deletion left behind.
 */
export async function collectUploads(
  env: { DB: D1Database; DRAFT_BUCKET: R2Bucket },
  now = Date.now(),
) {
  const abandoned = await collectAbandonedUploads(env.DB, now);
  if (abandoned.length) await env.DRAFT_BUCKET.delete(abandoned);
  const cursor = await readMaintenanceCursor(env.DB, ORPHAN_CURSOR);
  const listing = await env.DRAFT_BUCKET.list({
    prefix: "draft/",
    limit: 50,
    ...(cursor ? { cursor } : {}),
  });
  const settled = listing.objects
    .filter((object) => object.uploaded.getTime() < now - UPLOAD_FAILED_MS)
    .map((object) => object.key);
  const orphans = await orphanDraftKeys(env.DB, settled);
  if (orphans.length) await env.DRAFT_BUCKET.delete(orphans);
  await writeMaintenanceCursor(
    env.DB,
    ORPHAN_CURSOR,
    listing.truncated ? listing.cursor : undefined,
    now,
  );
  return { abandoned: abandoned.length, orphans: orphans.length };
}

/** The `PublicationAssets` route: POST only, no body, private response. */
export async function uploadCollection(
  request: Request,
  env: { DB: D1Database; DRAFT_BUCKET: R2Bucket },
) {
  const headers = { "Cache-Control": "private, no-store" };
  await request.body?.cancel();
  if (request.method !== "POST")
    return new Response(null, { status: 404, headers });
  return Response.json(await collectUploads(env), { headers });
}
