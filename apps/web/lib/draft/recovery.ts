import { createStore, del, promisifyRequest, update } from "idb-keyval";
import type { RecoveryRecord, RecoveryStorage } from "./types";

// Lazily open IndexedDB. Importing a client component during SSR opens nothing.
export function createRecoveryStorage(
  ownerId: string,
  portfolioId: string,
): RecoveryStorage {
  let store: ReturnType<typeof createStore> | undefined;
  const database = () =>
    (store ??= createStore("hasaweb-draft-recovery-v1", "records"));
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
      // update is one atomic read/write transaction, including across tabs.
      if (record.ownerId !== ownerId || record.portfolioId !== portfolioId)
        throw new Error("Recovery scope mismatch");
      await update([ownerId, portfolioId, record.id], () => record, database());
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
