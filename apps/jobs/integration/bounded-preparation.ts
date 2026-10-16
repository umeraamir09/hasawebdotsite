// Fixed synthetic preparation operations for isolated measurements. This module
// is imported only by the keyed experiment entry, never a product handler.
import { privateJson } from "@hasaweb/db";
export async function prepareBounded(request: Request, db: D1Database) {
  const input = (await request.json()) as {
    operation: string;
    id?: string;
    template?: string;
  };
  const id = input.id ?? "";
  if (id && !/^[a-f\d-]{36}$/.test(id)) return privateJson(null, 400);
  const templates = ["full", "dense", "components"];
  const template = templates.includes(input.template ?? "")
    ? input.template
    : "full";
  switch (input.operation) {
    case "append":
      await db
        .prepare(
          "UPDATE owner_runtime_fixture SET draft=(SELECT json_set(draft,'$.profile.bio',substr(json_extract(draft,'$.profile.bio'),1,length(json_extract(draft,'$.profile.bio'))-4096)) FROM owner_runtime_template WHERE name='full') WHERE user_id='runtime-alice'",
        )
        .run();
      break;
    case "canonical":
      await db
        .prepare(
          "UPDATE owner_runtime_fixture SET draft=(SELECT draft FROM owner_runtime_template WHERE name=?) WHERE user_id='runtime-alice'",
        )
        .bind(template)
        .run();
      break;
    case "drop-attempt":
      await db
        .prepare("DELETE FROM owner_save_attempt WHERE user_id='runtime-alice'")
        .run();
      break;
    case "open":
      await db
        .prepare(
          "UPDATE owner_save_attempt SET state='open',draft=(SELECT draft FROM owner_runtime_template WHERE name=?),base_revision=(SELECT revision FROM owner_runtime_fixture WHERE user_id='runtime-alice'),expires_at=?,sequence=0,last_hash=NULL WHERE id=? AND user_id='runtime-alice'",
        )
        .bind(template, Date.now() + 3600000, id)
        .run();
      break;
    case "string":
      await db
        .prepare(
          "UPDATE owner_save_attempt SET state='string',string_path='$.profile.\"bio\"',string_minimum=0,expires_at=? WHERE id=? AND user_id='runtime-alice'",
        )
        .bind(Date.now() + 3600000, id)
        .run();
      break;
    case "cleanup":
      await db.batch([
        db
          .prepare(
            "UPDATE owner_save_attempt SET expires_at=0,state='aborted',draft=NULL WHERE id=? AND user_id='runtime-alice'",
          )
          .bind(id),
        db
          .prepare(
            "WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<63) INSERT OR IGNORE INTO owner_save_piece(attempt_id,n,data) SELECT ?,x,json_quote(replace(hex(zeroblob(2047)),'0','x')) FROM n",
          )
          .bind(id),
      ]);
      break;
    default:
      return privateJson(null, 400);
  }
  return privateJson({ prepared: true });
}
