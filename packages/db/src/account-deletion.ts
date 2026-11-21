import { z } from "zod";
import { activeSaveSession, saveSessionParams } from "./draft-api";
import type { SessionIdentity } from "./repositories";

// Wakes one account deletion cleanup on the publication queue.
export const deletionWakeSchema = z.strictObject({
  deletionId: z.string().uuid(),
});
export type DeletionWake = z.infer<typeof deletionWakeSchema>;

// The body the owner's confirmed request carries. A bare `{}` or a replayed
// request from another flow cannot delete an account.
export const accountDeletionRequestSchema = z.strictObject({
  confirm: z.literal("delete-account"),
});

/**
 * Phase 49. Starts permanent deletion in one D1 batch, so every effect is
 * visible at once or not at all:
 *
 * - `user.deleting_at` and `portfolio.status='deleting'` deny owner access,
 *   new sessions and publication; `site` serves only `published` portfolios.
 * - Every session row goes, so a cached cookie elsewhere authorizes nothing.
 * - A never-published (`held`) address is released; a published (`claimed`)
 *   one loses its portfolio and stays as a permanent ownerless claim.
 * - Staged private save attempts go.
 * - The durable `account_deletion` record (no foreign keys) drives the rest:
 *   public output, candidates, private uploads, then the account rows.
 *
 * Private GitHub access is withdrawn by the caller before this batch, while
 * the session still exists. Returns null when the session ended or the
 * account is already being deleted; nothing changes then.
 */
export async function requestAccountDeletion(
  db: D1Database,
  identity: SessionIdentity,
  now = Date.now(),
): Promise<{ deletionId: string } | null> {
  const id = crypto.randomUUID();
  const owner = identity.user.id;
  const mine = "SELECT id FROM portfolio WHERE user_id=?";
  const started =
    "EXISTS(SELECT 1 FROM account_deletion WHERE id=? AND user_id=?)";
  const results = await db.batch([
    db
      .prepare(
        `UPDATE user SET deleting_at=?,updated_at=? WHERE id=? AND deleting_at IS NULL AND ${activeSaveSession}`,
      )
      .bind(now, now, owner, ...saveSessionParams(identity)),
    // The exact timestamp proves this batch made the change above.
    db
      .prepare(
        `INSERT INTO account_deletion(id,user_id,portfolio_id,address,created_at)
         SELECT ?,u.id,p.id,(SELECT c.name FROM subdomain_claim c WHERE c.portfolio_id=p.id AND c.state='claimed'),?
         FROM user u LEFT JOIN portfolio p ON p.user_id=u.id WHERE u.id=? AND u.deleting_at=?
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(id, now, owner, now),
    db
      .prepare(
        `UPDATE portfolio SET status='deleting',updated_at=? WHERE user_id=? AND ${started}`,
      )
      .bind(now, owner, id, owner),
    db
      .prepare(
        `DELETE FROM subdomain_claim WHERE state='held' AND portfolio_id IN (${mine}) AND ${started}`,
      )
      .bind(owner, id, owner),
    db
      .prepare(
        `UPDATE subdomain_claim SET portfolio_id=NULL WHERE state='claimed' AND portfolio_id IN (${mine}) AND ${started}`,
      )
      .bind(owner, id, owner),
    db
      .prepare(`DELETE FROM session WHERE user_id=? AND ${started}`)
      .bind(owner, id, owner),
    db
      .prepare(`DELETE FROM owner_save_attempt WHERE user_id=? AND ${started}`)
      .bind(owner, id, owner),
  ]);
  return results[1]?.meta.changes === 1 ? { deletionId: id } : null;
}
