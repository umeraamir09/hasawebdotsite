import {
  type PublicationCacheEnv,
  purgePublicationHosts,
  verifyPublicationUrl,
} from "./publication-cache";
import type { DispatchEnv } from "./publication-dispatch";

export type WithdrawalEnv = Pick<
  DispatchEnv,
  "DB" | "PUBLIC_ASSETS_BUCKET" | "PUBLICATION_QUEUE" | "ASSET_ORIGIN"
> &
  PublicationCacheEnv & { APP_ENV?: string };

export async function withdrawPublication(env: WithdrawalEnv, id: string) {
  const operation =
    await env.DB.prepare(`SELECT o.portfolio_id,o.cleanup_cursor,o.cleanup_attempts,r.address,r.version
    FROM publication_operation o JOIN publication_commit r ON r.candidate_id=o.id
    WHERE o.id=? AND o.completed_at IS NULL AND o.next_attempt_at<=?`)
      .bind(id, Date.now())
      .first<{
        portfolio_id: string;
        cleanup_cursor: string;
        cleanup_attempts: number;
        address: string;
        version: number;
      }>();
  if (!operation) return false;
  try {
    const verifying = operation.cleanup_cursor.startsWith("verify:");
    const local = env.APP_ENV === "local" || env.APP_ENV === "test";
    const cursor = verifying
      ? operation.cleanup_cursor.slice(7)
      : operation.cleanup_cursor;
    const files =
      await env.DB.prepare(`SELECT json_extract(f.value,'$.key') AS key,
      NOT EXISTS(SELECT 1 FROM json_each(active.value,'$.receipts') current_file
        WHERE json_extract(current_file.value,'$.path')=json_extract(f.value,'$.path')
        AND json_extract(current_file.value,'$.sha256')=json_extract(f.value,'$.sha256')
        AND json_extract(current_file.value,'$.bucket')='assets') AS removed
      FROM publish_version v JOIN publication_candidate_index old ON old.candidate_id=v.candidate_id
      JOIN portfolio p ON p.id=v.portfolio_id
      JOIN publish_version live ON live.portfolio_id=p.id AND live.n=p.published_version
      JOIN publication_candidate_index active ON active.candidate_id=live.candidate_id
      JOIN json_each(old.value,'$.receipts') f
      WHERE v.portfolio_id=? AND v.n<? AND v.candidate_id!=live.candidate_id
      AND json_extract(f.value,'$.bucket')='assets' AND json_extract(f.value,'$.key')>?
      ORDER BY key LIMIT 8`)
        .bind(operation.portfolio_id, operation.version, cursor)
        .all<{ key: string; removed: number }>();
    for (const file of files.results) {
      if (!file.removed) continue;
      if (verifying) {
        if (!local) {
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
    if (files.results.length) {
      await env.DB.prepare(
        "UPDATE publication_operation SET cleanup_cursor=?,cleanup_attempts=0,next_attempt_at=0 WHERE id=? AND cleanup_cursor=? AND completed_at IS NULL",
      )
        .bind(
          `${verifying ? "verify:" : ""}${files.results.at(-1)?.key}`,
          id,
          operation.cleanup_cursor,
        )
        .run();
      await env.PUBLICATION_QUEUE.send({ candidateId: id });
      return true;
    }
    if (!verifying) {
      if (!local)
        await purgePublicationHosts(env, [
          `${operation.address}.hasaweb.site`,
          new URL(env.ASSET_ORIGIN).host,
        ]);
      await env.DB.prepare(
        "UPDATE publication_operation SET cleanup_cursor='verify:',cleanup_attempts=0,next_attempt_at=0 WHERE id=? AND cleanup_cursor=? AND completed_at IS NULL",
      )
        .bind(id, operation.cleanup_cursor)
        .run();
      await env.PUBLICATION_QUEUE.send({ candidateId: id });
      return true;
    }
    if (!local) {
      const page =
        await env.DB.prepare(`SELECT p.status,json_extract(f.value,'$.sha256') AS sha256
        FROM portfolio p JOIN publish_version v ON v.portfolio_id=p.id AND v.n=p.published_version
        JOIN publication_candidate_index x ON x.candidate_id=v.candidate_id JOIN json_each(x.value,'$.receipts') f
        WHERE p.id=? AND json_extract(f.value,'$.path')='/' LIMIT 1`)
          .bind(operation.portfolio_id)
          .first<{ status: string; sha256: string }>();
      if (!page) throw new Error("Live publication is unavailable");
      // After Unpublish the host serves nothing and that withdrawal verifies
      // the absence, so only a still-published portfolio is checked here.
      if (page.status === "published")
        await verifyPublicationUrl(
          env,
          `https://${operation.address}.hasaweb.site/`,
          { status: 200, sha256: page.sha256 },
        );
    }
    await env.DB.prepare(
      "UPDATE publication_operation SET completed_at=?,cleanup_attempts=0 WHERE id=? AND cleanup_cursor=? AND completed_at IS NULL",
    )
      .bind(Date.now(), id, operation.cleanup_cursor)
      .run();
    return true;
  } catch (error) {
    await env.DB.prepare(
      "UPDATE publication_operation SET cleanup_attempts=cleanup_attempts+1,next_attempt_at=? WHERE id=? AND completed_at IS NULL",
    )
      .bind(
        Date.now() +
          Math.min(300000, 1000 * 2 ** Math.min(operation.cleanup_attempts, 8)),
        id,
      )
      .run();
    throw error;
  }
}

export async function sweepPublicationWithdrawals(env: WithdrawalEnv) {
  const rows =
    await env.DB.prepare(`SELECT o.id FROM publication_operation o JOIN publication_commit r ON r.candidate_id=o.id
    WHERE o.completed_at IS NULL AND o.next_attempt_at<=? ORDER BY o.next_attempt_at LIMIT 4`)
      .bind(Date.now())
      .all<{ id: string }>();
  for (const row of rows.results)
    await env.PUBLICATION_QUEUE.send({ candidateId: row.id });
}
