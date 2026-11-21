import { createStore, del, promisifyRequest } from "idb-keyval";
import type { RecoveryRecord, RecoveryStorage } from "./types";

type Database = ReturnType<typeof createStore>;
const openDatabase = () => createStore("hasaweb-draft-recovery-v1", "records");

/**
 * Phase 49. An owner tombstone lives at key `[ownerId]`, outside every
 * `[ownerId, portfolioId, recordId]` range that `list` reads. It is written in
 * the same transaction that removes the owner's records, and every `put`
 * checks it in its own transaction, so IndexedDB orders each write either
 * before the removal (and it is removed) or after the tombstone (and it is
 * refused). Owner IDs are never reused, so the tombstone stays.
 */
export type OwnerTombstone = {
  version: 1;
  kind: "deleted-owner";
  ownerId: string;
  deletedAt: number;
};
export class DeletedOwnerError extends Error {
  constructor() {
    super("This account was deleted");
  }
}

/**
 * Removes every local recovery record of one owner: all portfolios, review
 * copies, prepared replacements and records named by tab continuations.
 * Other owners' records are outside the range and stay.
 */
export async function removeOwnerRecovery(
  ownerId: string,
  database: Database = openDatabase(),
  now = Date.now(),
) {
  const tombstone: OwnerTombstone = {
    version: 1,
    kind: "deleted-owner",
    ownerId,
    deletedAt: now,
  };
  await database("readwrite", (store) => {
    store.delete(IDBKeyRange.bound([ownerId], [ownerId, []], true, false));
    store.put(tombstone, [ownerId]);
    return promisifyRequest(store.transaction);
  });
}

export async function isOwnerDeleted(
  ownerId: string,
  database: Database = openDatabase(),
) {
  const value = await database("readonly", (store) =>
    promisifyRequest<OwnerTombstone | undefined>(store.get([ownerId])),
  );
  return value?.kind === "deleted-owner";
}

// Lazily open IndexedDB. Importing a client component during SSR opens nothing.
export function createRecoveryStorage(
  ownerId: string,
  portfolioId: string,
  open: () => Database = openDatabase,
): RecoveryStorage {
  let store: Database | undefined;
  const database = () => (store ??= open());
  return {
    async list(requestedOwner, requestedPortfolio) {
      if (requestedOwner !== ownerId || requestedPortfolio !== portfolioId)
        return [];
      const records = await database()("readonly", (store) =>
        promisifyRequest<RecoveryRecord[]>(
          store.getAll(
            IDBKeyRange.bound(
              [ownerId, portfolioId],
              [ownerId, portfolioId, []],
            ),
          ),
        ),
      );
      return records.filter(
        (value) =>
          value?.version === 1 &&
          value.ownerId === ownerId &&
          value.portfolioId === portfolioId,
      );
    },
    async put(record) {
      if (record.ownerId !== ownerId || record.portfolioId !== portfolioId)
        throw new Error("Recovery scope mismatch");
      // One read/write transaction, including across tabs: a deleted owner's
      // tombstone refuses the write instead of letting it recreate data.
      let refused = false,
        failure: unknown = null;
      await database()("readwrite", (store) => {
        const tombstone = store.get([ownerId]);
        tombstone.onsuccess = () => {
          if (tombstone.result) {
            refused = true;
            store.transaction.abort();
            return;
          }
          // A throwing put (for example a value that cannot be cloned) must
          // reject this write, not escape as an uncaught handler error.
          try {
            store.put(record, [ownerId, portfolioId, record.id]);
          } catch (error) {
            failure = error;
            store.transaction.abort();
          }
        };
        return promisifyRequest(store.transaction);
      }).catch((error: unknown) => {
        throw refused ? new DeletedOwnerError() : (failure ?? error);
      });
    },
    async remove(id, expected) {
      const key = [ownerId, portfolioId, id];
      if (!expected) return del(key, database());
      // Restoring a live tab's record must not delete input it wrote afterward.
      // Compare and delete inside one transaction, with no asynchronous gap.
      await database()("readwrite", (store) => {
        const request = store.get(key);
        request.onsuccess = () => {
          if (JSON.stringify(request.result) === JSON.stringify(expected))
            store.delete(key);
        };
        return promisifyRequest(store.transaction);
      });
    },
  };
}
