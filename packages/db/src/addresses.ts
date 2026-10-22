import {
  type AddressAvailability,
  type AddressCommand,
  type AddressReceipt,
  type AddressState,
  addressCommandSchema,
  requestedSubdomainSchema,
} from "@hasaweb/schema";
import { SaveError, saveDigest } from "./bounded-save";
import {
  activeSaveSession,
  assertSaveSession,
  ownerDrafts,
  saveSessionParams,
} from "./draft-api";
import type { SessionIdentity } from "./repositories";

export function ownerAddresses(db: D1Database, identity: SessionIdentity) {
  const drafts = ownerDrafts(db, identity);
  async function state(): Promise<AddressState> {
    await assertSaveSession(db, identity);
    return db
      .prepare(
        `SELECT c.name,c.state FROM subdomain_claim c JOIN portfolio p ON p.id=c.portfolio_id WHERE p.user_id=? AND ${activeSaveSession}`,
      )
      .bind(identity.user.id, ...saveSessionParams(identity))
      .first<NonNullable<AddressState>>();
  }
  async function availability(raw: string): Promise<AddressAvailability> {
    const name = requestedSubdomainSchema.parse(raw);
    await assertSaveSession(db, identity);
    const row = await db
      .prepare(`SELECT
      EXISTS(SELECT 1 FROM reserved_subdomain WHERE name=?) AS reserved,
      (SELECT state FROM subdomain_claim WHERE name=?) AS state,
      EXISTS(SELECT 1 FROM subdomain_claim c JOIN portfolio p ON p.id=c.portfolio_id WHERE c.name=? AND p.user_id=?) AS owned`)
      .bind(name, name, name, identity.user.id)
      .first<{
        reserved: number;
        state: "held" | "claimed" | null;
        owned: number;
      }>();
    const status =
      row?.owned && row.state === "claimed"
        ? "claimed"
        : row?.reserved
          ? "reserved"
          : row?.owned && row.state
            ? row.state
            : row?.state
              ? "unavailable"
              : "available";
    return { name, status };
  }
  async function confirm(raw: AddressCommand): Promise<AddressReceipt> {
    const command = addressCommandSchema.parse(raw);
    await assertSaveSession(db, identity);
    const hash = await saveDigest(command);
    async function receipt(): Promise<AddressReceipt | null> {
      const row = await db
        .prepare(
          `SELECT r.payload_hash,r.revision,r.name,r.state FROM address_confirmation r JOIN portfolio p ON p.id=r.portfolio_id WHERE r.id=? AND p.id=? AND p.user_id=? AND ${activeSaveSession}`,
        )
        .bind(
          command.id,
          command.portfolioId,
          identity.user.id,
          ...saveSessionParams(identity),
        )
        .first<{
          payload_hash: string;
          revision: number;
          name: string;
          state: "held" | "claimed";
        }>();
      if (!row) return null;
      if (row.payload_hash !== hash)
        throw new SaveError(409, "Command ID reused", "command_conflict");
      return {
        revision: row.revision,
        name: row.name,
        state: row.state,
        replayed: true,
      };
    }
    const previous = await receipt();
    if (previous) return previous;
    const now = Date.now();
    const guard = `id=? AND user_id=? AND draft_rev=? AND NOT EXISTS(SELECT 1 FROM owner_save_attempt a WHERE a.user_id=portfolio.user_id AND a.state IN ('open','string') AND a.expires_at>?) AND draft_validation_version=2 AND json_extract(draft,'$.schemaVersion') IN (1,2) AND ${command.context === "setup" ? "first_editor_entered_at IS NULL AND " : ""}${activeSaveSession}`;
    const params = () => [
      command.portfolioId,
      identity.user.id,
      command.revision,
      Date.now(),
      ...saveSessionParams(identity),
    ];
    try {
      const results = await db.batch([
        db
          .prepare(
            "DELETE FROM subdomain_claim WHERE portfolio_id=? AND state='held'",
          )
          .bind(command.portfolioId),
        db
          .prepare(`INSERT INTO subdomain_claim(name,portfolio_id,state,held_at,claimed_at)
          SELECT ?,id,'held',?,NULL FROM portfolio WHERE ${guard}
          AND NOT EXISTS(SELECT 1 FROM reserved_subdomain WHERE name=?)
          AND NOT EXISTS(SELECT 1 FROM subdomain_claim WHERE portfolio_id=portfolio.id AND state='claimed')`)
          .bind(command.name, now, ...params(), command.name),
        db
          .prepare(`UPDATE portfolio SET draft=json_set(draft,'$.schemaVersion',2,'$.requestedSubdomain',?),draft_rev=draft_rev+1,updated_at=?${command.context === "setup" ? ",setup_progress=?" : ""}
          WHERE ${guard} AND EXISTS(SELECT 1 FROM subdomain_claim c WHERE c.portfolio_id=portfolio.id AND c.name=?) RETURNING draft_rev AS revision`)
          .bind(
            command.name,
            now,
            ...(command.context === "setup"
              ? [JSON.stringify(command.progress)]
              : []),
            ...params(),
            command.name,
          ),
        // This CHECK consumes the canonical UPDATE's changes() immediately.
        // Throwing after batch completion would leave a failed swap committed.
        db
          .prepare(`INSERT INTO address_confirmation(id,portfolio_id,payload_hash,name,state,revision,created_at,applied)
          VALUES(?,?,?,?,(SELECT state FROM subdomain_claim WHERE portfolio_id=?),?,?,changes())`)
          .bind(
            command.id,
            command.portfolioId,
            hash,
            command.name,
            command.portfolioId,
            command.revision + 1,
            now,
          ),
      ]);
      if (!results[2]?.results[0]) throw new Error("Missing address revision");
      const saved = await receipt();
      if (!saved) throw new Error("Missing address receipt");
      const { replayed: _, ...result } = saved;
      return result;
    } catch (error) {
      // A concurrent identical command can win after the first receipt read.
      // Its unique receipt rolls this batch back before we return that receipt.
      const raced = await receipt();
      if (raced) return raced;
      const meta = await drafts.metadata();
      if (meta.portfolioId !== command.portfolioId)
        throw new SaveError(409, "Portfolio changed", "owner_changed");
      if (command.context === "setup" && meta.firstEditorEnteredAt !== null)
        throw new SaveError(409, "Setup is closed", "setup_closed");
      if (meta.revision !== command.revision)
        throw new SaveError(409, "Draft changed", "revision_conflict");
      const current = await state();
      if (current?.state === "claimed" && current.name !== command.name)
        throw new SaveError(409, "Address is permanent", "address_locked");
      const available = await availability(command.name);
      if (available.status === "reserved")
        throw new SaveError(422, "Reserved address", "address_reserved");
      if (available.status === "unavailable")
        throw new SaveError(409, "Address unavailable", "address_unavailable");
      if (
        error instanceof Error &&
        error.message.includes("address_confirmation.id")
      )
        throw new SaveError(409, "Command ID reused", "command_conflict");
      if (
        error instanceof Error &&
        /constraint|address_confirmation_applied/i.test(error.message)
      )
        await drafts.saves(command.context).rejectSave(command.revision);
      throw error;
    }
  }
  return { state, availability, confirm };
}
