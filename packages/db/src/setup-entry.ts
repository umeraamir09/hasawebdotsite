import type {
  AssetPurpose,
  SetupCommand,
  SetupField,
  SetupResult,
} from "@hasaweb/schema";
import { SaveError } from "./bounded-save";
import { activeSaveSession, ownerDrafts, saveSessionParams } from "./draft-api";
import type { SessionIdentity } from "./repositories";

// Match String.trim without returning potentially large profile text to JS.
export const setupWhitespace =
  "char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";
const textPresent = (path: string) =>
  `length(trim(json_extract(draft,'${path}'),${setupWhitespace}))>0`;
const realField = (field: string) =>
  `coalesce(json_extract(draft,'$.samples."profile.${field}"'),0)!=1`;
const readyImage = (field: "avatar" | "banner") =>
  `EXISTS(SELECT 1 FROM asset a WHERE a.id=json_extract(draft,'$.profile.${field}.assetId') AND a.portfolio_id=portfolio.id AND a.kind='${field}' AND a.status='ready' AND a.content_type IN ('image/jpeg','image/png','image/webp'))`;
export const setupRequirements = {
  address: `EXISTS(SELECT 1 FROM subdomain_claim c WHERE c.portfolio_id=portfolio.id AND c.name=json_extract(draft,'$.requestedSubdomain') AND c.state='held' AND NOT EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=c.name))`,
  name: `(${textPresent("$.profile.name")} AND ${realField("name")})`,
  bio: `(${textPresent("$.profile.bio")} AND ${realField("bio")})`,
  avatar: `(${realField("avatar")} AND json_extract(draft,'$.profile.avatar.accepted')=1 AND ${readyImage("avatar")})`,
  banner: `(${realField("banner")} AND ${readyImage("banner")})`,
  links: `EXISTS(SELECT 1 FROM json_each(draft,'$.links') l WHERE json_extract(l.value,'$.showInProfile')=1 AND length(trim(json_extract(l.value,'$.label'),${setupWhitespace}))>0 AND length(json_extract(l.value,'$.value'))>0)`,
} satisfies Record<SetupField, string>;
const fields: SetupField[] = [
  "address",
  "name",
  "bio",
  "avatar",
  "banner",
  "links",
];
export const setupValidDraft =
  "draft_validation_version=2 AND json_extract(draft,'$.schemaVersion') IN (1,2)";
export const setupNoAttempt =
  "NOT EXISTS(SELECT 1 FROM owner_save_attempt a WHERE a.user_id=portfolio.user_id AND a.state IN ('open','string') AND a.expires_at>?)";
type Facts = Record<SetupField, number | null> & {
  avatarId: string | null;
  bannerId: string | null;
};

export function ownerSetup(
  db: D1Database,
  identity: SessionIdentity,
  assetReady: (id: string, purpose: AssetPurpose) => Promise<boolean>,
) {
  const drafts = ownerDrafts(db, identity);
  async function validate(command: SetupCommand): Promise<SetupResult> {
    const meta = await drafts.metadata();
    if (meta.portfolioId !== command.portfolioId)
      throw new SaveError(409, "Portfolio changed", "owner_changed");
    if (meta.firstEditorEnteredAt !== null)
      return {
        kind: "editor",
        portfolioId: meta.portfolioId,
        revision: meta.revision,
        firstEditorEnteredAt: meta.firstEditorEnteredAt,
      };
    if (meta.revision !== command.revision)
      throw new SaveError(409, "Draft changed", "revision_conflict");
    const row = await db
      .prepare(`SELECT ${fields.map((field) => `(${setupRequirements[field]}) AS ${field}`).join(",")},
      json_extract(draft,'$.profile.avatar.assetId') AS avatarId,json_extract(draft,'$.profile.banner.assetId') AS bannerId
      FROM portfolio WHERE id=? AND user_id=? AND draft_rev=? AND status!='deleting' AND first_editor_entered_at IS NULL AND ${setupValidDraft} AND ${setupNoAttempt} AND ${activeSaveSession}`)
      .bind(
        command.portfolioId,
        identity.user.id,
        command.revision,
        Date.now(),
        ...saveSessionParams(identity),
      )
      .first<Facts>();
    if (!row) {
      const latest = await drafts.metadata();
      if (
        latest.portfolioId === command.portfolioId &&
        latest.firstEditorEnteredAt !== null
      )
        return {
          kind: "editor",
          portfolioId: latest.portfolioId,
          revision: latest.revision,
          firstEditorEnteredAt: latest.firstEditorEnteredAt,
        };
      await drafts.saves("setup").rejectSave(command.revision);
      throw new SaveError(409, "Setup is unavailable", "save_rejected");
    }
    const issues = fields.filter((field) => !row[field]);
    for (const field of ["avatar", "banner"] as const) {
      const id = field === "avatar" ? row.avatarId : row.bannerId;
      if (row[field] && (!id || !(await assetReady(id, field))))
        issues.push(field);
    }
    return issues.length
      ? {
          kind: "required",
          portfolioId: command.portfolioId,
          revision: command.revision,
          issues,
        }
      : { kind: "ready", ...command };
  }
  async function handoff(command: SetupCommand): Promise<SetupResult> {
    const checked = await validate(command);
    if (checked.kind !== "ready") return checked;
    const now = Date.now();
    const row = await db
      .prepare(`UPDATE portfolio SET first_editor_entered_at=?,draft_rev=draft_rev+1,updated_at=?
      WHERE id=? AND user_id=? AND draft_rev=? AND status!='deleting' AND first_editor_entered_at IS NULL AND ${setupValidDraft} AND ${setupNoAttempt} AND ${activeSaveSession}
      AND ${fields.map((field) => `(${setupRequirements[field]})`).join(" AND ")}
      RETURNING id AS portfolioId,draft_rev AS revision,first_editor_entered_at AS firstEditorEnteredAt`)
      .bind(
        now,
        now,
        command.portfolioId,
        identity.user.id,
        command.revision,
        Date.now(),
        ...saveSessionParams(identity),
      )
      .first<{
        portfolioId: string;
        revision: number;
        firstEditorEnteredAt: number;
      }>();
    if (row) return { kind: "editor", ...row };
    const latest = await validate(command);
    if (latest.kind === "ready")
      throw new SaveError(409, "Setup changed", "revision_conflict");
    return latest;
  }
  return { validate, handoff };
}
