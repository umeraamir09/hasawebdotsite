import {
  type PublicationIssue,
  publicationResultSchema,
} from "@hasaweb/schema";
import type { DraftController } from "./controller";
import { DraftFailure } from "./types";

export async function checkPublication(
  controller: DraftController,
  send: typeof fetch = fetch,
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
          "X-Expected-Owner-Id": record.ownerId,
        },
        body: JSON.stringify({
          portfolioId: record.portfolioId,
          revision: flushed.revision,
          assetOffset,
        }),
        signal: AbortSignal.timeout(30000),
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
      if (result.portfolioId !== record.portfolioId)
        throw new DraftFailure("owner_changed");
      if (result.revision !== flushed.revision)
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
    return {
      revision: flushed.revision,
      issues: [...issues.values()],
      hasMoreIssues: more,
      draft: controller.store.getState().working,
    };
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
