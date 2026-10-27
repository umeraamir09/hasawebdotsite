import { z } from "zod";
import {
  activeSaveSession,
  assertSaveSession,
  saveSessionParams,
} from "./draft-api";
import { publicationFacts } from "./publication-facts";
import { PUBLICATION_RENDERER_VERSION } from "./publication-tasks";
import type { SessionIdentity } from "./repositories";

const commitCommandSchema = z.strictObject({
  portfolioId: z.string().min(1),
  candidateId: z.string().uuid(),
  expectedVersion: z.number().int().positive().nullable(),
  expectedStatus: z.enum(["draft", "published", "unpublished"]),
});
export type PublicationCommitCommand = z.infer<typeof commitCommandSchema>;
export type PublicationCommitReceipt = {
  candidateId: string;
  version: number;
  address: string;
  committedAt: number;
  replayed: boolean;
};
export type PublicationCommitErrorCode =
  | "unauthorized"
  | "unavailable_address"
  | "candidate_unavailable"
  | "stale_publication"
  | "command_conflict";

export class PublicationCommitError extends Error {
  constructor(
    readonly code: PublicationCommitErrorCode,
    message: string,
  ) {
    super(message);
  }
}

async function commandDigest(command: PublicationCommitCommand) {
  const input = new TextEncoder().encode(JSON.stringify(command));
  const hash = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function ownerPublicationCommit(
  db: D1Database,
  identity: SessionIdentity,
  policy: { assetOrigin: string },
) {
  const origin = new URL(policy.assetOrigin);
  if (
    origin.origin !== policy.assetOrigin ||
    !["https:", "http:"].includes(origin.protocol)
  )
    throw new Error("Expected the configured public asset origin");

  async function receipt(
    command: PublicationCommitCommand,
    hash: string,
  ): Promise<PublicationCommitReceipt | null> {
    const row = await db
      .prepare(
        `SELECT r.payload_hash,r.version,r.address,r.committed_at FROM publication_commit r
         JOIN portfolio p ON p.id=r.portfolio_id
         WHERE r.candidate_id=? AND r.portfolio_id=? AND p.user_id=? AND ${activeSaveSession}`,
      )
      .bind(
        command.candidateId,
        command.portfolioId,
        identity.user.id,
        ...saveSessionParams(identity),
      )
      .first<{
        payload_hash: string;
        version: number;
        address: string;
        committed_at: number;
      }>();
    if (!row) return null;
    if (row.payload_hash !== hash)
      throw new PublicationCommitError(
        "command_conflict",
        "Candidate was committed with a different command",
      );
    return {
      candidateId: command.candidateId,
      version: row.version,
      address: row.address,
      committedAt: row.committed_at,
      replayed: true,
    };
  }

  return {
    async commit(raw: unknown): Promise<PublicationCommitReceipt> {
      const command = commitCommandSchema.parse(raw);
      if (
        (command.expectedVersion === null &&
          command.expectedStatus !== "draft") ||
        (command.expectedVersion !== null && command.expectedStatus === "draft")
      )
        throw new PublicationCommitError(
          "stale_publication",
          "Expected publication state is inconsistent",
        );
      await assertSaveSession(db, identity).catch(() => {
        throw new PublicationCommitError(
          "unauthorized",
          "An active owner session is required",
        );
      });
      const hash = await commandDigest(command);
      const previous = await receipt(command, hash);
      if (previous) return previous;
      const now = Date.now();
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,manifest,candidate_id,created_at,updated_at)
               SELECT c.id,p.id,coalesce((SELECT max(v.n)+1 FROM publish_version v WHERE v.portfolio_id=p.id),1),
                 'live',c.renderer_version,
                 json_object('key',json_extract(x.value,'$.manifest.key'),'bytes',json_extract(x.value,'$.manifest.bytes'),'sha256',json_extract(x.value,'$.manifest.sha256')),
                 c.id,?,?
               FROM publication_candidate c
               JOIN portfolio p ON p.id=c.portfolio_id
               JOIN publication_candidate_index x ON x.candidate_id=c.id
               JOIN subdomain_claim s ON s.portfolio_id=p.id
               WHERE c.id=? AND c.portfolio_id=? AND c.owner_id=? AND c.status='ready'
                 AND c.renderer_version=? AND c.asset_origin=?
                 AND p.user_id=? AND p.status=? AND p.published_version IS ?
                 AND p.status!='deleting' AND ${activeSaveSession}
                 AND NOT EXISTS(SELECT 1 FROM owner_save_attempt a WHERE a.user_id=p.user_id AND a.state IN ('open','string') AND a.expires_at>?)
                 AND NOT EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=s.name)
                 AND ((? IS NULL AND p.subdomain IS NULL AND s.state='held' AND s.name=json_extract(p.draft,'$.requestedSubdomain'))
                   OR (? IS NOT NULL AND p.subdomain=s.name AND s.state='claimed'))
                 AND c.facts=(SELECT ${publicationFacts} FROM portfolio p WHERE p.id=c.portfolio_id)
                 AND json_type(x.value,'$.manifest')='object'
                 AND json_extract(x.value,'$.manifest.key')='candidate/'||c.id||'/manifest.json'
                 AND json_extract(x.value,'$.manifest.bytes')>0
                 AND length(json_extract(x.value,'$.manifest.sha256'))=64
                 AND json_array_length(x.value,'$.receipts')=
                   (SELECT count(*) FROM publication_page page WHERE page.candidate_id=c.id AND page.ready=1)+4+
                   (SELECT count(*) FROM publication_transfer transfer WHERE transfer.candidate_id=c.id AND transfer.complete=1)+
                   json_array_length(x.value,'$.platform.files')`,
            )
            .bind(
              now,
              now,
              command.candidateId,
              command.portfolioId,
              identity.user.id,
              PUBLICATION_RENDERER_VERSION,
              origin.origin,
              identity.user.id,
              command.expectedStatus,
              command.expectedVersion,
              ...saveSessionParams(identity),
              now,
              command.expectedVersion,
              command.expectedVersion,
            ),
          db
            .prepare(
              `UPDATE subdomain_claim SET state='claimed',claimed_at=?
               WHERE portfolio_id=? AND state='held' AND ? IS NULL
                 AND NOT EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=subdomain_claim.name)
                 AND EXISTS(SELECT 1 FROM publish_version v JOIN portfolio p ON p.id=v.portfolio_id
                   WHERE v.id=? AND p.subdomain IS NULL AND json_extract(p.draft,'$.requestedSubdomain')=subdomain_claim.name)`,
            )
            .bind(
              now,
              command.portfolioId,
              command.expectedVersion,
              command.candidateId,
            ),
          db
            .prepare(
              "UPDATE publish_version SET status='superseded',updated_at=? WHERE portfolio_id=? AND n=? AND status='live'",
            )
            .bind(now, command.portfolioId, command.expectedVersion),
          db
            .prepare(
              `UPDATE portfolio SET status='published',published_version=(SELECT n FROM publish_version WHERE id=?),
                 subdomain=coalesce(subdomain,(SELECT name FROM subdomain_claim WHERE portfolio_id=portfolio.id AND state='claimed')),
                 updated_at=?
               WHERE id=? AND user_id=? AND status=? AND published_version IS ? AND ${activeSaveSession}
                 AND EXISTS(SELECT 1 FROM publish_version v WHERE v.id=? AND v.portfolio_id=portfolio.id AND v.status='live')
                 AND EXISTS(SELECT 1 FROM subdomain_claim s WHERE s.portfolio_id=portfolio.id AND s.state='claimed'
                   AND NOT EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=s.name)
                   AND ((? IS NULL AND portfolio.subdomain IS NULL AND s.name=json_extract(portfolio.draft,'$.requestedSubdomain'))
                     OR (? IS NOT NULL AND portfolio.subdomain=s.name)))`,
            )
            .bind(
              command.candidateId,
              now,
              command.portfolioId,
              identity.user.id,
              command.expectedStatus,
              command.expectedVersion,
              ...saveSessionParams(identity),
              command.candidateId,
              command.expectedVersion,
              command.expectedVersion,
            ),
          // CHECK consumes the immediately preceding pointer update's changes().
          // A failed guard rolls back the version, claim and old-version update.
          db
            .prepare(
              `INSERT INTO publication_commit(candidate_id,portfolio_id,payload_hash,version,address,committed_at,applied)
               SELECT ?,p.id,?,p.published_version,p.subdomain,?,changes() FROM portfolio p WHERE p.id=?`,
            )
            .bind(command.candidateId, hash, now, command.portfolioId),
        ]);
        const saved = await receipt(command, hash);
        if (!saved) throw new Error("Publication receipt missing after commit");
        return { ...saved, replayed: false };
      } catch (error) {
        const raced = await receipt(command, hash);
        if (raced) return raced;
        await assertSaveSession(db, identity).catch(() => {
          throw new PublicationCommitError(
            "unauthorized",
            "An active owner session is required",
          );
        });
        const state = await db
          .prepare(
            `SELECT p.status,p.published_version,p.subdomain,c.status AS candidate_status,
              s.name AS held_name,s.state AS claim_state,
              json_extract(p.draft,'$.requestedSubdomain') AS requested,
              EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=s.name) AS reserved
             FROM portfolio p LEFT JOIN publication_candidate c ON c.id=? AND c.portfolio_id=p.id
             LEFT JOIN subdomain_claim s ON s.portfolio_id=p.id WHERE p.id=? AND p.user_id=?`,
          )
          .bind(command.candidateId, command.portfolioId, identity.user.id)
          .first<{
            status: string;
            published_version: number | null;
            subdomain: string | null;
            candidate_status: string | null;
            held_name: string | null;
            claim_state: string | null;
            requested: string | null;
            reserved: number;
          }>();
        if (
          state &&
          (state.status !== command.expectedStatus ||
            state.published_version !== command.expectedVersion)
        )
          throw new PublicationCommitError(
            "stale_publication",
            "The public version changed; refresh publication state before retrying",
          );
        if (
          state &&
          (!state.held_name ||
            state.reserved ||
            (command.expectedVersion === null &&
              (state.claim_state !== "held" ||
                state.held_name !== state.requested)) ||
            (command.expectedVersion !== null &&
              (state.claim_state !== "claimed" ||
                state.held_name !== state.subdomain)))
        )
          throw new PublicationCommitError(
            "unavailable_address",
            "The saved address is unavailable; choose or repair the address before publishing",
          );
        if (state?.candidate_status !== "ready")
          throw new PublicationCommitError(
            "candidate_unavailable",
            "The prepared publication is unavailable; prepare it again",
          );
        if (
          error instanceof Error &&
          error.message.includes("publication_commit_applied")
        )
          throw new PublicationCommitError(
            "candidate_unavailable",
            "The prepared publication no longer meets commit conditions; prepare it again",
          );
        throw error;
      }
    },
  };
}
