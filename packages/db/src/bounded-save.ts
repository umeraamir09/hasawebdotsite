import {
  DRAFT_MAX_BYTES,
  type DraftPath,
  encodeJson,
  freeStringMinimum,
  SAVE_MAX_PIECES,
  SAVE_PIECE_BYTES,
  type SaveContext,
  type SaveErrorCode,
  setupProgressSchema,
  sqlJsonPath,
  validateAppend,
  validateDraftValue,
  validateRemove,
} from "@hasaweb/schema";
import type { SessionIdentity } from "./repositories";

export class SaveError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: SaveErrorCode = status === 413
      ? "byte_limit"
      : status === 422
        ? "invalid_input"
        : "save_rejected",
  ) {
    super(message);
  }
}
export type SaveTarget = {
  context?: Exclude<SaveContext, "validation">;
  table: string;
  owner: string;
  revision: string;
  draft: string;
  progress: string;
  // Setup writes are denied permanently after the trusted first handoff.
  setupMilestone?: string;
  validationVersion?: string;
  updatedAt?: string;
};
export type SaveChange =
  | { op: "set"; path: DraftPath; value: unknown }
  | { op: "append"; path: DraftPath; values: unknown[] }
  | { op: "remove"; path: DraftPath };
export type Attempt = {
  validation_complete: number;
  validation_issue: string | null;
  context: SaveContext;
  expires_at: number;
  id: string;
  base_revision: number;
  sequence: number;
  last_hash: string | null;
  state: string;
  piece_count: number;
  string_path: string | null;
  string_minimum: number | null;
  string_chars: number;
  string_bytes: number;
  last_code_unit: number | null;
};
const TTL = 60 * 60 * 1000;
const identifier = (value: string) => {
  if (!/^[a-z_]+$/.test(value))
    throw new Error("Invalid configured SQL identifier");
  return `"${value}"`;
};
// Cross-document refinements which a small replacement cannot establish alone.
// All scalar/shape rules are enforced by the shared schemas before SQL receives a change.
export function draftInvariants(doc: string) {
  const unique = (array: string, field: string) =>
    `(SELECT count(*) FROM json_each(${array})) = (SELECT count(DISTINCT json_extract(value,'$.${field}')) FROM json_each(${array}))`;
  return `
    length(CAST(${doc} AS BLOB)) <= ${DRAFT_MAX_BYTES}
    AND ${unique(`json_extract(${doc},'$.links')`, "id")}
    AND ${unique(`json_extract(${doc},'$.components')`, "id")}
    AND NOT EXISTS (SELECT 1 FROM json_each(${doc},'$.components') GROUP BY json_extract(value,'$.type') HAVING json_extract(value,'$.type') != 'text' AND count(*) > 1)
    AND NOT EXISTS (SELECT 1 FROM json_each(${doc},'$.samples') m WHERE
      (substr(m.key,1,8) = 'profile.' AND json_type(${doc},'$.profile.' || substr(m.key,9)) IS NULL)
      OR (substr(m.key,1,11) = 'components.' AND NOT EXISTS (SELECT 1 FROM json_each(${doc},'$.components') c WHERE json_extract(c.value,'$.id') = substr(m.key,12))))
    AND NOT EXISTS (SELECT 1 FROM json_each(${doc},'$.components') c WHERE
      NOT (${unique("json_extract(c.value,'$.data.entries')", "id")})
      OR NOT (${unique("json_extract(c.value,'$.data.categories')", "id")})
      OR (json_extract(c.value,'$.type') = 'projects' AND (SELECT count(*) FROM json_each(c.value,'$.data.entries') e WHERE json_type(e.value,'$.caseStudy') IS NOT NULL) != (SELECT count(DISTINCT json_extract(e.value,'$.caseStudy.slug')) FROM json_each(c.value,'$.data.entries') e))
      OR (json_extract(c.value,'$.type') = 'skills' AND EXISTS (SELECT 1 FROM json_each(c.value,'$.data.entries') e WHERE json_type(e.value,'$.categoryId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM json_each(c.value,'$.data.categories') cat WHERE json_extract(cat.value,'$.id') = json_extract(e.value,'$.categoryId'))))
      OR (json_extract(c.value,'$.type') = 'work-experience' AND EXISTS (SELECT 1 FROM json_each(c.value,'$.data.entries') e WHERE json_extract(e.value,'$.startDate') != '' AND json_extract(e.value,'$.endDate') != '' AND json_extract(e.value,'$.endDate') < json_extract(e.value,'$.startDate'))))`;
}
export async function saveDigest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
const digest = saveDigest;
function condition(params: unknown[]) {
  return (value: unknown) => {
    params.push(value);
    return `?${params.length}`;
  };
}

// The caller authenticates through Better Auth first. Identity is never taken
// from a request body. Every SQL read/write independently checks persisted access.
export function boundedSaves(
  db: D1Database,
  identity: SessionIdentity,
  target: SaveTarget,
) {
  identity = {
    user: { id: identity.user.id },
    session: { id: identity.session.id },
  };
  const table = identifier(target.table),
    owner = identifier(target.owner),
    rev = identifier(target.revision),
    draft = identifier(target.draft),
    progress = identifier(target.progress);
  const context = target.context ?? "setup";
  const authenticated = (arg: ReturnType<typeof condition>) =>
    `EXISTS (SELECT 1 FROM session s JOIN user u ON u.id=s.user_id WHERE s.id=${arg(identity.session.id)} AND s.user_id=${arg(identity.user.id)} AND s.expires_at>${arg(Date.now())} AND u.deleting_at IS NULL)`;
  const active = (arg: ReturnType<typeof condition>) =>
    authenticated(arg) +
    (target.setupMilestone && context === "setup"
      ? ` AND EXISTS (SELECT 1 FROM ${table} p WHERE p.${owner}=${arg(identity.user.id)} AND p.${identifier(target.setupMilestone)} IS NULL)`
      : "");
  const canonicalReady = (arg: ReturnType<typeof condition>) =>
    target.validationVersion
      ? ` AND EXISTS (SELECT 1 FROM ${table} p WHERE p.${owner}=${arg(identity.user.id)} AND p.${identifier(target.validationVersion)}=2 AND json_type(p.${draft},'$.schemaVersion') IN ('integer','real') AND json_extract(p.${draft},'$.schemaVersion') IN (1,2))`
      : "";
  const encodeProgress = (value: unknown) => {
    encodeJson(value, SAVE_PIECE_BYTES);
    return encodeJson(
      target.setupMilestone ? setupProgressSchema.parse(value) : value,
      SAVE_PIECE_BYTES,
    );
  };
  const checkRevision = (value: number) => {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value >= Number.MAX_SAFE_INTEGER
    )
      throw new SaveError(422, "Invalid revision");
  };
  async function attempt(id: string, writing = false): Promise<Attempt> {
    const params: unknown[] = [];
    const arg = condition(params);
    const row = await db
      .prepare(
        `SELECT id,context,expires_at,base_revision,sequence,last_hash,state,piece_count,string_path,string_minimum,string_chars,string_bytes,last_code_unit,validation_complete,validation_issue FROM owner_save_attempt WHERE id=${arg(id)} AND user_id=${arg(identity.user.id)} AND session_id=${arg(identity.session.id)} AND expires_at>${arg(Date.now())} AND ${writing ? `${active(arg)} AND context=${arg(context)}` : authenticated(arg)}`,
      )
      .bind(...params)
      .first<Attempt>();
    if (!row && writing && target.setupMilestone && context === "setup") {
      const held = await attempt(id);
      if (held.context === "setup") return rejectSave(held.base_revision);
    }
    if (!row)
      throw new SaveError(
        409,
        "Attempt unavailable, expired or revoked",
        "attempt_unavailable",
      );
    return row;
  }
  async function pending() {
    const params: unknown[] = [];
    const arg = condition(params);
    return db
      .prepare(
        `SELECT id,context,base_revision,sequence,state,piece_count,string_path,expires_at,validation_complete,validation_issue,session_id!=${arg(identity.session.id)} AS requiresResume FROM owner_save_attempt WHERE user_id=${arg(identity.user.id)} AND expires_at>${arg(Date.now())} AND ${authenticated(arg)}`,
      )
      .bind(...params)
      .first<Record<string, unknown>>();
  }
  async function resume(id: string) {
    const params: unknown[] = [];
    const arg = condition(params);
    await db
      .prepare(
        `UPDATE owner_save_attempt SET session_id=${arg(identity.session.id)},sequence=sequence+1,last_hash=NULL WHERE id=${arg(id)} AND user_id=${arg(identity.user.id)} AND session_id!=${arg(identity.session.id)} AND expires_at>${arg(Date.now())} AND state IN ('open','string') AND ${authenticated(arg)}`,
      )
      .bind(...params)
      .run();
    return attempt(id);
  }
  async function begin(revision: number, proposedProgress: unknown) {
    checkRevision(revision);
    const encoded =
      context === "content" ? null : encodeProgress(proposedProgress);
    const id = crypto.randomUUID();
    const params: unknown[] = [];
    const arg = condition(params);
    const result = await db
      .prepare(`INSERT INTO owner_save_attempt(id,user_id,session_id,base_revision,draft,progress,expires_at,context)
      SELECT ${arg(id)},${arg(identity.user.id)},${arg(identity.session.id)},${arg(revision)},${sourceDraft()},${context === "content" ? progress : arg(encoded)},${arg(Date.now() + TTL)},${arg(context)} FROM ${table}
      WHERE ${owner}=${arg(identity.user.id)} AND ${rev}=${arg(revision)} AND ${active(arg)}${canonicalReady(arg)}
      ON CONFLICT(user_id) DO NOTHING RETURNING id,sequence`)
      .bind(...params)
      .first<{ id: string; sequence: number }>();
    if (!result) return rejectSave(revision);
    return result;
  }
  function sourceDraft() {
    // v1 -> v2 only changes the single-digit envelope version. D1 performs the
    // upgrade without reading a large body into Worker JS or growing its size.
    return target.setupMilestone || target.validationVersion
      ? `CASE WHEN json_extract(${draft},'$.schemaVersion')=1 THEN json_set(${draft},'$.schemaVersion',2) ELSE ${draft} END`
      : draft;
  }
  async function rejectSave(revision: number): Promise<never> {
    const params: unknown[] = [];
    const arg = condition(params);
    const row = await db
      .prepare(
        `SELECT ${rev} AS revision,${target.setupMilestone ? identifier(target.setupMilestone) : "NULL"} AS milestone,${target.validationVersion ? identifier(target.validationVersion) : "2"} AS generation,json_extract(${draft},'$.schemaVersion') AS version,json_type(${draft},'$.schemaVersion') AS versionType FROM ${table} WHERE ${owner}=${arg(identity.user.id)} AND ${authenticated(arg)}`,
      )
      .bind(...params)
      .first<{
        revision: number;
        milestone: number | null;
        generation: number;
        version: number;
        versionType: string;
      }>();
    if (!row) {
      // A live session with no portfolio row is a normal pre-provisioning
      // state, not an authentication failure. Only this failure path needs the
      // extra read, matching the consistent draft read.
      const sessionParams: unknown[] = [];
      const sessionArg = condition(sessionParams);
      const session = await db
        .prepare(`SELECT ${authenticated(sessionArg)} AS active`)
        .bind(...sessionParams)
        .first<{ active: number }>();
      if (!session?.active)
        throw new SaveError(401, "Owner unavailable", "unauthorized");
      throw new SaveError(404, "Portfolio unavailable", "not_found");
    }
    if (
      !["integer", "real"].includes(row.versionType) ||
      ![1, 2].includes(row.version)
    )
      throw new SaveError(409, "Unsupported draft", "unsupported_version");
    if (context === "setup" && row.milestone !== null)
      throw new SaveError(409, "Setup is closed", "setup_closed");
    if (row.revision !== revision)
      throw new SaveError(409, "Draft changed", "revision_conflict");
    if (row.generation !== 2)
      throw new SaveError(
        409,
        "Validate the stored draft first",
        "validation_required",
      );
    throw new SaveError(
      409,
      "Save rejected or existing attempt requires recovery",
      "save_rejected",
    );
  }
  async function saveProgress(revision: number, proposedProgress: unknown) {
    checkRevision(revision);
    if (context !== "setup")
      throw new SaveError(422, "Content saves cannot set progress");
    const encoded = encodeProgress(proposedProgress);
    const params: unknown[] = [];
    const arg = condition(params);
    const row = await db
      .prepare(
        `UPDATE ${table} SET ${draft}=${sourceDraft()},${progress}=${arg(encoded)},${rev}=${rev}+1${target.updatedAt ? `,${identifier(target.updatedAt)}=${arg(Date.now())}` : ""} WHERE ${owner}=${arg(identity.user.id)} AND ${rev}=${arg(revision)} AND ${active(arg)}${canonicalReady(arg)} RETURNING ${rev} AS revision`,
      )
      .bind(...params)
      .first<{ revision: number }>();
    if (!row) return rejectSave(revision);
    return row;
  }
  async function metadata(path: DraftPath, id?: string, revision = 0) {
    const params: unknown[] = [];
    const arg = condition(params);
    const pathSql = sqlJsonPath(path);
    const prefixes = path.map((_, index) => sqlJsonPath(path.slice(0, index)));
    prefixes.push(pathSql);
    const source = id ? "owner_save_attempt" : table;
    const sourceDraft = id ? "draft" : draft;
    const where = id
      ? `id=${arg(id)} AND user_id=${arg(identity.user.id)} AND session_id=${arg(identity.session.id)} AND state='open' AND expires_at>${arg(Date.now())}`
      : `${owner}=${arg(identity.user.id)}`;
    const row = await db
      .prepare(`SELECT
      (SELECT json_group_object(p.value,json_extract(s.${sourceDraft},p.value || '."type"')) FROM json_each(${arg(JSON.stringify(prefixes))}) p) AS types,
      json_type(s.${sourceDraft},${arg(pathSql)}) AS target_type,
      json_type(s.${sourceDraft},${arg(sqlJsonPath(path.slice(0, -1)))}) AS parent_type,
      json_array_length(s.${sourceDraft},${arg(pathSql)}) AS array_length,
      json_array_length(s.${sourceDraft},${arg(sqlJsonPath(path.slice(0, -1)))}) AS parent_length
      FROM ${source} s WHERE ${where} AND ${active(arg)}${id ? ` AND context=${arg(context)}` : canonicalReady(arg)}`)
      .bind(...params)
      .first<{
        types: string;
        target_type: string | null;
        parent_type: string | null;
        array_length: number | null;
        parent_length: number | null;
      }>();
    if (!row) {
      if (!id) return rejectSave(revision);
      throw new SaveError(409, "Missing active attempt", "attempt_unavailable");
    }
    return { ...row, types: JSON.parse(row.types) as Record<string, unknown> };
  }
  async function change(
    change: SaveChange,
    revision: number,
    proposedProgress: unknown,
    id?: string,
    sequence?: number,
  ) {
    checkRevision(revision);
    // Entire submitted work is bounded before any schema traversal or SQL generation.
    encodeJson(change, SAVE_PIECE_BYTES + 1024);
    const hash = await digest(change);
    if (id) {
      const state = await attempt(id, true);
      if (sequence === state.sequence - 1 && state.last_hash === hash)
        return { sequence: state.sequence, replayed: true };
      if (state.state !== "open" || sequence !== state.sequence)
        throw new SaveError(409, "Wrong attempt sequence/state");
    }
    const meta = await metadata(change.path, id, revision);
    if (
      change.path.length &&
      meta.parent_type !== "object" &&
      meta.parent_type !== "array"
    )
      throw new SaveError(422, "Missing parent");
    if (
      typeof change.path.at(-1) === "number" &&
      (change.path.at(-1) as number) >= (meta.parent_length ?? 0)
    )
      throw new SaveError(422, "Use append for a new array entry");
    let encoded: string[] = [];
    if (change.op === "set")
      encoded = [validateDraftValue(change.path, meta.types, change.value)];
    if (change.op === "append")
      encoded = validateAppend(
        change.path,
        meta.types,
        meta.array_length ?? 0,
        change.values,
      );
    if (change.op === "remove")
      validateRemove(change.path, meta.types, meta.parent_length ?? 0);
    const params: unknown[] = [];
    const arg = condition(params);
    const source = id ? "owner_save_attempt" : table,
      sourceDoc = id ? "draft" : sourceDraft();
    const pathSql = sqlJsonPath(change.path);
    let expression: string;
    if (change.op === "remove")
      expression = `json_remove(${sourceDoc},${arg(pathSql)})`;
    else if (change.op === "set")
      expression = change.path.length
        ? `json_set(${sourceDoc},${arg(pathSql)},json(${arg(encoded[0])}))`
        : `json(${arg(encoded[0])})`;
    else
      expression = `json_insert(${sourceDoc},${encoded.map((value) => `${arg(`${pathSql}[#]`)},json(${arg(value)})`).join(",")})`;
    const expected = id
      ? `id=${arg(id)} AND user_id=${arg(identity.user.id)} AND session_id=${arg(identity.session.id)} AND sequence=${arg(sequence)} AND state='open' AND expires_at>${arg(Date.now())}`
      : `${owner}=${arg(identity.user.id)} AND ${rev}=${arg(revision)}`;
    const access = active(arg) + (id ? "" : canonicalReady(arg));
    const encodedProgress =
      id || context === "content" ? "{}" : encodeProgress(proposedProgress);
    const assignments = id
      ? `draft=(SELECT doc FROM candidate),sequence=sequence+1,last_hash=${arg(hash)}`
      : `${draft}=(SELECT doc FROM candidate),${context === "content" ? "" : `${progress}=${arg(encodedProgress)},`}${rev}=${rev}+1${target.updatedAt ? `,${identifier(target.updatedAt)}=${arg(Date.now())}` : ""}`;
    const milestone =
      id || target.setupMilestone || target.validationVersion
        ? "1"
        : `(json_extract(${progress},'$.enteredEditor')=0 OR json_extract(${arg(encodedProgress)},'$.enteredEditor')=1)`;
    const result = await db
      .prepare(`WITH candidate(doc) AS MATERIALIZED (SELECT ${expression} FROM ${source} WHERE ${expected} AND ${access})
      UPDATE ${source} SET ${assignments} WHERE ${expected} AND ${access} AND ${milestone} AND ${draftInvariants("(SELECT doc FROM candidate)")}
      RETURNING ${id ? "sequence" : `${rev} AS revision`}`)
      .bind(...params)
      .first<Record<string, number>>();
    if (!result) {
      if (!id) return rejectSave(revision);
      throw new SaveError(
        409,
        "Stale attempt or invalid references",
        "attempt_conflict",
      );
    }
    return result;
  }
  async function stringStart(id: string, sequence: number, path: DraftPath) {
    const state = await attempt(id, true),
      hash = await digest({ op: "string-start", path });
    if (sequence === state.sequence - 1 && state.last_hash === hash)
      return { sequence: state.sequence, replayed: true };
    if (state.state !== "open" || state.sequence !== sequence)
      throw new SaveError(409, "Wrong sequence/state");
    const meta = await metadata(path, id);
    const minimum = freeStringMinimum(path, meta.types);
    if (meta.parent_type !== "object" && meta.parent_type !== "array")
      throw new SaveError(422, "Missing parent");
    if (
      typeof path.at(-1) === "number" &&
      (path.at(-1) as number) >= (meta.parent_length ?? 0)
    )
      throw new SaveError(422, "Missing array entry");
    const params: unknown[] = [];
    const arg = condition(params);
    const update = db
      .prepare(
        `UPDATE owner_save_attempt SET state='string',string_path=${arg(sqlJsonPath(path))},string_minimum=${arg(minimum)},piece_count=0,string_chars=0,string_bytes=2,last_code_unit=NULL,sequence=sequence+1,last_hash=${arg(hash)} WHERE id=${arg(id)} AND user_id=${arg(identity.user.id)} AND session_id=${arg(identity.session.id)} AND sequence=${arg(sequence)} AND state='open' AND expires_at>${arg(Date.now())} AND ${active(arg)} AND context=${arg(context)} RETURNING sequence`,
      )
      .bind(...params);
    const clear = db
      .prepare(
        "DELETE FROM owner_save_piece WHERE attempt_id=? AND EXISTS(SELECT 1 FROM owner_save_attempt WHERE id=? AND sequence=? AND state='string' AND last_hash=?)",
      )
      .bind(id, id, sequence + 1, hash);
    const results = await db.batch([update, clear]);
    const row = results[0]?.results[0];
    if (!row) throw new SaveError(409, "Attempt changed");
    return row;
  }
  async function stringPiece(id: string, sequence: number, text: string) {
    const json = encodeJson(text, SAVE_PIECE_BYTES),
      hash = await digest({ op: "piece", text });
    const state = await attempt(id, true);
    if (sequence === state.sequence - 1 && state.last_hash === hash)
      return { sequence: state.sequence, replayed: true };
    if (state.state !== "string" || state.sequence !== sequence || !text.length)
      throw new SaveError(409, "Wrong sequence/state or empty piece");
    if (state.piece_count >= SAVE_MAX_PIECES)
      throw new SaveError(413, "Too many pieces; restart with larger pieces");
    const first = text.charCodeAt(0);
    if (
      state.last_code_unit !== null &&
      state.last_code_unit >= 0xd800 &&
      state.last_code_unit <= 0xdbff &&
      first >= 0xdc00 &&
      first <= 0xdfff
    )
      throw new SaveError(422, "Keep a surrogate pair in the same piece");
    const bytes = new TextEncoder().encode(json).length - 2;
    if (state.string_bytes + bytes > DRAFT_MAX_BYTES)
      throw new SaveError(413, "String exceeds draft ceiling");
    const params: unknown[] = [];
    const arg = condition(params);
    const where = `id=${arg(id)} AND user_id=${arg(identity.user.id)} AND session_id=${arg(identity.session.id)} AND sequence=${arg(sequence)} AND state='string' AND expires_at>${arg(Date.now())} AND ${active(arg)} AND context=${arg(context)}`;
    const insert = db
      .prepare(
        `INSERT INTO owner_save_piece(attempt_id,n,data) SELECT id,piece_count,${arg(json)} FROM owner_save_attempt WHERE ${where}`,
      )
      .bind(...params);
    const p: unknown[] = [];
    const a = condition(p);
    const update = db
      .prepare(
        `UPDATE owner_save_attempt SET piece_count=piece_count+1,string_chars=string_chars+${a(text.length)},string_bytes=string_bytes+${a(bytes)},last_code_unit=${a(text.charCodeAt(text.length - 1))},sequence=sequence+1,last_hash=${a(hash)} WHERE id=${a(id)} AND sequence=${a(sequence)} AND changes()=1 RETURNING sequence`,
      )
      .bind(...p);
    const result = await db.batch([insert, update]);
    const row = result[1]?.results[0];
    if (!row) throw new SaveError(409, "Attempt changed");
    return row;
  }
  async function stringFinish(id: string, sequence: number) {
    const state = await attempt(id, true),
      hash = await digest({ op: "string-finish" });
    if (sequence === state.sequence - 1 && state.last_hash === hash)
      return { sequence: state.sequence, replayed: true };
    if (
      state.state !== "string" ||
      state.sequence !== sequence ||
      state.string_chars < (state.string_minimum ?? 0)
    )
      throw new SaveError(409, "Incomplete string or wrong sequence");
    const params: unknown[] = [];
    const arg = condition(params);
    const attemptId = arg(id),
      seq = arg(sequence),
      where = `id=${attemptId} AND user_id=${arg(identity.user.id)} AND session_id=${arg(identity.session.id)} AND sequence=${seq} AND state='string' AND expires_at>${arg(Date.now())} AND ${active(arg)} AND context=${arg(context)}`;
    // Concatenate canonical JSON string interiors in D1. Worker JS never reads
    // the assembled value. Ordering and the sequence/digest lock are server-owned.
    const assembled = `'"' || coalesce((SELECT group_concat(substr(data,2,length(data)-2),'') FROM (SELECT data FROM owner_save_piece WHERE attempt_id=${attemptId} ORDER BY n)),'') || '"'`;
    const update = db
      .prepare(`WITH candidate(doc) AS MATERIALIZED (SELECT json_set(draft,string_path,json(${assembled})) FROM owner_save_attempt WHERE ${where})
      UPDATE owner_save_attempt SET draft=(SELECT doc FROM candidate),state='open',sequence=sequence+1,last_hash=${arg(hash)} WHERE ${where} AND ${draftInvariants("(SELECT doc FROM candidate)")} RETURNING sequence`)
      .bind(...params);
    // Keep immutable pieces for retries until the next string starts or bounded
    // cleanup removes the attempt. Storage remains capped at one string/owner.
    const row = await update.first<{ sequence: number }>();
    if (!row) throw new SaveError(409, "Oversized, stale or invalid string");
    return row;
  }
  async function commit(id: string, sequence: number) {
    // A saved receipt remains readable after setup closes. The canonical
    // UPDATE below separately enforces the setup-write and session guards.
    const state = await attempt(id);
    if (state.sequence !== sequence)
      throw new SaveError(409, "Wrong attempt sequence", "attempt_conflict");
    if (state.state === "committed")
      return { revision: state.base_revision + 1, replayed: true };
    if (state.state !== "open" || state.sequence !== sequence)
      throw new SaveError(409, "Wrong sequence or unfinished string");
    const params: unknown[] = [];
    const arg = condition(params);
    const attemptId = arg(id);
    const selection = `SELECT a.draft FROM owner_save_attempt a WHERE a.id=${attemptId} AND a.user_id=${arg(identity.user.id)} AND a.session_id=${arg(identity.session.id)} AND a.sequence=${arg(sequence)} AND a.context=${arg(context)} AND a.state='open' AND a.expires_at>${arg(Date.now())}`;
    const update = db
      .prepare(`UPDATE ${table} SET ${draft}=(${selection}),${context === "content" ? "" : `${progress}=(SELECT a.progress FROM owner_save_attempt a WHERE a.id=${attemptId}),`}${rev}=${rev}+1${target.updatedAt ? `,${identifier(target.updatedAt)}=${arg(Date.now())}` : ""}
      WHERE ${owner}=${arg(identity.user.id)} AND ${rev}=${arg(state.base_revision)} AND (${selection}) IS NOT NULL AND ${active(arg)}${canonicalReady(arg)}
      AND ${target.setupMilestone || target.validationVersion ? "1" : `(json_extract(${progress},'$.enteredEditor')=0 OR json_extract((SELECT a.progress FROM owner_save_attempt a WHERE a.id=${attemptId}),'$.enteredEditor')=1)`} RETURNING ${rev} AS revision`)
      .bind(...params);
    const mark = db
      .prepare(
        "UPDATE owner_save_attempt SET state='committed',draft=NULL,last_hash=NULL WHERE id=? AND state='open' AND changes()=1",
      )
      .bind(id);
    const result = await db.batch([update, mark]);
    const row = result[0]?.results[0];
    if (!row) return rejectSave(state.base_revision);
    return row;
  }
  async function abort(id: string) {
    await attempt(id);
    const params: unknown[] = [];
    const arg = condition(params);
    const discarded = await db
      .prepare(
        `UPDATE owner_save_attempt SET state='aborted',draft=NULL,expires_at=${arg(Date.now() - 1)} WHERE id=${arg(id)} AND user_id=${arg(identity.user.id)} AND session_id=${arg(identity.session.id)} AND ${authenticated(arg)} RETURNING id`,
      )
      .bind(...params)
      .first();
    if (!discarded)
      throw new SaveError(409, "Attempt unavailable", "attempt_unavailable");
    return { aborted: true };
  }
  async function cleanup() {
    const params: unknown[] = [];
    const arg = condition(params);
    const expired = `SELECT id FROM owner_save_attempt WHERE user_id=${arg(identity.user.id)} AND (expires_at<=${arg(Date.now())} OR state IN ('committed','aborted') OR NOT EXISTS(SELECT 1 FROM session old WHERE old.id=owner_save_attempt.session_id AND old.user_id=owner_save_attempt.user_id AND old.expires_at>${arg(Date.now())})) AND ${authenticated(arg)}`;
    const pieces = await db
      .prepare(
        `DELETE FROM owner_save_piece WHERE rowid IN (SELECT rowid FROM owner_save_piece WHERE attempt_id IN (${expired}) LIMIT 32)`,
      )
      .bind(...params)
      .run();
    const attempts = await db
      .prepare(
        `DELETE FROM owner_save_attempt WHERE id IN (${expired}) AND NOT EXISTS(SELECT 1 FROM owner_save_piece WHERE attempt_id=owner_save_attempt.id)`,
      )
      .bind(...params)
      .run();
    return { pieces: pieces.meta.changes, attempts: attempts.meta.changes };
  }
  return {
    saveProgress,
    pending,
    resume,
    begin,
    change,
    stringStart,
    stringPiece,
    stringFinish,
    commit,
    abort,
    cleanup,
    status: attempt,
  };
}
