import {
  type SaveAttemptStatus,
  type SaveContext,
  setupProgressSchema,
} from "@hasaweb/schema";
import { type Attempt, boundedSaves, SaveError } from "./bounded-save";
import type { SessionIdentity } from "./repositories";

const responseEncoder = new TextEncoder();
const RESPONSE_CHARACTERS = 65_536;

export const activeSaveSession = `EXISTS(SELECT 1 FROM session s JOIN user u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.deleting_at IS NULL)`;
export const saveSessionParams = (identity: SessionIdentity) => [
  identity.session.id,
  identity.user.id,
  Date.now(),
];
export async function assertSaveSession(
  db: D1Database,
  identity: SessionIdentity,
) {
  const row = await db
    .prepare(`SELECT ${activeSaveSession} AS active`)
    .bind(...saveSessionParams(identity))
    .first<{ active: number }>();
  if (!row?.active)
    throw new SaveError(401, "Owner unavailable", "unauthorized");
}
export function publicAttempt(
  row: Attempt | Record<string, unknown> | null,
): SaveAttemptStatus | null {
  if (!row) return null;
  return {
    id: String(row.id),
    baseRevision: Number(row.base_revision),
    sequence: Number(row.sequence),
    state: row.state as SaveAttemptStatus["state"],
    context: row.context as SaveContext,
    expiresAt: Number(row.expires_at),
    requiresResume: Boolean("requiresResume" in row && row.requiresResume),
    pieceCount: Number(row.piece_count),
    stringPath: row.string_path as string | null,
    validationComplete: Boolean(row.validation_complete),
    validationIssue: row.validation_issue
      ? JSON.parse(String(row.validation_issue))
      : null,
  };
}
export function ownerDrafts(db: D1Database, identity: SessionIdentity) {
  identity = {
    user: { id: identity.user.id },
    session: { id: identity.session.id },
  };
  const engines = new Map<
    "setup" | "content",
    ReturnType<typeof boundedSaves>
  >();
  const saves = (context: "setup" | "content") => {
    let engine = engines.get(context);
    if (engine) return engine;
    engine = boundedSaves(db, identity, {
      table: "portfolio",
      owner: "user_id",
      revision: "draft_rev",
      draft: "draft",
      progress: "setup_progress",
      setupMilestone: "first_editor_entered_at",
      validationVersion: "draft_validation_version",
      updatedAt: "updated_at",
      context,
    });
    engines.set(context, engine);
    return engine;
  };
  const unavailable = async (): Promise<never> => {
    // Only failure paths need this query. Each successful operation already
    // checks active access in its own SQL statement.
    await assertSaveSession(db, identity);
    throw new SaveError(404, "Portfolio unavailable", "not_found");
  };
  const metadata = async () => {
    const row = await db
      .prepare(
        `SELECT id AS portfolioId,draft_rev AS revision,setup_progress AS progress,first_editor_entered_at AS firstEditorEnteredAt FROM portfolio WHERE user_id=? AND ${activeSaveSession}`,
      )
      .bind(identity.user.id, ...saveSessionParams(identity))
      .first<{
        portfolioId: string;
        revision: number;
        progress: string;
        firstEditorEnteredAt: number | null;
      }>();
    if (!row) return unavailable();
    return {
      ...row,
      progress: setupProgressSchema.parse(JSON.parse(row.progress)),
    };
  };
  async function read(recovery = false) {
    const supported = `(json_type(draft,'$.schemaVersion') IN ('integer','real') AND json_extract(draft,'$.schemaVersion') IN (1,2))`;
    const rows = await db
      .prepare(`WITH RECURSIVE snapshot AS MATERIALIZED (SELECT draft_validation_version AS generation,${supported} AS supported,
      CASE WHEN ${recovery ? "1" : `draft_validation_version=2 AND ${supported}`} THEN
        json_object('portfolioId',id,'revision',draft_rev,'progress',json(setup_progress),'firstEditorEnteredAt',first_editor_entered_at,'draft',json(${recovery ? "draft" : "CASE WHEN json_extract(draft,'$.schemaVersion')=1 THEN json_set(draft,'$.schemaVersion',2) ELSE draft END"}))
      END AS body FROM portfolio WHERE user_id=? AND ${activeSaveSession}),
      bounded AS MATERIALIZED (SELECT *,length(body) AS chars FROM snapshot),
      offsets(n) AS (SELECT 1 UNION ALL SELECT n+${RESPONSE_CHARACTERS} FROM offsets,bounded WHERE n+${RESPONSE_CHARACTERS}<=chars)
      SELECT generation,supported,substr(body,n,${RESPONSE_CHARACTERS}) AS chunk FROM bounded,offsets ORDER BY n`)
      .bind(identity.user.id, ...saveSessionParams(identity))
      .raw<[number, number, string | null]>();
    const row = rows[0];
    if (!row) {
      return unavailable();
    }
    if (!row[1] && !recovery)
      throw new SaveError(409, "Unsupported draft", "unsupported_version");
    if (row[2] === null)
      throw new SaveError(
        409,
        "Stored draft requires validation",
        "validation_required",
      );
    // Forward D1's response text without constructing another whole-document
    // JS string/byte buffer. SQL substr counts Unicode code points, so a chunk
    // cannot split a surrogate pair. All chunks belong to this one snapshot.
    let index = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = rows[index++]?.[2];
        if (chunk !== null && chunk !== undefined)
          controller.enqueue(responseEncoder.encode(chunk));
        if (index >= rows.length) {
          rows.length = 0;
          controller.close();
        }
      },
      cancel() {
        rows.length = 0;
      },
    });
  }
  return { saves, metadata, read };
}
