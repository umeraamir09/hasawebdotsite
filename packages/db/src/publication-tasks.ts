import { z } from "zod";
import {
  activeSaveSession,
  assertSaveSession,
  saveSessionParams,
} from "./draft-api";
import { ownerPublication } from "./publication";
import { candidateUnretained, publicationFacts } from "./publication-facts";
import type { SessionIdentity } from "./repositories";

export const candidateIdSchema = z.string().uuid();
export const wakeSchema = z.strictObject({ candidateId: candidateIdSchema });
export type Wake = z.infer<typeof wakeSchema>;
export const LEASE_MS = 60_000;
export const DEADLINE_MS = 3_600_000;
export const MAX_ATTEMPTS = 4;
export const PUBLICATION_RENDERER_VERSION = "publication-v2";
export const candidateSchema = z.object({
  id: candidateIdSchema,
  portfolio_id: z.string(),
  owner_id: z.string(),
  source_revision: z.number().int(),
  renderer_version: z.string(),
  task_batch: z.number().int().min(1).max(32),
  asset_origin: z.string().url(),
  status: z.enum([
    "preparing",
    "assembling",
    "transferring",
    "ready",
    "failed",
    "cleaning",
    "cleaned",
  ]),
  cursor: z.string().max(32768),
  sequence: z.number().int(),
  output_count: z.number().int(),
  page_index: z.number().int().nonnegative(),
  lease_token: z.string().nullable(),
  lease_until: z.number(),
  attempts: z.number().int(),
  next_attempt_at: z.number(),
  deadline_at: z.number(),
  last_error: z.string().nullable(),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const PUBLICATION_SOURCE_LIMIT = 4;
export const PUBLICATION_PENDING_LIMIT = 128;
export const PUBLICATION_READY_MS = 3_600_000;
export const PUBLICATION_TOMBSTONE_MS = 86_400_000;
const columns =
  "id,portfolio_id,owner_id,source_revision,renderer_version,task_batch,asset_origin,status,cursor,sequence,output_count,page_index,lease_token,lease_until,attempts,next_attempt_at,deadline_at,last_error";
export const candidateActive = `EXISTS(SELECT 1 FROM portfolio p JOIN user u ON u.id=p.user_id WHERE p.id=publication_candidate.portfolio_id AND p.user_id=publication_candidate.owner_id AND p.status!='deleting' AND u.deleting_at IS NULL)`;

// SQL captures one consistent validated revision. No draft JSON crosses into JS.
// The private source is not a public snapshot or a publication manifest.
const sourceSql = `WITH p AS (SELECT draft FROM portfolio WHERE id=?),
 c AS (SELECT j.value AS value FROM p,json_each(p.draft,'$.components') j
 WHERE coalesce(json_extract(p.draft,'$.samples.' || json_quote('components.' || json_extract(j.value,'$.id'))),0)!=1),
 links AS (SELECT j.value FROM p,json_each(p.draft,'$.links') j)
 SELECT json_object('schemaVersion',json_extract(draft,'$.schemaVersion'),'profile',json(json_remove(json_extract(draft,'$.profile'),
 CASE WHEN json_extract(draft,'$.profile.faceReveal.enabled')=1 THEN '$.unused' ELSE '$.faceReveal.image' END)),
 'links',json((SELECT json_group_array(json(value)) FROM links WHERE json_extract(value,'$.showInProfile')=1 OR (json_extract(value,'$.showInSocialComponent')=1 AND EXISTS(SELECT 1 FROM c WHERE json_extract(value,'$.type')='social-links')))),
 'components',json((SELECT json_group_array(json(CASE WHEN json_extract(value,'$.type')='contact' THEN json_remove(value,'$.data.recipientId') ELSE value END)) FROM c)),
 'appearance',json(json_extract(draft,'$.appearance')),'seo',json(json_extract(draft,'$.seo'))) FROM p`;
export function publicationTasks(db: D1Database) {
  async function get(id: string): Promise<Candidate | null> {
    const row = await db
      .prepare(`SELECT ${columns} FROM publication_candidate WHERE id=?`)
      .bind(id)
      .first();
    return row ? candidateSchema.parse(row) : null;
  }
  return {
    get,
    async create(
      identity: SessionIdentity,
      portfolioId: string,
      revision: number,
      policy: { batchSize: number; assetOrigin: string; candidateId?: string },
    ) {
      if (policy.candidateId) {
        const existing = await get(policy.candidateId);
        if (existing) {
          if (
            existing.owner_id !== identity.user.id ||
            existing.portfolio_id !== portfolioId ||
            existing.source_revision !== revision
          )
            throw new Error("Candidate command conflict");
          await assertSaveSession(db, identity);
          return existing.id;
        }
      }
      const facts = await db
        .prepare(
          `SELECT ${publicationFacts} AS value FROM portfolio p WHERE p.id=? AND p.user_id=? AND p.draft_rev=?`,
        )
        .bind(portfolioId, identity.user.id, revision)
        .first<{ value: string }>();
      if (!facts) throw new Error("Source revision unavailable");
      const validation = await ownerPublication(
        db,
        identity,
        async () => true,
      ).check({ portfolioId, revision, assetOffset: 0 });
      if (validation.issues.length || validation.hasMoreIssues)
        throw new Error(
          `Publication requirements incomplete ${JSON.stringify(validation.issues)}`,
        );
      // Bounded discovery checks every captured reference against private R2.
      const id = policy.candidateId ?? crypto.randomUUID(),
        now = Date.now();
      const row = await db
        .prepare(`INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,facts,renderer_version,task_batch,asset_origin,status,cursor,next_attempt_at,deadline_at,created_at,updated_at)
        SELECT ?,p.id,p.user_id,p.draft_rev,(${sourceSql}),${publicationFacts},?,?,?,'preparing',?, ?,?,?,? FROM portfolio p
        WHERE p.id=? AND p.user_id=? AND p.draft_rev=? AND p.draft_validation_version=2 AND p.status!='deleting'
        AND NOT EXISTS(SELECT 1 FROM publication_candidate_pending pending CROSS JOIN publication_candidate existing ON existing.id=pending.candidate_id WHERE existing.portfolio_id=p.id AND existing.source IS NOT NULL)
        AND (SELECT count(*) FROM publication_candidate WHERE id IN (SELECT candidate_id FROM publication_candidate_pending) AND source IS NOT NULL)<${PUBLICATION_SOURCE_LIMIT}
        AND (SELECT count(*) FROM publication_candidate_pending)<${PUBLICATION_PENDING_LIMIT}
        AND ${publicationFacts}=? AND ${activeSaveSession} AND NOT EXISTS(SELECT 1 FROM owner_save_attempt a WHERE a.user_id=p.user_id AND a.state NOT IN ('aborted','committed') AND a.expires_at>?) RETURNING id`)
        .bind(
          id,
          portfolioId,
          PUBLICATION_RENDERER_VERSION,
          z.number().int().min(1).max(32).parse(policy.batchSize),
          z
            .string()
            .url()
            .refine((value) => new URL(value).origin === value)
            .parse(policy.assetOrigin),
          JSON.stringify([{ kind: "root" }, { kind: "discover", index: 0 }]),
          now,
          now + DEADLINE_MS,
          now,
          now,
          portfolioId,
          identity.user.id,
          revision,
          facts.value,
          ...saveSessionParams(identity),
          now,
        )
        .first<{ id: string }>();
      if (!row)
        throw new Error(
          "Source revision unavailable or publication capacity reached; finish candidate cleanup before retrying",
        );
      return row.id;
    },
    async claim(id: string, now = Date.now()) {
      const token = crypto.randomUUID();
      const row = await db
        .prepare(
          `UPDATE publication_candidate SET lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('preparing','assembling','transferring','cleaning') AND lease_until<=? AND next_attempt_at<=? AND deadline_at>? AND attempts<${MAX_ATTEMPTS} AND (status='cleaning' OR ${candidateActive}) RETURNING ${columns}`,
        )
        .bind(token, now + LEASE_MS, now, id, now, now, now)
        .first();
      return row ? candidateSchema.parse(row) : null;
    },
    async checkpoint(
      row: Candidate,
      patch: {
        cursor: string;
        pageIndex: number;
        outputCount: number;
        status: Candidate["status"];
      },
    ) {
      if (patch.cursor.length > 32768)
        throw new Error("Cursor exceeds envelope");
      const now = Date.now();
      const result = await db
        .prepare(
          `UPDATE publication_candidate SET cursor=?,output_count=?,page_index=?,status=?,cleaned_at=CASE WHEN ?='cleaned' THEN coalesce(cleaned_at,?) ELSE cleaned_at END,sequence=sequence+1,lease_token=NULL,lease_until=0,attempts=0,next_attempt_at=?,updated_at=? WHERE id=? AND sequence=? AND lease_token=? AND lease_until>? AND status=? AND (status='cleaning' OR ${candidateActive}) AND (?!='ready' OR (facts=(SELECT ${publicationFacts} FROM portfolio p WHERE p.id=publication_candidate.portfolio_id) AND NOT EXISTS(SELECT 1 FROM publication_transfer t LEFT JOIN asset a ON a.id=t.asset_id WHERE t.candidate_id=publication_candidate.id AND (t.complete!=1 OR a.id IS NULL OR a.portfolio_id!=publication_candidate.portfolio_id OR a.status!='ready' OR a.kind!=t.purpose OR a.bytes!=t.bytes OR a.content_type!=t.content_type)))) RETURNING id`,
        )
        .bind(
          patch.cursor,
          patch.outputCount,
          patch.pageIndex,
          patch.status,
          patch.status,
          now,
          now,
          now,
          row.id,
          row.sequence,
          row.lease_token,
          now,
          row.status,
          patch.status,
        )
        .first();
      if (!result && patch.status === "ready")
        throw new Error("Mutable publication facts changed before sealing");
      return !!result;
    },
    async retry(row: Candidate, error: string) {
      const now = Date.now();
      const result = await db
        .prepare(
          `UPDATE publication_candidate SET last_error=?,status=CASE WHEN attempts>=${MAX_ATTEMPTS} OR deadline_at<=? THEN 'failed' ELSE status END,lease_token=NULL,lease_until=0,next_attempt_at=?,updated_at=? WHERE id=? AND sequence=? AND lease_token=? AND status=? RETURNING id`,
        )
        .bind(
          (row.status === "cleaning" ? `cleanup:${error}` : error).slice(
            0,
            256,
          ),
          now,
          now + Math.min(300_000, 1000 * 2 ** Math.max(0, row.attempts - 1)),
          now,
          row.id,
          row.sequence,
          row.lease_token,
          row.status,
        )
        .first();
      return !!result;
    },
    async fail(id: string, reason: string) {
      await db
        .prepare(
          "UPDATE publication_candidate SET status='failed',lease_token=NULL,last_error=?,updated_at=? WHERE id=? AND status NOT IN ('ready','cleaned')",
        )
        .bind(reason.slice(0, 256), Date.now(), id)
        .run();
    },
    async sweep(queue: Queue<Wake>, limit = 8) {
      const now = Date.now();
      await db
        .prepare(
          `UPDATE publication_candidate SET status='failed',last_error=CASE WHEN status='cleaning' THEN 'cleanup:expired' ELSE 'expired_or_deleted' END,updated_at=? WHERE id IN (SELECT id FROM publication_candidate WHERE status IN ('preparing','assembling','transferring','cleaning','ready') AND ${candidateUnretained} AND ((status!='ready' AND (deadline_at<=? OR (attempts>=${MAX_ATTEMPTS} AND lease_until<=?))) OR (status='ready' AND updated_at<=? ) OR (status!='cleaning' AND NOT ${candidateActive})) ORDER BY next_attempt_at LIMIT ?)`,
        )
        .bind(now, now, now, now - PUBLICATION_READY_MS, limit)
        .run();
      const rows = await db
        .prepare(
          `SELECT id FROM publication_candidate WHERE status IN ('preparing','assembling','transferring','cleaning') AND next_attempt_at<=? AND lease_until<=? ORDER BY next_attempt_at LIMIT ?`,
        )
        .bind(now, now, limit)
        .all<{ id: string }>();
      for (const row of rows.results) await queue.send({ candidateId: row.id });
      return rows.results.length;
    },
    async startCleanup(id: string) {
      const now = Date.now();
      return !!(await db
        .prepare(
          `UPDATE publication_candidate SET status='cleaning',cursor='[]',attempts=0,deadline_at=?,next_attempt_at=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND status IN ('failed','ready') AND lease_until<? AND ${candidateUnretained} RETURNING id`,
        )
        .bind(now + DEADLINE_MS, now, now, id, now - 30_000)
        .first());
    },
  };
}
