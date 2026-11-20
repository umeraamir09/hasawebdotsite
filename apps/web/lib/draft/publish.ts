import {
  type PublicationOperation,
  type PublicationSite,
  publicationOperationSchema,
  publicationSiteSchema,
} from "@hasaweb/schema";
import { z } from "zod";
import type { DraftController } from "./controller";
import { withPublication } from "./publication";
import { DraftFailure } from "./types";

export class PublishFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export const publicationMessages: Record<string, string> = {
  recovery_required:
    "Finish or resolve unsaved input, uploads and draft recovery, then retry Publish.",
  revision_conflict:
    "Your saved draft changed. Check the current draft and retry Publish.",
  unavailable_address:
    "Your address is unavailable. Choose and reserve another address, then retry Publish.",
  stale_publication:
    "Another publication changed the live site. Reload the editor and retry Publish.",
  candidate_unavailable:
    "This prepared version is no longer available. Retry to prepare your saved draft again.",
  preparation_failed:
    "Publication preparation failed. Retry after cleanup finishes.",
  unauthorized: "Sign in again to continue this publication.",
  owner_changed:
    "This publication belongs to another account. Return to the original account.",
  publication_unavailable:
    "Could not finish publication. Retry to check the saved operation and continue.",
  withdrawal_pending:
    "Your new version is live, but withdrawn-file cleanup is pending. Retry to finish removal.",
};
export const unpublishMessages: Record<string, string> = {
  not_published:
    "Your portfolio is not published, so there is nothing to unpublish.",
  unauthorized: "Sign in again, then retry Unpublish.",
  owner_changed:
    "This portfolio belongs to another account. Return to the original account.",
  publication_unavailable:
    "Could not unpublish. Your site may still be live. Retry Unpublish.",
};
const savedCommand = z.strictObject({
  operationId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});
async function ownerPost(
  controller: DraftController,
  action: string,
  command: object,
  send: typeof fetch,
) {
  const response = await send(`/api/owner/publication/${action}`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Expected-Owner-Id": controller.identity.ownerId,
    },
    body: JSON.stringify({
      portfolioId: controller.identity.portfolioId,
      ...command,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new DraftFailure("unauthorized");
    const error = z.object({ error: z.string() }).safeParse(body);
    if (
      error.success &&
      ["owner_changed", "revision_conflict"].includes(error.data.error)
    ) {
      if (error.data.error === "owner_changed")
        throw new DraftFailure("owner_changed");
      throw new DraftFailure("revision_conflict");
    }
    throw new PublishFailure(
      error.success ? error.data.error : "publication_unavailable",
    );
  }
  return body;
}
/** Phase 48: reads the public state, or unpublishes after confirmation. */
export async function siteRequest(
  controller: DraftController,
  action: "site" | "unpublish",
  send: typeof fetch = fetch,
): Promise<PublicationSite> {
  const site = publicationSiteSchema.parse(
    await ownerPost(controller, action, {}, send),
  );
  if (site.portfolioId !== controller.identity.portfolioId)
    throw new DraftFailure("owner_changed");
  return site;
}
export async function publicationRequest(
  controller: DraftController,
  action: "start" | "status" | "commit",
  command: object,
  send: typeof fetch = fetch,
) {
  const body = await ownerPost(controller, action, command, send);
  if (body === null) return null;
  const result = publicationOperationSchema.parse(body);
  if (result.portfolioId !== controller.identity.portfolioId)
    throw new DraftFailure("owner_changed");
  return result;
}
export function publishSavedDraft(
  controller: DraftController,
  progress: (operation: PublicationOperation) => void,
  signal: AbortSignal,
  send: typeof fetch = fetch,
) {
  return withPublication(controller, send, async (readiness) => {
    if (readiness.issues.length || readiness.hasMoreIssues)
      return { kind: "blocked" as const, ...readiness };
    const key = `hasaweb-publication:${controller.identity.ownerId}:${controller.identity.portfolioId}`;
    let operation = await publicationRequest(controller, "status", {}, send);
    let saved: z.infer<typeof savedCommand> | null = null;
    try {
      const raw = localStorage.getItem(key);
      const parsed = savedCommand.safeParse(raw ? JSON.parse(raw) : null);
      if (parsed.success && parsed.data.revision === readiness.revision)
        saved = parsed.data;
    } catch {
      /* Server discovery also recovers an admitted operation. */
    }
    if (operation?.stage === "failed") {
      operation = null;
      saved = null;
    }
    if (operation?.stage === "published") {
      if (saved?.operationId === operation.operationId) {
        progress(operation);
        try {
          localStorage.removeItem(key);
        } catch {
          /* The receipt remains on the server. */
        }
        return { kind: "published" as const, operation };
      }
      operation = null;
      saved = null;
    }
    if (operation && operation.revision !== readiness.revision)
      throw new PublishFailure("revision_conflict");
    const command = operation
      ? { operationId: operation.operationId, revision: operation.revision }
      : (saved ?? {
          operationId: crypto.randomUUID(),
          revision: readiness.revision,
        });
    try {
      localStorage.setItem(key, JSON.stringify(command));
    } catch {
      /* The server remains authoritative after admission. */
    }
    const end = Date.now() + 10 * 60 * 1000;
    operation = await publicationRequest(controller, "start", command, send);
    while (operation) {
      signal.throwIfAborted();
      if (
        operation.operationId !== command.operationId ||
        operation.revision !== readiness.revision
      )
        throw new PublishFailure("revision_conflict");
      progress(operation);
      if (operation.stage === "withdrawing" && operation.retrying)
        throw new PublishFailure("withdrawal_pending");
      if (operation.stage === "failed") {
        try {
          localStorage.removeItem(key);
        } catch {
          /* No draft content is stored here. */
        }
        throw new PublishFailure(operation.error);
      }
      if (operation.stage === "published") {
        try {
          localStorage.removeItem(key);
        } catch {
          /* No draft content is stored here. */
        }
        return { kind: "published" as const, operation };
      }
      if (Date.now() >= end)
        throw new PublishFailure("publication_unavailable");
      if (operation.stage === "ready") {
        operation = await publicationRequest(
          controller,
          "commit",
          { operationId: operation.operationId },
          send,
        );
      } else {
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, 750);
          signal.addEventListener("abort", abort, { once: true });
        });
        operation = await publicationRequest(
          controller,
          "status",
          { operationId: command.operationId },
          send,
        );
      }
    }
    throw new PublishFailure("publication_unavailable");
  });
}
