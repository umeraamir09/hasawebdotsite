import {
  type PublicationIssue,
  publicationResultSchema,
} from "@hasaweb/schema";
import { z } from "zod";
import type { DraftController } from "./controller";
import { DraftFailure } from "./types";

type Readiness = {
  revision: number;
  issues: PublicationIssue[];
  hasMoreIssues: boolean;
  draft: ReturnType<DraftController["store"]["getState"]>["working"];
};
const preparationSchema = z.strictObject({
  candidateId: z.string().uuid(),
  portfolioId: z.string(),
  revision: z.number().int().nonnegative(),
});
export function checkPublication(
  controller: DraftController,
  send: typeof fetch = fetch,
) {
  return withPublication(controller, send, async (result) => result);
}
export function preparePublication(
  controller: DraftController,
  submit: (command: {
    ownerId: string;
    portfolioId: string;
    revision: number;
  }) => Promise<unknown>,
  send: typeof fetch = fetch,
) {
  return withPublication(controller, send, async (result) => {
    if (result.issues.length || result.hasMoreIssues)
      return { kind: "blocked" as const, ...result };
    const command = { ...controller.identity, revision: result.revision };
    const prepared = preparationSchema.parse(await submit(command));
    if (prepared.portfolioId !== command.portfolioId)
      throw new DraftFailure("owner_changed");
    if (prepared.revision !== command.revision)
      throw new DraftFailure("revision_conflict");
    return { kind: "preparing" as const, ...prepared };
  });
}
export async function withPublication<T>(
  controller: DraftController,
  send: typeof fetch,
  complete: (result: Readiness) => Promise<T>,
) {
  const requireFinishedImages = () => {
    if (Object.values(controller.store.getState().pendingImages).some(Boolean))
      throw new DraftFailure("recovery_required");
  };
  requireFinishedImages();
  const flushed = await controller.flushValid();
  requireFinishedImages();
  try {
    const record = await controller.quiesce();
    const state = controller.store.getState();
    requireFinishedImages();
    if (
      flushed.hasLocalOnlyInput ||
      Object.keys(record.inputs).length ||
      Object.keys(record.validationInputs ?? {}).length ||
      !record.base ||
      record.batch ||
      record.validationJournal ||
      record.discardJournal ||
      state.error ||
      state.pending ||
      record.base.revision !== flushed.revision ||
      JSON.stringify(record.working) !== JSON.stringify(record.base.draft)
    )
      throw new DraftFailure("recovery_required");
    const { issues, hasMoreIssues } = await readPublicationIssues(
      { ownerId: record.ownerId, portfolioId: record.portfolioId },
      flushed.revision,
      send,
    );
    requireFinishedImages();
    return await complete({
      revision: flushed.revision,
      issues,
      hasMoreIssues,
      draft: controller.store.getState().working,
    });
  } catch (error) {
    if (
      error instanceof DraftFailure &&
      ["unauthorized", "owner_changed", "revision_conflict"].includes(
        error.code,
      )
    ) {
      controller.store.setState({ error: error.code, status: "blocked" });
      await controller.persist();
    }
    throw error;
  } finally {
    controller.releaseReviewPause();
  }
}

// The owner's publication blockers for one confirmed revision. This is a
// read: it saves nothing, pauses nothing and prepares no candidate. Setup
// Review uses it on its own; Publish reaches it through `withPublication`.
export async function readPublicationIssues(
  identity: { ownerId: string; portfolioId: string },
  revision: number,
  send: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const issues = new Map<string, PublicationIssue>();
  let assetOffset = 0,
    more = false;
  while (true) {
    const response = await send("/api/owner/publication/check", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Expected-Owner-Id": identity.ownerId,
      },
      body: JSON.stringify({
        portfolioId: identity.portfolioId,
        revision,
        assetOffset,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401) throw new DraftFailure("unauthorized");
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        (body.error === "owner_changed" ||
          body.error === "revision_conflict" ||
          body.error === "save_rejected")
      )
        throw new DraftFailure(body.error);
      throw new DraftFailure("storage_unavailable");
    }
    const result = publicationResultSchema.parse(await response.json());
    if (result.portfolioId !== identity.portfolioId)
      throw new DraftFailure("owner_changed");
    if (result.revision !== revision)
      throw new DraftFailure("revision_conflict");
    for (const issue of result.issues) {
      if (issues.size < 100) issues.set(JSON.stringify(issue), issue);
      else more = true;
    }
    more ||= result.hasMoreIssues;
    if (result.nextAssetOffset === null) break;
    if (result.nextAssetOffset <= assetOffset)
      throw new DraftFailure("storage_unavailable");
    assetOffset = result.nextAssetOffset;
  }
  return { issues: [...issues.values()], hasMoreIssues: more };
}
