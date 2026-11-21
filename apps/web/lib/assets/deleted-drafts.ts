import { z } from "zod";

const deletionRequestSchema = z.strictObject({ deletionId: z.string().uuid() });

/**
 * Phase 49. Deletes one bounded page of a deleted account's private uploads
 * (`draft/{portfolio}/`). The only capability is a persisted deletion record
 * in a stage that removes uploads; the portfolio comes from that record, so a
 * caller can never name another prefix. Returns whether objects remain.
 */
export async function purgeDeletedDrafts(
  request: Request,
  env: { DB: D1Database; DRAFT_BUCKET: R2Bucket },
): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.method !== "POST")
    return new Response(null, { status: 404, headers });
  const input = deletionRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) return new Response(null, { status: 404, headers });
  const row = await env.DB.prepare(
    "SELECT portfolio_id FROM account_deletion WHERE id=? AND stage IN ('draft','final') AND portfolio_id IS NOT NULL",
  )
    .bind(input.data.deletionId)
    .first<{ portfolio_id: string }>();
  if (!row) return new Response(null, { status: 404, headers });
  const listing = await env.DRAFT_BUCKET.list({
    prefix: `draft/${row.portfolio_id}/`,
    limit: 100,
  });
  if (listing.objects.length)
    await env.DRAFT_BUCKET.delete(listing.objects.map((object) => object.key));
  return Response.json({ remaining: listing.objects.length > 0 }, { headers });
}
