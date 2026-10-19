import {
  type Owner,
  type Provider,
  readOwner,
  startSignIn,
} from "../auth-client";
import type { DraftController } from "./controller";
import { createRecoveryStorage } from "./recovery";
import {
  type AuthContinuation,
  DraftFailure,
  type RecoveryRecord,
} from "./types";

export const CONTINUATION_KEY = "hasaweb-draft-auth-v1";
export function readContinuation(
  storage: Pick<Storage, "getItem"> = sessionStorage,
): AuthContinuation | null {
  try {
    const value = JSON.parse(
      storage.getItem(CONTINUATION_KEY) ?? "null",
    ) as AuthContinuation | null;
    if (
      value?.version !== 1 ||
      value.flow !== "draft-recovery" ||
      !["setup", "content"].includes(value.context) ||
      ![value.ownerId, value.portfolioId, value.recordId].every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 256,
      ) ||
      Object.keys(value).some(
        (key) =>
          ![
            "version",
            "flow",
            "context",
            "ownerId",
            "portfolioId",
            "recordId",
          ].includes(key),
      )
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function writeContinuation(
  record: RecoveryRecord,
  storage: Pick<Storage, "setItem"> = sessionStorage,
) {
  const continuation: AuthContinuation = {
    version: 1,
    flow: "draft-recovery",
    context: record.context,
    ownerId: record.ownerId,
    portfolioId: record.portfolioId,
    recordId: record.id,
  };
  storage.setItem(CONTINUATION_KEY, JSON.stringify(continuation));
  return continuation;
}
export async function signInForRecovery(
  record: RecoveryRecord,
  provider: Provider,
) {
  await createRecoveryStorage(record.ownerId, record.portfolioId).put(record);
  writeContinuation(record);
  await startSignIn(provider, "draft-recovery");
}
export async function leaveForRecovery(
  controller: DraftController,
  provider: Provider,
) {
  try {
    const record = await controller.quiesce();
    if (!controller.store.getState().localRecoveryAvailable)
      throw new DraftFailure("storage_unavailable");
    // Even an otherwise clean checkpoint must exist before leaving the tab.
    await signInForRecovery(record, provider);
  } catch (error) {
    controller.releaseReviewPause();
    throw error;
  }
}
export type RecoveryEntry =
  | {
      kind: "missing" | "signed-out" | "mismatch" | "stale";
      continuation: AuthContinuation | null;
    }
  | {
      kind: "ready";
      continuation: AuthContinuation;
      record: RecoveryRecord;
      owner: Owner;
    };
export async function loadRecoveryEntry({
  owner = readOwner,
  continuation = readContinuation,
  records = (id: string, portfolio: string) =>
    createRecoveryStorage(id, portfolio).list(id, portfolio),
} = {}): Promise<RecoveryEntry> {
  // Uncached identity first. Never open an account's IndexedDB range using URL IDs.
  const authenticated = await owner();
  const saved = continuation();
  if (!saved) return { kind: "missing", continuation: null };
  if (!authenticated) return { kind: "signed-out", continuation: saved };
  if (
    authenticated.user.id !== saved.ownerId ||
    authenticated.portfolio?.id !== saved.portfolioId
  )
    return { kind: "mismatch", continuation: saved };
  const record = (await records(saved.ownerId, saved.portfolioId)).find(
    (v) => v.id === saved.recordId,
  );
  if (
    !record ||
    record.ownerId !== saved.ownerId ||
    record.portfolioId !== saved.portfolioId ||
    record.context !== saved.context
  )
    return { kind: "stale", continuation: saved };
  return { kind: "ready", continuation: saved, owner: authenticated, record };
}
