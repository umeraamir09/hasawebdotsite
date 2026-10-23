import { setupResultSchema } from "@hasaweb/schema";
import type { DraftController } from "./controller";
import { DraftFailure } from "./types";

export async function handoffSetup(
  controller: DraftController,
  send: typeof fetch = fetch,
) {
  const flushed = await controller.flushValid();
  let entered = false;
  try {
    const record = await controller.quiesce();
    const state = controller.store.getState();
    const inputs = [
      ...Object.values(record.inputs),
      ...Object.values(record.validationInputs ?? {}),
    ];
    if (
      !record.base ||
      record.context !== "setup" ||
      (!state.localRecoveryAvailable && inputs.length > 0) ||
      state.error ||
      state.pending ||
      record.batch ||
      record.validationJournal ||
      record.discardJournal ||
      inputs.some(
        ({ path }) =>
          path[0] === "requestedSubdomain" ||
          path[0] === "links" ||
          (path[0] === "profile" &&
            ["name", "bio", "avatar", "banner"].includes(String(path[1]))),
      ) ||
      record.base.revision !== flushed.revision ||
      JSON.stringify(record.working) !== JSON.stringify(record.base.draft) ||
      JSON.stringify(record.progress) !== JSON.stringify(record.base.progress)
    )
      throw new DraftFailure("recovery_required");
    const response = await send("/api/owner/setup/handoff", {
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
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      if (response.status === 401) throw new DraftFailure("unauthorized");
      const failure: unknown = await response.json().catch(() => null);
      if (
        failure &&
        typeof failure === "object" &&
        "error" in failure &&
        (failure.error === "owner_changed" ||
          failure.error === "revision_conflict" ||
          failure.error === "setup_closed" ||
          failure.error === "attempt_conflict")
      )
        throw new DraftFailure(failure.error);
      throw new DraftFailure("storage_unavailable", response.status >= 500);
    }
    const result = setupResultSchema.parse(await response.json());
    if (result.portfolioId !== record.portfolioId)
      throw new DraftFailure("owner_changed");
    entered = result.kind === "editor";
    return {
      result,
      hasLocalOnlyInput: flushed.hasLocalOnlyInput || inputs.length > 0,
    };
  } catch (error) {
    if (
      error instanceof DraftFailure &&
      [
        "unauthorized",
        "owner_changed",
        "revision_conflict",
        "setup_closed",
        "attempt_conflict",
      ].includes(error.code)
    ) {
      controller.store.setState({ error: error.code, status: "blocked" });
      await controller.persist();
    }
    throw error;
  } finally {
    if (!entered) controller.releaseReviewPause();
  }
}
