import { type PublicationSite, publicationSiteSchema } from "@hasaweb/schema";
import { z } from "zod";
import { SaveError } from "./bounded-save";
import {
  activeSaveSession,
  assertSaveSession,
  saveSessionParams,
} from "./draft-api";
import type { SessionIdentity } from "./repositories";

// Wakes one unpublish cleanup on the publication queue.
export const unpublishWakeSchema = z.strictObject({
  withdrawalId: z.string().uuid(),
});
export type UnpublishWake = z.infer<typeof unpublishWakeSchema>;
export class UnpublishError extends Error {
  readonly code = "not_published";
}

// Phase 48. Unpublish ends public access in one guarded statement: `site`
// serves only `published` portfolios, so pages, case studies, the resume,
// assets and live endpoints stop at once. The address claim, the draft and
// `published_version` stay; a later Publish commits from `unpublished` at the
// same claimed address. Deleting public objects and purging is the durable
// cleanup recorded in the same batch.
export function ownerPublicationSite(
  db: D1Database,
  identity: SessionIdentity,
) {
  async function read(portfolioId: string): Promise<PublicationSite> {
    const row = await db
      .prepare(`SELECT p.status,p.subdomain,
        (SELECT w.attempts FROM publication_withdrawal w WHERE w.portfolio_id=p.id AND w.completed_at IS NULL
          ORDER BY w.created_at DESC LIMIT 1) AS attempts
        FROM portfolio p WHERE p.id=? AND p.user_id=? AND p.status IN ('draft','published','unpublished','suspended')
        AND ${activeSaveSession}`)
      .bind(portfolioId, identity.user.id, ...saveSessionParams(identity))
      .first<{
        status: PublicationSite["status"];
        subdomain: string | null;
        attempts: number | null;
      }>();
    if (!row) {
      await assertSaveSession(db, identity);
      throw new SaveError(409, "Portfolio changed", "owner_changed");
    }
    return publicationSiteSchema.parse({
      portfolioId,
      status: row.status,
      url: row.subdomain ? `https://${row.subdomain}.hasaweb.site` : null,
      withdrawal: row.attempts === null ? null : { retrying: row.attempts > 0 },
    });
  }
  return {
    read,
    async unpublish(
      portfolioId: string,
      queue: { send(body: UnpublishWake): Promise<unknown> },
    ): Promise<PublicationSite> {
      await assertSaveSession(db, identity);
      const id = crypto.randomUUID();
      const now = Date.now();
      await db.batch([
        db
          .prepare(
            `UPDATE portfolio SET status='unpublished',updated_at=?
             WHERE id=? AND user_id=? AND status='published'
               AND published_version IS NOT NULL AND subdomain IS NOT NULL AND ${activeSaveSession}`,
          )
          .bind(
            now,
            portfolioId,
            identity.user.id,
            ...saveSessionParams(identity),
          ),
        // changes() is the preceding status update's, so a repeated or lost
        // request records no second cleanup.
        db
          .prepare(
            `INSERT INTO publication_withdrawal(id,portfolio_id,address,version,created_at)
             SELECT ?,p.id,p.subdomain,p.published_version,? FROM portfolio p
             WHERE p.id=? AND p.status='unpublished' AND changes()=1`,
          )
          .bind(id, now, portfolioId),
      ]);
      const site = await read(portfolioId);
      if (site.status === "draft" || site.status === "suspended")
        throw new UnpublishError("Portfolio is not published");
      if (site.status !== "unpublished") {
        // The guarded update skipped a published portfolio: the session ended
        // between the check and the batch.
        await assertSaveSession(db, identity);
        throw new Error("Unpublish was not applied");
      }
      // A lost wake is recovered by the cron sweep.
      const pending = await db
        .prepare(
          "SELECT id FROM publication_withdrawal WHERE portfolio_id=? AND completed_at IS NULL ORDER BY created_at DESC LIMIT 1",
        )
        .bind(portfolioId)
        .first<{ id: string }>();
      if (pending) await queue.send({ withdrawalId: pending.id });
      return site;
    },
  };
}
