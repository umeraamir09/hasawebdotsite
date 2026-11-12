import { type SetupResult, setupResultSchema } from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";
import { DraftFailure } from "../draft/types";

// Reads the authoritative required-setup facts for the controller's confirmed
// revision. It never saves, flushes or changes progress; the guide uses it to
// decide which steps may be shown.
export async function checkSetup(
  controller: DraftController,
  send: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SetupResult> {
  const revision = controller.store.getState().confirmed?.revision;
  if (revision === undefined) throw new DraftFailure("not_found");
  const { ownerId, portfolioId } = controller.identity;
  const response = await send("/api/owner/setup/check", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Expected-Owner-Id": ownerId,
    },
    body: JSON.stringify({ portfolioId, revision }),
    signal: signal ?? AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new DraftFailure("unauthorized");
    const failure: unknown = await response.json().catch(() => null);
    const code =
      failure && typeof failure === "object" && "error" in failure
        ? failure.error
        : null;
    if (code === "owner_changed" || code === "revision_conflict")
      throw new DraftFailure(code);
    // An open staging attempt makes the check unavailable until it finishes.
    if (code === "save_rejected") throw new DraftFailure("attempt_conflict");
    throw new DraftFailure("storage_unavailable", response.status >= 500);
  }
  const result = setupResultSchema.parse(await response.json());
  if (result.portfolioId !== portfolioId)
    throw new DraftFailure("owner_changed");
  return result;
}
