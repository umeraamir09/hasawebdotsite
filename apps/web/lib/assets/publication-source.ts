import { WorkerEntrypoint } from "cloudflare:workers";
import { candidateActive, candidateIdSchema } from "@hasaweb/db";
import { z } from "zod";
import { purgeDeletedDrafts } from "./deleted-drafts";

export const transferRequestSchema = z.strictObject({
  candidateId: candidateIdSchema,
  leaseToken: z.string().uuid(),
  assetId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  purpose: z.enum([
    "avatar",
    "banner",
    "face",
    "project",
    "case_study",
    "resume",
    "og",
  ]),
});
export type PublicationSourceEnv = { DB: D1Database; DRAFT_BUCKET: R2Bucket };
const ticketSql = `SELECT c.portfolio_id,a.bytes,a.content_type FROM publication_candidate c JOIN publication_transfer t ON t.candidate_id=c.id JOIN asset a ON a.id=t.asset_id AND a.portfolio_id=c.portfolio_id AND a.kind=t.purpose
 WHERE c.id=? AND c.lease_token=? AND c.lease_until>? AND c.status='transferring' AND t.asset_id=? AND t.purpose=? AND t.complete=0 AND a.status='ready' AND a.bytes=t.bytes AND a.content_type=t.content_type AND EXISTS(SELECT 1 FROM publication_candidate WHERE id=c.id AND ${candidateActive})`;
export async function publicationSource(
  request: Request,
  env: PublicationSourceEnv,
): Promise<Response> {
  const deny = () =>
    new Response(null, {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  if (request.method !== "POST" || new URL(request.url).pathname !== "/source")
    return deny();
  const reader = request.body?.getReader();
  if (!reader) return deny();
  let body = "",
    bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024) {
        await reader.cancel();
        return deny();
      }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    const input = transferRequestSchema.safeParse(JSON.parse(body));
    if (!input.success) return deny();
    const { candidateId, leaseToken, assetId, purpose } = input.data;
    const ticket = () =>
      env.DB.prepare(ticketSql)
        .bind(candidateId, leaseToken, Date.now(), assetId, purpose)
        .first<{ portfolio_id: string; bytes: number; content_type: string }>();
    const row = await ticket();
    if (
      !row ||
      row.bytes <= 0 ||
      row.bytes > (purpose === "resume" ? 10485760 : 5242880) ||
      !(purpose === "resume"
        ? row.content_type === "application/pdf"
        : ["image/jpeg", "image/png", "image/webp"].includes(row.content_type))
    )
      return deny();
    const object = await env.DRAFT_BUCKET.get(
      `draft/${row.portfolio_id}/${assetId}`,
    );
    if (!object) return deny();
    if (object.size !== row.bytes || !(await ticket())) {
      await object.body.cancel();
      return deny();
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": row.content_type,
        "Content-Length": String(row.bytes),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return deny();
  } finally {
    reader.releaseLock();
  }
}

export class PublicationAssets extends WorkerEntrypoint<PublicationSourceEnv> {
  fetch(request: Request) {
    return new URL(request.url).pathname === "/account-deletion"
      ? purgeDeletedDrafts(request, this.env)
      : publicationSource(request, this.env);
  }
}
