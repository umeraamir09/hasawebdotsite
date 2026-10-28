import {
  type PublicationOperation,
  publicationOperationSchema,
  publicationStartSchema,
} from "@hasaweb/schema";
import { SaveError } from "./bounded-save";
import {
  activeSaveSession,
  assertSaveSession,
  saveSessionParams,
} from "./draft-api";
import {
  ownerPublicationCommit,
  PublicationCommitError,
} from "./publication-commit";
import { publicationTasks, type Wake } from "./publication-tasks";
import type { SessionIdentity } from "./repositories";

export type PublicationPolicy = {
  assetOrigin: string;
  batchSize: number;
  queue: Queue<Wake>;
};
export function ownerPublicationOperations(
  db: D1Database,
  identity: SessionIdentity,
  policy: PublicationPolicy,
) {
  async function row(portfolioId: string, operationId?: string) {
    await assertSaveSession(db, identity);
    return db
      .prepare(`SELECT o.*,r.address,r.version FROM publication_operation o
      JOIN portfolio p ON p.id=o.portfolio_id LEFT JOIN publication_commit r ON r.candidate_id=o.id
      WHERE o.portfolio_id=? AND o.owner_id=? AND p.user_id=? AND p.status!='deleting'
      AND (? IS NULL OR o.id=?) ORDER BY o.created_at DESC,o.id DESC LIMIT 1`)
      .bind(
        portfolioId,
        identity.user.id,
        identity.user.id,
        operationId ?? null,
        operationId ?? null,
      )
      .first<{
        id: string;
        portfolio_id: string;
        source_revision: number;
        expected_version: number | null;
        expected_status: "draft" | "published" | "unpublished";
        failed_code: string | null;
        completed_at: number | null;
        cleanup_attempts: number;
        address: string | null;
      }>();
  }
  async function status(
    portfolioId: string,
    operationId?: string,
  ): Promise<PublicationOperation | null> {
    const operation = await row(portfolioId, operationId);
    if (!operation) return null;
    const common = {
      operationId: operation.id,
      portfolioId,
      revision: operation.source_revision,
    };
    if (operation.address)
      return publicationOperationSchema.parse({
        ...common,
        stage: operation.completed_at === null ? "withdrawing" : "published",
        url: `https://${operation.address}.hasaweb.site`,
        ...(operation.completed_at === null
          ? { retrying: operation.cleanup_attempts > 0 }
          : {}),
      });
    if (operation.failed_code)
      return publicationOperationSchema.parse({
        ...common,
        stage: "failed",
        error: operation.failed_code,
      });
    const candidate = await publicationTasks(db).get(operation.id);
    const meta = await db
      .prepare("SELECT draft_rev FROM portfolio WHERE id=? AND user_id=?")
      .bind(portfolioId, identity.user.id)
      .first<{ draft_rev: number }>();
    if (meta?.draft_rev !== operation.source_revision) {
      await db
        .prepare(
          "UPDATE publication_operation SET failed_code='revision_conflict' WHERE id=? AND NOT EXISTS(SELECT 1 FROM publication_commit WHERE candidate_id=?)",
        )
        .bind(operation.id, operation.id)
        .run();
      if (candidate) {
        await publicationTasks(db).fail(operation.id, "revision_conflict");
        await publicationTasks(db).startCleanup(operation.id);
        await policy.queue.send({ candidateId: operation.id });
      }
      return { ...common, stage: "failed", error: "revision_conflict" };
    }
    if (!candidate) return { ...common, stage: "admitting" };
    if (["failed", "cleaning", "cleaned"].includes(candidate.status)) {
      await db
        .prepare(
          "UPDATE publication_operation SET failed_code='preparation_failed' WHERE id=? AND NOT EXISTS(SELECT 1 FROM publication_commit WHERE candidate_id=?)",
        )
        .bind(operation.id, operation.id)
        .run();
      return { ...common, stage: "failed", error: "preparation_failed" };
    }
    return publicationOperationSchema.parse({
      ...common,
      stage: candidate.status,
    });
  }
  return {
    status,
    async start(raw: unknown) {
      const command = publicationStartSchema.parse(raw);
      await assertSaveSession(db, identity);
      const existing = await row(command.portfolioId, command.operationId);
      if (existing && existing.source_revision !== command.revision)
        throw new SaveError(
          409,
          "Publication command changed",
          "revision_conflict",
        );
      if (!existing) {
        // The unique active-operation index serializes tabs. A lost response can
        // replay this exact ID without allocating another source snapshot.
        await db
          .prepare(`INSERT INTO publication_operation(id,portfolio_id,owner_id,source_revision,expected_version,expected_status,created_at)
          SELECT ?,p.id,p.user_id,p.draft_rev,p.published_version,p.status,? FROM portfolio p
          WHERE p.id=? AND p.user_id=? AND p.draft_rev=? AND p.status IN ('draft','published','unpublished')
          AND p.first_editor_entered_at IS NOT NULL AND ${activeSaveSession}
          AND NOT EXISTS(SELECT 1 FROM publication_operation o WHERE o.portfolio_id=p.id AND o.completed_at IS NULL AND o.failed_code IS NULL)
          ON CONFLICT DO NOTHING`)
          .bind(
            command.operationId,
            Date.now(),
            command.portfolioId,
            identity.user.id,
            command.revision,
            ...saveSessionParams(identity),
          )
          .run();
      }
      const operation = await row(command.portfolioId, command.operationId);
      if (!operation)
        throw new SaveError(
          409,
          "Refresh publication and draft state before retrying",
          "revision_conflict",
        );
      const current = await status(command.portfolioId, command.operationId);
      if (current?.stage === "withdrawing")
        await db
          .prepare(
            "UPDATE publication_operation SET cleanup_attempts=0,next_attempt_at=0 WHERE id=? AND completed_at IS NULL",
          )
          .bind(command.operationId)
          .run();
      if (current?.stage === "admitting") {
        const meta = await db
          .prepare("SELECT draft_rev FROM portfolio WHERE id=? AND user_id=?")
          .bind(command.portfolioId, identity.user.id)
          .first<{ draft_rev: number }>();
        if (meta?.draft_rev !== command.revision) {
          await db
            .prepare(
              "UPDATE publication_operation SET failed_code='revision_conflict' WHERE id=?",
            )
            .bind(command.operationId)
            .run();
          return status(command.portfolioId, command.operationId);
        }
        await publicationTasks(db)
          .create(identity, command.portfolioId, command.revision, {
            batchSize: policy.batchSize,
            assetOrigin: policy.assetOrigin,
            candidateId: command.operationId,
          })
          .catch(async (error) => {
            const raced = await publicationTasks(db).get(command.operationId);
            if (
              !raced ||
              raced.owner_id !== identity.user.id ||
              raced.source_revision !== command.revision
            )
              throw error;
          });
      }
      if (current?.stage !== "published" && current?.stage !== "failed")
        await policy.queue.send({ candidateId: command.operationId });
      return status(command.portfolioId, command.operationId);
    },
    async commit(portfolioId: string, operationId: string) {
      const operation = await row(portfolioId, operationId);
      if (!operation)
        throw new SaveError(404, "Publication unavailable", "not_found");
      if (!operation.address && operation.failed_code)
        return status(portfolioId, operationId);
      try {
        // The stored expected state, rather than a fresh pointer read, makes
        // uncertain commit retries identical and prevents restoring old output.
        await ownerPublicationCommit(db, identity, {
          assetOrigin: policy.assetOrigin,
        }).commit({
          portfolioId,
          candidateId: operationId,
          expectedVersion: operation.expected_version,
          expectedStatus: operation.expected_status,
        });
      } catch (error) {
        if (
          error instanceof PublicationCommitError &&
          error.code !== "unauthorized" &&
          error.code !== "command_conflict"
        ) {
          await db
            .prepare(
              "UPDATE publication_operation SET failed_code=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM publication_commit WHERE candidate_id=?)",
            )
            .bind(error.code, operationId, operationId)
            .run();
          await publicationTasks(db).startCleanup(operationId);
          await policy.queue.send({ candidateId: operationId });
          return status(portfolioId, operationId);
        }
        throw error;
      }
      await policy.queue.send({ candidateId: operationId });
      return status(portfolioId, operationId);
    },
  };
}
