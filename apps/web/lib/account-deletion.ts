import { CONTINUATION_KEY, readContinuation } from "./draft/auth-recovery";
import { isOwnerDeleted, removeOwnerRecovery } from "./draft/recovery";

// Permanent account deletion (Phase 49), browser side. The owner route ends
// access and starts the server cleanup; this file removes what the browser
// holds for that owner and tells the owner's other tabs.

export type DeletionResult =
  | "deleted"
  | "signed_out"
  | "owner_changed"
  | "conflict"
  | "failed";

export async function requestAccountDeletion(
  ownerId: string,
  send: typeof fetch = fetch,
): Promise<DeletionResult> {
  let response: Response;
  try {
    response = await send("/api/owner/account/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Expected-Owner-Id": ownerId,
      },
      body: JSON.stringify({ confirm: "delete-account" }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return "failed";
  }
  if (response.ok) return "deleted";
  if (response.status === 401) return "signed_out";
  const body: unknown = await response.json().catch(() => null);
  const error =
    body && typeof body === "object" && "error" in body ? body.error : null;
  if (error === "owner_changed") return "owner_changed";
  if (error === "conflict") return "conflict";
  return "failed";
}

// Identifier-only, like the draft coordination channel: no content.
const CHANNEL = "hasaweb-account";
type Announcement = { type: "owner-deleted"; ownerId: string };
// Per tab: set once the server confirmed deletion and cleared when the local
// cleanup finished, so an interrupted cleanup resumes on the next page.
export const PENDING_KEY = "hasaweb-account-deleted-v1";

type Stores = {
  local?: Pick<Storage, "length" | "key" | "removeItem"> | null;
  session?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
};
function browserStores(): Required<Stores> {
  // Storage access throws when site data is blocked.
  const read = <T>(get: () => T) => {
    try {
      return get();
    } catch {
      return null;
    }
  };
  return {
    local: typeof window === "undefined" ? null : read(() => localStorage),
    session: typeof window === "undefined" ? null : read(() => sessionStorage),
  };
}

/**
 * Removes one deleted owner's browser data: the owner's whole IndexedDB range
 * (every portfolio, review copy, prepared replacement and record a tab
 * continuation names) with the owner tombstone, this tab's continuation if it
 * names the owner, and the owner's publication hints. Other accounts' data
 * stays. Idempotent.
 */
export async function clearDeletedOwner(
  ownerId: string,
  stores: Stores = browserStores(),
  remove: (ownerId: string) => Promise<void> = removeOwnerRecovery,
) {
  await remove(ownerId);
  dropContinuation(ownerId, stores.session ?? null);
  const local = stores.local;
  if (local) {
    const prefix = `hasaweb-publication:${ownerId}:`;
    const keys: string[] = [];
    for (let index = 0; index < local.length; index++) {
      const key = local.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) local.removeItem(key);
  }
}

function dropContinuation(ownerId: string, session: Stores["session"] | null) {
  if (!session) return;
  try {
    if (readContinuation(session)?.ownerId === ownerId)
      session.removeItem(CONTINUATION_KEY);
  } catch {
    // Unavailable storage holds no continuation.
  }
}

/**
 * Runs after the server confirmed deletion. Other tabs are told first so they
 * stop writing; this tab's controllers are disposed and their final writes
 * awaited; then the owner's range goes in one transaction with the tombstone,
 * which refuses any write that arrives later from any tab.
 */
export async function finishAccountDeletion(
  ownerId: string,
  recovery: { dispose(): Promise<void> } | null,
  {
    stores = browserStores(),
    remove = removeOwnerRecovery,
    announce = announceDeletion,
  }: {
    stores?: Stores;
    remove?: (ownerId: string) => Promise<void>;
    announce?: (ownerId: string) => void;
  } = {},
) {
  try {
    stores.session?.setItem(PENDING_KEY, JSON.stringify({ ownerId }));
  } catch {
    // Without session storage an interrupted cleanup cannot resume.
  }
  announce(ownerId);
  await recovery?.dispose();
  await clearDeletedOwner(ownerId, stores, remove);
  try {
    stores.session?.removeItem(PENDING_KEY);
  } catch {
    // Nothing to resume from.
  }
}

/**
 * Finishes a local cleanup that a closed or reloaded tab interrupted, and
 * drops this tab's continuation if its owner was deleted in another tab.
 * Call on owner entry pages before opening any recovery records.
 */
export async function resumeAccountDeletion(
  stores: Stores = browserStores(),
  {
    remove = removeOwnerRecovery,
    deleted = isOwnerDeleted,
  }: {
    remove?: (ownerId: string) => Promise<void>;
    deleted?: (ownerId: string) => Promise<boolean>;
  } = {},
) {
  const session = stores.session;
  if (!session) return;
  let pending: string | null = null;
  try {
    const value: unknown = JSON.parse(session.getItem(PENDING_KEY) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "ownerId" in value &&
      typeof value.ownerId === "string" &&
      value.ownerId.length > 0 &&
      value.ownerId.length <= 256
    )
      pending = value.ownerId;
  } catch {
    pending = null;
  }
  if (pending) {
    await clearDeletedOwner(pending, stores, remove);
    session.removeItem(PENDING_KEY);
  }
  const continuation = readContinuation(session);
  if (continuation && (await deleted(continuation.ownerId)))
    dropContinuation(continuation.ownerId, session);
}

export function announceDeletion(ownerId: string) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage({
    type: "owner-deleted",
    ownerId,
  } satisfies Announcement);
  channel.close();
}

/**
 * Calls `onDeleted` when another tab deletes this owner's account. The tab
 * should dispose its controllers, drop its own continuation and stop.
 */
export function watchAccountDeletion(
  ownerId: string,
  onDeleted: () => void,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (
      data &&
      typeof data === "object" &&
      "type" in data &&
      data.type === "owner-deleted" &&
      "ownerId" in data &&
      data.ownerId === ownerId
    ) {
      dropContinuation(ownerId, browserStores().session);
      onDeleted();
    }
  };
  return () => channel.close();
}
