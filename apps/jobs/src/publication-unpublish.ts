import {
  purgePublicationHosts,
  verifyPublicationUrl,
} from "./publication-cache";
import type { WithdrawalEnv } from "./publication-withdrawal";

/**
 * Phase 48 cleanup after Unpublish. Origin access already ended with the
 * status change; this deletes every public object of the versions that were
 * public (up to the recorded version), purges both hosts and then verifies
 * absence under the S-9 policy. A later republish writes a new candidate
 * prefix, so it is never touched.
 */
export async function withdrawUnpublished(env: WithdrawalEnv, id: string) {
  const row = await env.DB.prepare(
    `SELECT w.portfolio_id,w.address,w.version,w.cursor,w.attempts,p.status
     FROM publication_withdrawal w JOIN portfolio p ON p.id=w.portfolio_id
     WHERE w.id=? AND w.completed_at IS NULL AND w.next_attempt_at<=?`,
  )
    .bind(id, Date.now())
    .first<{
      portfolio_id: string;
      address: string;
      version: number;
      cursor: string;
      attempts: number;
      status: string;
    }>();
  if (!row) return false;
  try {
    const verifying = row.cursor.startsWith("verify:");
    const local = env.APP_ENV === "local" || env.APP_ENV === "test";
    const cursor = verifying ? row.cursor.slice(7) : row.cursor;
    const files = await env.DB.prepare(
      `SELECT DISTINCT json_extract(f.value,'$.key') AS key,json_extract(f.value,'$.path') AS path
       FROM publish_version v JOIN publication_candidate_index x ON x.candidate_id=v.candidate_id
       JOIN json_each(x.value,'$.receipts') f
       WHERE v.portfolio_id=? AND v.n<=? AND json_extract(f.value,'$.bucket')='assets'
         AND json_extract(f.value,'$.key')>?
       ORDER BY key LIMIT 8`,
    )
      .bind(row.portfolio_id, row.version, cursor)
      .all<{ key: string; path: string }>();
    for (const file of files.results) {
      if (verifying) {
        // Platform files are served only by the portfolio host, which the
        // final check covers. Uploads have their own asset-host URLs.
        if (!local && file.path.startsWith("/assets/")) {
          const url = `${env.ASSET_ORIGIN}/${file.key}`;
          await verifyPublicationUrl(env, url, { status: 404 });
          await verifyPublicationUrl(env, `${url}?variant=warm`, {
            status: 404,
          });
        }
      } else {
        await env.PUBLIC_ASSETS_BUCKET.delete(file.key);
        if (await env.PUBLIC_ASSETS_BUCKET.head(file.key))
          throw new Error("Withdrawn object still present");
      }
    }
    const advance = async (next: string) => {
      await env.DB.prepare(
        "UPDATE publication_withdrawal SET cursor=?,attempts=0,next_attempt_at=0 WHERE id=? AND cursor=? AND completed_at IS NULL",
      )
        .bind(next, id, row.cursor)
        .run();
      await env.PUBLICATION_QUEUE.send({ withdrawalId: id });
    };
    const last = files.results.at(-1);
    if (last) {
      await advance(`${verifying ? "verify:" : ""}${last.key}`);
      return true;
    }
    if (!verifying) {
      if (!local)
        await purgePublicationHosts(env, [
          `${row.address}.hasaweb.site`,
          new URL(env.ASSET_ORIGIN).host,
        ]);
      await advance("verify:");
      return true;
    }
    // A republish (or deletion) since then owns the host; its own cleanup
    // verifies what it serves.
    if (!local && row.status === "unpublished")
      await verifyPublicationUrl(env, `https://${row.address}.hasaweb.site/`, {
        status: 404,
      });
    await env.DB.prepare(
      "UPDATE publication_withdrawal SET completed_at=?,attempts=0 WHERE id=? AND cursor=? AND completed_at IS NULL",
    )
      .bind(Date.now(), id, row.cursor)
      .run();
    return true;
  } catch (error) {
    await env.DB.prepare(
      "UPDATE publication_withdrawal SET attempts=attempts+1,next_attempt_at=? WHERE id=? AND completed_at IS NULL",
    )
      .bind(
        Date.now() + Math.min(300000, 1000 * 2 ** Math.min(row.attempts, 8)),
        id,
      )
      .run();
    throw error;
  }
}

export async function sweepUnpublishWithdrawals(env: WithdrawalEnv) {
  const rows = await env.DB.prepare(
    "SELECT id FROM publication_withdrawal WHERE completed_at IS NULL AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 4",
  )
    .bind(Date.now())
    .all<{ id: string }>();
  for (const row of rows.results)
    await env.PUBLICATION_QUEUE.send({ withdrawalId: row.id });
}
