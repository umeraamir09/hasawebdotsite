import { publicationRetains } from "./publication-index";
import { publicationTasks } from "./publication-tasks";

// Phase 51 bounded garbage collection. Each function does one small pass and
// is safe to repeat; the jobs cron runs them (`apps/jobs/src/maintenance.ts`).
// Every limit below bounds one pass, never the backlog.

const DAY_MS = 86_400_000;
/** Staging expires after an hour; it is dormant a week later with no live session. */
export const STAGING_DORMANT_MS = 7 * DAY_MS;
/** A failed upload, or one still pending a day after it started, was abandoned. */
export const UPLOAD_FAILED_MS = DAY_MS;
/**
 * A ready upload nothing on the server references may still be named by an
 * unsaved edit or local recovery in the owner's browser. It is collected only
 * after this long without change.
 */
export const UPLOAD_UNREFERENCED_MS = 30 * DAY_MS;
/** Operator email lookups are audited for this long, or until the account goes. */
export const AUDIT_RETENTION_MS = 90 * DAY_MS;
/** A cleanup that ran out of attempts is retried this long after it stopped. */
export const CLEANUP_RETRY_MS = DAY_MS;
/** Alert when the database reaches 350 MB. */
export const D1_SIZE_ALERT_BYTES = 350_000_000;

/**
 * Deletes one page of dormant staged save attempts: expired for a week and
 * owned by an account with no live session. An active attempt has not
 * expired. A committed attempt is the receipt a retried commit replays, and a
 * client can read it only before it expires and only with a session, so while
 * the owner has a live session it may still be reconciling and is kept. Only
 * staging rows are touched: address holds and address confirmation receipts
 * live in other tables and are never released here.
 */
export async function collectDormantStaging(db: D1Database, now: number) {
  const dormant = `SELECT s.id FROM owner_save_attempt s WHERE s.expires_at<=?1
    AND NOT EXISTS(SELECT 1 FROM session x WHERE x.user_id=s.user_id AND x.expires_at>?2)`;
  const values = [now - STAGING_DORMANT_MS, now];
  const pieces = await db
    .prepare(
      `DELETE FROM owner_save_piece WHERE rowid IN (SELECT rowid FROM owner_save_piece WHERE attempt_id IN (${dormant}) LIMIT 64)`,
    )
    .bind(...values)
    .run();
  const attempts = await db
    .prepare(
      `DELETE FROM owner_save_attempt WHERE id IN (${dormant}
        AND NOT EXISTS(SELECT 1 FROM owner_save_piece pc WHERE pc.attempt_id=s.id) LIMIT 16)`,
    )
    .bind(...values)
    .run();
  return { pieces: pieces.meta.changes, attempts: attempts.meta.changes };
}

/**
 * Removes GitHub coordination left by deleted accounts once it has resolved.
 * A grant row stays while consent, an active grant or a revocation (pending,
 * in flight or uncertain) needs it; only an idle, credential-free grant
 * without a portfolio goes. A finished or void consent attempt of a deleted
 * account goes once no unresolved grant uses its operation.
 */
export async function collectGitHubResiduals(db: D1Database) {
  const grants = await db
    .prepare(
      `DELETE FROM github_grant WHERE rowid IN (SELECT rowid FROM github_grant
        WHERE portfolio_id IS NULL AND state='idle' AND token_enc IS NULL AND token_binding IS NULL LIMIT 16)`,
    )
    .run();
  const consents = await db
    .prepare(
      `DELETE FROM github_consent WHERE state_hash IN (SELECT g.state_hash FROM github_consent g
        WHERE g.user_id IS NULL AND g.portfolio_id IS NULL AND g.state IN ('finished','void')
          AND NOT EXISTS(SELECT 1 FROM github_grant t WHERE t.operation_id=g.operation_id AND t.state!='idle') LIMIT 16)`,
    )
    .run();
  return { grants: grants.meta.changes, consents: consents.meta.changes };
}

/** Deletes email lookup audits past their retention. Account deletion cascades the rest. */
export async function collectOperatorAudits(db: D1Database, now: number) {
  const result = await db
    .prepare(
      "DELETE FROM operator_email_audit WHERE id IN (SELECT id FROM operator_email_audit WHERE accessed_at<? LIMIT 64)",
    )
    .bind(now - AUDIT_RETENTION_MS)
    .run();
  return result.meta.changes;
}

/**
 * Candidate cleanups that ran out of attempts keep their tombstone, and may
 * still have output, so a deleted account's pages could outlive it. Restart
 * the prefix cleanup a day after it stopped; the dispatcher then deletes the
 * output and, a day after it is confirmed empty, the tombstone. Returns the
 * restarted candidate IDs for the caller to wake.
 */
export async function retryExhaustedCleanups(db: D1Database, now: number) {
  const rows = await db
    .prepare(
      `SELECT id FROM publication_candidate WHERE status='failed' AND last_error LIKE 'cleanup:%'
        AND source IS NULL AND updated_at<? AND lease_until<? ORDER BY updated_at LIMIT 4`,
    )
    .bind(now - CLEANUP_RETRY_MS, now - 30_000)
    .all<{ id: string }>();
  const tasks = publicationTasks(db);
  const restarted: string[] = [];
  for (const { id } of rows.results)
    if (await tasks.startCleanup(id)) restarted.push(id);
  return restarted;
}

/**
 * Removes one page of abandoned uploads and returns their private object
 * keys. The web Worker owns the draft bucket and deletes the objects; the row
 * goes first in the same statement that checks eligibility, so nothing can
 * start referencing the asset in between, and an object left by a failed
 * delete is an orphan the listing pass removes.
 *
 * Eligible: failed or stalled pending uploads after a day, and ready uploads
 * unchanged for 30 days in a portfolio past setup. Never eligible while the
 * account or portfolio is being deleted (its own cleanup removes everything),
 * while setup is unfinished (local setup recovery may name any ready upload),
 * or while anything on the server could still name the asset: the canonical
 * draft, any open or partial staged attempt of the owner (its pieces are
 * string fragments, so any of them protects every asset), a transfer row, a
 * candidate's sealed source, or the shared publication retention guard,
 * which covers a sealed candidate before indexing and every retained or live
 * version after its source is released. Matching the ID as a substring of the
 * JSON is deliberately conservative: an ID that appears anywhere protects it.
 */
export async function collectAbandonedUploads(db: D1Database, now: number) {
  const result = await db
    .prepare(
      `DELETE FROM asset WHERE id IN (SELECT a.id FROM asset a
        JOIN portfolio p ON p.id=a.portfolio_id JOIN user u ON u.id=p.user_id
        WHERE p.status!='deleting' AND u.deleting_at IS NULL
          AND ((a.status IN ('failed','pending') AND a.created_at<?1 AND a.updated_at<?1)
            OR (a.status='ready' AND a.updated_at<?2 AND p.first_editor_entered_at IS NOT NULL))
          AND instr(p.draft,a.id)=0
          AND NOT EXISTS(SELECT 1 FROM owner_save_attempt s WHERE s.user_id=p.user_id
            AND (s.state IN ('open','string') OR instr(coalesce(s.draft,''),a.id)>0
              OR EXISTS(SELECT 1 FROM owner_save_piece pc WHERE pc.attempt_id=s.id)))
          AND NOT EXISTS(SELECT 1 FROM publication_transfer t WHERE t.asset_id=a.id)
          AND NOT EXISTS(SELECT 1 FROM publication_candidate c WHERE c.portfolio_id=a.portfolio_id
            AND c.source IS NOT NULL AND instr(c.source,a.id)>0)
          AND NOT ${publicationRetains("a.portfolio_id", "a.id")}
        ORDER BY a.updated_at LIMIT 16)
      RETURNING id,portfolio_id`,
    )
    .bind(now - UPLOAD_FAILED_MS, now - UPLOAD_UNREFERENCED_MS)
    .all<{ id: string; portfolio_id: string }>();
  return result.results.map(
    (row) => `draft/${row.portfolio_id}/${row.id}` as const,
  );
}

/**
 * Of these draft-bucket keys, the ones no asset row or unfinished account
 * deletion accounts for. Rows are written before objects, so an object
 * without a row was left by a failed delete or an earlier deletion. Keys
 * outside the `draft/{portfolio}/{asset}` shape are never returned.
 */
export async function orphanDraftKeys(db: D1Database, keys: string[]) {
  const parsed = keys.flatMap((key) => {
    const match = /^draft\/([^/]+)\/([^/]+)$/.exec(key);
    return match ? [{ key, portfolio: match[1], id: match[2] }] : [];
  });
  if (!parsed.length) return [];
  const known = await db
    .prepare(
      `SELECT j.value AS key FROM json_each(?) j
        WHERE EXISTS(SELECT 1 FROM asset a WHERE a.id=json_extract(j.value,'$.id'))
          OR EXISTS(SELECT 1 FROM account_deletion d WHERE d.portfolio_id=json_extract(j.value,'$.portfolio'))`,
    )
    .bind(JSON.stringify(parsed))
    .all<{ key: string }>();
  const kept = new Set(
    known.results.map((row) => (JSON.parse(row.key) as { key: string }).key),
  );
  return parsed.filter((item) => !kept.has(item.key)).map((item) => item.key);
}

export async function readMaintenanceCursor(db: D1Database, name: string) {
  return (
    (await db
      .prepare("SELECT value FROM maintenance_cursor WHERE name=?")
      .bind(name)
      .first<string>("value")) ?? undefined
  );
}

export async function writeMaintenanceCursor(
  db: D1Database,
  name: string,
  value: string | undefined,
  now: number,
) {
  await (value === undefined
    ? db.prepare("DELETE FROM maintenance_cursor WHERE name=?").bind(name)
    : db
        .prepare(
          "INSERT INTO maintenance_cursor(name,value,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        )
        .bind(name, value, now)
  ).run();
}

/** The database size D1 reports after a trivial query, and whether it needs an alert. */
export async function databaseSize(db: D1Database) {
  const result = await db.prepare("SELECT 1").run();
  const bytes = (result.meta as { size_after?: number }).size_after;
  return {
    bytes: bytes ?? null,
    alert: bytes !== undefined && bytes >= D1_SIZE_ALERT_BYTES,
  };
}
