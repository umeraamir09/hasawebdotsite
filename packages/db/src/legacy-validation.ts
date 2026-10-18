import {
  DRAFT_MAX_BYTES,
  type DraftPath,
  EMAIL_MAX_BYTES,
  inspectionDestination,
  inspectionFreeText,
  inspectionSchema,
  JSON_MAX_DEPTH,
  type LegacyValidationIssue,
  resolveDraftPath,
  schemaDefinition,
  sqlJsonPath,
  URL_MAX_BYTES,
  unwrapSchema,
  validateDestination,
} from "@hasaweb/schema";
import { draftInvariants, SaveError, saveDigest } from "./bounded-save";
import { activeSaveSession, saveSessionParams } from "./draft-api";
import type { SessionIdentity } from "./repositories";

// A single path plus child positions avoids retaining every ancestor path.
type Cursor = {
  path: DraftPath;
  next: number[];
  frames: (string | number | null)[];
};
type Issue = LegacyValidationIssue;
type ValidationAttempt = {
  id: string;
  sequence: number;
  base_revision: number;
  state: string;
  validation_cursor: string | null;
  validation_complete: number;
  validation_issue: string | null;
  last_hash: string | null;
};
type Node = {
  type: string | null;
  bytes: number;
  length: number;
  value: unknown;
  discriminator: string | null;
  keys: string[] | null;
  duplicate: number;
  bad: number;
  linkKind: string | null;
};
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).length;
const initial = (): Cursor => ({ path: [], next: [-1], frames: [null] });
// Cache checked ancestor metadata and use one descriptor query per new node.
// The deployed 16-node/repeated-read version exceeded the Free CPU target.
const STEP_NODES = 4;

export function legacyValidation(db: D1Database, identity: SessionIdentity) {
  identity = {
    user: { id: identity.user.id },
    session: { id: identity.session.id },
  };
  const session = () => saveSessionParams(identity);
  const access = `user_id=? AND ${activeSaveSession}`;
  const params = () => [identity.user.id, ...session()];
  const current = async (id: string) => {
    const row = await db
      .prepare(
        `SELECT id,sequence,base_revision,state,validation_cursor,validation_complete,validation_issue,last_hash FROM owner_save_attempt WHERE id=? AND context='validation' AND session_id=? AND expires_at>? AND ${access}`,
      )
      .bind(id, identity.session.id, Date.now(), ...params())
      .first<ValidationAttempt>();
    if (!row)
      throw new SaveError(
        409,
        "Validation attempt unavailable",
        "attempt_unavailable",
      );
    return row;
  };
  const writable = (row: ValidationAttempt, sequence: number) => {
    if (row.sequence !== sequence || row.state !== "open")
      throw new SaveError(
        409,
        "Validation attempt changed",
        "attempt_conflict",
      );
  };
  async function begin(revision: number) {
    const id = crypto.randomUUID();
    const row = await db
      .prepare(`INSERT INTO owner_save_attempt(id,user_id,session_id,base_revision,draft,progress,expires_at,context,validation_cursor)
      SELECT ?,user_id,?,draft_rev,CASE WHEN json_extract(draft,'$.schemaVersion')=1 THEN json_set(draft,'$.schemaVersion',2) ELSE draft END,setup_progress,?,'validation',?
      FROM portfolio WHERE draft_rev=? AND draft_validation_version!=2 AND json_type(draft,'$.schemaVersion') IN ('integer','real') AND json_extract(draft,'$.schemaVersion') IN (1,2)
      AND NOT(json_extract(draft,'$.schemaVersion')=1 AND json_type(draft,'$.requestedSubdomain') IS NOT NULL)
      AND ${access} ON CONFLICT(user_id) DO NOTHING RETURNING id,sequence`)
      .bind(
        id,
        identity.session.id,
        Date.now() + 3600000,
        JSON.stringify(initial()),
        revision,
        ...params(),
      )
      .first<{ id: string; sequence: number }>();
    if (!row)
      throw new SaveError(
        409,
        "Draft changed, unsupported or existing attempt requires recovery",
        "save_rejected",
      );
    return row;
  }
  async function step(id: string, sequence: number) {
    const row = await current(id);
    if (sequence === row.sequence - 1 && row.last_hash === "validation-step")
      return {
        sequence: row.sequence,
        complete: Boolean(row.validation_complete),
        issue: row.validation_issue
          ? (JSON.parse(row.validation_issue) as Issue)
          : null,
        replayed: true,
      };
    writable(row, sequence);
    if (row.validation_issue || row.validation_complete)
      return {
        sequence,
        complete: Boolean(row.validation_complete),
        issue: row.validation_issue
          ? (JSON.parse(row.validation_issue) as Issue)
          : null,
      };
    let cursor = JSON.parse(
      row.validation_cursor ?? JSON.stringify(initial()),
    ) as Cursor;
    // An older internal traversal cursor can safely restart, never skip checks.
    if (!cursor.frames) cursor = initial();
    let used = bytes(JSON.stringify(row)),
      examined = 0,
      issue: Issue | null = null;
    // Deep schema paths cost more to resolve even with cached lazy schemas.
    // Keep their per-request CPU below the same budget as shallow traversal.
    const nodeBudget = cursor.path.length > 24 ? 2 : STEP_NODES;
    const remaining = () => 4096 - used;
    const pop = () => {
      cursor.path.pop();
      cursor.next.pop();
      cursor.frames.pop();
    };
    const types = (): Record<string, unknown> =>
      Object.fromEntries(
        cursor.frames.flatMap((value, i) =>
          typeof value === "string"
            ? [[sqlJsonPath(cursor.path.slice(0, i)), value]]
            : [],
        ),
      );
    while (cursor.next.length && examined < nodeBudget && remaining() > 256) {
      const path = cursor.path,
        depth = cursor.next.length - 1;
      if (path.length > JSON_MAX_DEPTH) {
        issue = { path: [...path], code: "invalid_structure" };
        break;
      }
      const pathSql = sqlJsonPath(path),
        discriminators = types();
      try {
        // Returning from a child does not reread or revalidate the parent.
        if ((cursor.next[depth] ?? -1) >= 0) {
          const def = schemaDefinition(inspectionSchema(path, discriminators)),
            index = cursor.next[depth] ?? 0;
          let child: string | number | undefined;
          if (def.type === "object")
            child = Object.keys(def.shape ?? {})[index];
          else if (def.type === "array" || def.type === "tuple") {
            if (index < Number(cursor.frames[depth])) child = index;
          } else if (
            def.type === "record" &&
            index < Number(cursor.frames[depth])
          ) {
            const entry = await db
              .prepare(
                `SELECT (SELECT key FROM json_each(draft,?) ORDER BY key LIMIT 1 OFFSET ?) AS key FROM owner_save_attempt WHERE id=? AND sequence=? AND session_id=? AND context='validation' AND state='open' AND expires_at>? AND ${access}`,
              )
              .bind(
                pathSql,
                index,
                id,
                sequence,
                identity.session.id,
                Date.now(),
                ...params(),
              )
              .first<{ key: string }>();
            if (!entry)
              throw new SaveError(
                409,
                "Validation attempt changed",
                "attempt_conflict",
              );
            if (bytes(entry.key) > remaining()) break;
            used += bytes(entry.key);
            def.keyType?.parse(entry.key);
            child = entry.key;
          }
          if (child === undefined) {
            pop();
            continue;
          }
          cursor.next[depth] = index + 1;
          cursor.path.push(child);
          cursor.next.push(-1);
          cursor.frames.push(null);
          continue;
        }
        const original = resolveDraftPath(path, discriminators, true);
        const originalDef = schemaDefinition(unwrapSchema(original));
        const record = originalDef.type === "record";
        const wantString =
          inspectionDestination(path) || !inspectionFreeText(original);
        const kindPath =
          path[0] === "links" && typeof path[1] === "number"
            ? `$.links[${path[1]}].kind`
            : "$.__missing";
        const stringLimit =
          path.length === 3 && path[0] === "links" && path[2] === "value"
            ? `(CASE WHEN json_extract(draft,?10)='email' THEN ${EMAIL_MAX_BYTES} ELSE ${URL_MAX_BYTES} END)`
            : String(URL_MAX_BYTES);
        // Keep free text inside D1. Raw scalar is a separate column so its byte
        // budget counts decoded UTF-8, including maximum escaped destinations.
        const descriptor = await db
          .prepare(`WITH node AS MATERIALIZED (
          SELECT draft,json_type(draft,?1) AS t,json_extract(draft,?1) AS node_value FROM owner_save_attempt
          WHERE id=?2 AND sequence=?3 AND session_id=?4 AND context='validation' AND state='open' AND expires_at>?5 AND ${access}
        ), details AS MATERIALIZED (SELECT *,
          CASE WHEN t='text' THEN length(CAST(node_value AS BLOB)) ELSE 0 END AS b,
          CASE WHEN t='array' THEN json_array_length(node_value) WHEN t='object' THEN (SELECT count(*) FROM json_each(node_value)) ELSE 0 END AS n,
          CASE WHEN t='object' THEN (SELECT count(*)-count(DISTINCT key) FROM json_each(node_value)) ELSE 0 END AS dup,
          CASE WHEN t='object' THEN (SELECT count(*) FROM json_each(node_value) WHERE length(CAST(key AS BLOB))>${record ? 160 : 32} OR key IN ('__proto__','prototype','constructor')) ELSE 0 END AS bad
          FROM node
        ), payload AS MATERIALIZED (SELECT *,json_object(
          'type',t,'bytes',b,'length',n,'value',CASE WHEN t IN ('integer','real') THEN node_value ELSE NULL END,
          'discriminator',CASE WHEN t='object' AND json_type(node_value,'$.type')='text' AND length(CAST(json_extract(node_value,'$.type') AS BLOB))<=32 THEN json_extract(node_value,'$.type') ELSE NULL END,
          'keys',CASE WHEN t='object' AND n<=16 AND bad=0 AND ${record ? 0 : 1} THEN json((SELECT json_group_array(key) FROM json_each(node_value))) ELSE NULL END,
          'duplicate',dup,'bad',bad,
          'linkKind',CASE WHEN length(CAST(json_extract(draft,?10) AS BLOB))<=128 THEN json_extract(draft,?10) ELSE NULL END
        ) AS meta FROM details)
        SELECT CASE WHEN length(CAST(meta AS BLOB)) + CASE WHEN ${wantString ? 1 : 0} AND t='text' AND b<=${stringLimit} THEN b ELSE 0 END <=?11 THEN meta ELSE NULL END AS meta,
          CASE WHEN ${wantString ? 1 : 0} AND t='text' AND b<=${stringLimit} AND length(CAST(meta AS BLOB))+b<=?11 THEN node_value ELSE NULL END AS scalar FROM payload`)
          .bind(
            pathSql,
            id,
            sequence,
            identity.session.id,
            Date.now(),
            ...params(),
            kindPath,
            remaining(),
          )
          .first<{ meta: string | null; scalar: string | null }>();
        if (!descriptor)
          throw new SaveError(
            409,
            "Validation attempt changed",
            "attempt_conflict",
          );
        if (descriptor.meta === null) break;
        const node = JSON.parse(descriptor.meta) as Node;
        used +=
          bytes(descriptor.meta) +
          (descriptor.scalar === null ? 0 : bytes(descriptor.scalar));
        examined++;
        if (node.type === null) {
          if (!original.safeParse(undefined).success)
            throw new Error("Required field");
          pop();
          continue;
        }
        discriminators[pathSql] = node.discriminator;
        const schema = inspectionSchema(path, discriminators, node.linkKind),
          def = schemaDefinition(schema);
        if (def.type === "object" || def.type === "record") {
          if (node.type !== "object" || node.bad || node.duplicate)
            throw new Error("Invalid object");
          if (
            def.type === "object" &&
            (!node.keys ||
              node.keys.some((key) => !Object.hasOwn(def.shape ?? {}, key)))
          )
            throw new Error("Unexpected object key");
          cursor.frames[depth] =
            def.type === "record" ? node.length : node.discriminator;
          cursor.next[depth] = 0;
        } else if (def.type === "array" || def.type === "tuple") {
          if (node.type !== "array") throw new Error("Expected array");
          if (
            def.type === "tuple" &&
            (node.length < (def.items?.length ?? 0) ||
              (!def.rest && node.length !== def.items?.length))
          )
            throw new Error("Invalid tuple length");
          for (const check of def.checks ?? []) {
            const rule = check._zod.def;
            if (
              (rule.check === "min_length" &&
                node.length < (rule.minimum ?? 0)) ||
              (rule.check === "max_length" &&
                node.length > (rule.maximum ?? Infinity))
            )
              throw new Error("Invalid array length");
          }
          cursor.frames[depth] = node.length;
          cursor.next[depth] = 0;
        } else {
          if (inspectionFreeText(schema)) {
            if (node.type !== "text") throw new Error("Expected text");
            schema.parse(node.bytes ? "x" : "");
          } else if (node.type === "text") {
            if (node.bytes > 2048 || descriptor.scalar === null)
              throw new Error("Invalid constrained string");
            schema.parse(descriptor.scalar);
          } else
            schema.parse(
              node.type === "true"
                ? true
                : node.type === "false"
                  ? false
                  : node.value,
            );
          pop();
        }
      } catch (error) {
        if (
          error instanceof SaveError ||
          (error instanceof Error && error.message.startsWith("D1_"))
        )
          throw error;
        issue = {
          path: [...path],
          code: inspectionDestination(path)
            ? "invalid_destination"
            : "invalid_structure",
        };
        break;
      }
    }
    // Empty checked containers need no further request just to pop frames.
    while (cursor.next.length && (cursor.next.at(-1) ?? -1) >= 0) {
      const depth = cursor.next.length - 1,
        def = schemaDefinition(inspectionSchema(cursor.path, types()));
      const count =
        def.type === "object"
          ? Object.keys(def.shape ?? {}).length
          : Number(cursor.frames[depth]);
      if ((cursor.next[depth] ?? 0) < count) break;
      pop();
    }
    let complete = !issue && cursor.next.length === 0;
    if (complete) {
      const valid = await db
        .prepare(
          `SELECT ${draftInvariants("draft")} AS valid FROM owner_save_attempt WHERE id=? AND sequence=? AND session_id=? AND context='validation' AND expires_at>? AND ${access}`,
        )
        .bind(id, sequence, identity.session.id, Date.now(), ...params())
        .first<{ valid: number }>();
      if (!valid?.valid) {
        complete = false;
        issue = { path: [], code: "invalid_references" };
      }
    }
    const result = await db
      .prepare(
        `UPDATE owner_save_attempt SET sequence=sequence+1,last_hash='validation-step',validation_cursor=?,validation_complete=?,validation_issue=? WHERE id=? AND sequence=? AND state='open' AND context='validation' AND session_id=? AND expires_at>? AND ${access} RETURNING sequence`,
      )
      .bind(
        JSON.stringify(cursor),
        complete ? 1 : 0,
        issue ? JSON.stringify(issue) : null,
        id,
        sequence,
        identity.session.id,
        Date.now(),
        ...params(),
      )
      .first<{ sequence: number }>();
    if (!result)
      throw new SaveError(
        409,
        "Validation attempt changed",
        "attempt_conflict",
      );
    return { ...result, complete, issue, examined, validationBytes: used };
  }
  async function correct(
    id: string,
    sequence: number,
    path: DraftPath,
    value: string,
  ) {
    const row = await current(id),
      hash = await saveDigest({ op: "validation-correct", path, value });
    if (sequence === row.sequence - 1 && row.last_hash === hash)
      return { sequence: row.sequence, replayed: true };
    writable(row, sequence);
    const issue = row.validation_issue
      ? (JSON.parse(row.validation_issue) as Issue)
      : null;
    if (
      issue?.code !== "invalid_destination" ||
      JSON.stringify(issue.path) !== JSON.stringify(path)
    )
      throw new SaveError(422, "Correct only the rejected destination");
    const kindPath =
      path[0] === "links" && typeof path[1] === "number"
        ? `$.links[${path[1]}].kind`
        : "$.__missing";
    const kind = await db
      .prepare(
        `SELECT CASE WHEN length(CAST(json_extract(draft,?) AS BLOB))<=128 THEN json_extract(draft,?) ELSE NULL END AS kind,length(CAST(json_set(draft,?,?) AS BLOB)) AS candidateBytes FROM owner_save_attempt WHERE id=? AND sequence=? AND session_id=? AND expires_at>? AND ${access}`,
      )
      .bind(
        kindPath,
        kindPath,
        sqlJsonPath(path),
        value,
        id,
        sequence,
        identity.session.id,
        Date.now(),
        ...params(),
      )
      .first<{ kind: string | null; candidateBytes: number }>();
    if (!kind) throw new SaveError(409, "Attempt changed", "attempt_conflict");
    validateDestination(path, value, kind.kind);
    if (kind.candidateBytes > DRAFT_MAX_BYTES)
      throw new SaveError(413, "Corrected draft exceeds byte limit");
    const result = await db
      .prepare(
        `UPDATE owner_save_attempt SET draft=json_set(draft,?,?),sequence=sequence+1,last_hash=?,validation_cursor=?,validation_issue=NULL,validation_complete=0 WHERE id=? AND sequence=? AND session_id=? AND context='validation' AND state='open' AND expires_at>? AND ${access} RETURNING sequence`,
      )
      .bind(
        sqlJsonPath(path),
        value,
        hash,
        JSON.stringify(initial()),
        id,
        sequence,
        identity.session.id,
        Date.now(),
        ...params(),
      )
      .first<{ sequence: number }>();
    if (!result)
      throw new SaveError(409, "Attempt changed", "attempt_conflict");
    return result;
  }
  async function commit(id: string, sequence: number) {
    const row = await current(id);
    if (row.sequence !== sequence)
      throw new SaveError(409, "Wrong attempt sequence", "attempt_conflict");
    if (row.state === "committed")
      return { revision: row.base_revision + 1, replayed: true };
    writable(row, sequence);
    if (!row.validation_complete || row.validation_issue)
      throw new SaveError(
        409,
        "Finish validation before committing",
        "validation_required",
      );
    const selection = `SELECT draft FROM owner_save_attempt WHERE id=? AND sequence=? AND session_id=? AND state='open' AND context='validation' AND validation_complete=1 AND validation_issue IS NULL AND expires_at>? AND ${access}`;
    const update = db
      .prepare(
        `WITH candidate(draft) AS MATERIALIZED (${selection}) UPDATE portfolio SET draft=(SELECT draft FROM candidate),draft_validation_version=2,draft_rev=draft_rev+1,updated_at=? WHERE draft_rev=? AND draft_validation_version!=2 AND (SELECT draft FROM candidate) IS NOT NULL AND ${access} RETURNING draft_rev AS revision`,
      )
      .bind(
        id,
        sequence,
        identity.session.id,
        Date.now(),
        ...params(),
        Date.now(),
        row.base_revision,
        ...params(),
      );
    const mark = db
      .prepare(
        `UPDATE owner_save_attempt SET state='committed',draft=NULL,validation_cursor=NULL,validation_issue=NULL,last_hash=NULL WHERE id=? AND context='validation' AND state='open' AND changes()=1`,
      )
      .bind(id);
    const result = await db.batch([update, mark]);
    const saved = result[0]?.results[0];
    if (!saved)
      throw new SaveError(
        409,
        "Draft changed during validation",
        "revision_conflict",
      );
    return saved;
  }
  return { begin, step, correct, commit };
}
