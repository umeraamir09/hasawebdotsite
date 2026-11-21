import "fake-indexeddb/auto";
import { createStore, entries } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  announceDeletion,
  clearDeletedOwner,
  finishAccountDeletion,
  PENDING_KEY,
  requestAccountDeletion,
  resumeAccountDeletion,
  watchAccountDeletion,
} from "./account-deletion";
import { CONTINUATION_KEY } from "./draft/auth-recovery";
import { createDraftController } from "./draft/controller";
import {
  createRecoveryStorage,
  DeletedOwnerError,
  isOwnerDeleted,
  removeOwnerRecovery,
} from "./draft/recovery";
import { createRecoveryCoordinator } from "./draft/recovery-coordinator";
import { fixtureTransport } from "./draft/test-fixtures";
import type { RecoveryRecord } from "./draft/types";

// Each test gets its own database name, as each browser profile would.
let name = 0;
let open: () => ReturnType<typeof createStore>;
beforeEach(() => {
  const database = `recovery-${++name}`;
  open = () => createStore(database, "records");
});

function record(
  ownerId: string,
  portfolioId: string,
  id: string,
  extra: Partial<RecoveryRecord> = {},
): RecoveryRecord {
  return {
    version: 1,
    id,
    ownerId,
    portfolioId,
    context: "content",
    base: null,
    working: null,
    progress: null,
    inputs: {},
    batch: null,
    updatedAt: 1,
    ...extra,
  } as unknown as RecoveryRecord;
}
const keys = async () =>
  (await entries(open())).map(([key]) => JSON.stringify(key)).sort();
const remove = (ownerId: string) => removeOwnerRecovery(ownerId, open());

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}
const continuation = (ownerId: string) =>
  JSON.stringify({
    version: 1,
    flow: "draft-recovery",
    context: "content",
    ownerId,
    portfolioId: `${ownerId}-portfolio`,
    recordId: "r1",
  });

describe("owner recovery removal", () => {
  it("removes every record of one owner, across portfolios and kinds, and nothing else", async () => {
    const alice = createRecoveryStorage("alice", "p1", open);
    const alice2 = createRecoveryStorage("alice", "p2", open);
    const bob = createRecoveryStorage("bob", "p1", open);
    await alice.put(record("alice", "p1", "active"));
    await alice.put(
      record("alice", "p1", "review", { reviewOnly: true } as never),
    );
    await alice.put(record("alice", "p1", "replacement"));
    await alice2.put(record("alice", "p2", "other-portfolio"));
    await bob.put(record("bob", "p1", "bob-record"));
    // An owner ID that only shares a prefix is a different range.
    const alicia = createRecoveryStorage("alice2", "p1", open);
    await alicia.put(record("alice2", "p1", "alicia"));

    await remove("alice");
    expect(await keys()).toEqual([
      '["alice"]',
      '["alice2","p1","alicia"]',
      '["bob","p1","bob-record"]',
    ]);
    expect(await alice.list("alice", "p1")).toEqual([]);
    expect(await bob.list("bob", "p1")).toHaveLength(1);
    expect(await isOwnerDeleted("alice", open())).toBe(true);
    expect(await isOwnerDeleted("bob", open())).toBe(false);
  });

  it("refuses late writes from any connection once the tombstone exists", async () => {
    // Opened before the deletion, like another tab's storage.
    const otherTab = createRecoveryStorage("alice", "p1", open);
    await otherTab.put(record("alice", "p1", "before"));
    await remove("alice");
    await expect(otherTab.put(record("alice", "p1", "late"))).rejects.toThrow(
      DeletedOwnerError,
    );
    await expect(
      createRecoveryStorage("alice", "p9", open).put(
        record("alice", "p9", "new-portfolio"),
      ),
    ).rejects.toThrow(DeletedOwnerError);
    expect(await keys()).toEqual(['["alice"]']);
    // Other owners keep writing.
    await createRecoveryStorage("bob", "p1", open).put(
      record("bob", "p1", "b"),
    );
    expect(await keys()).toEqual(['["alice"]', '["bob","p1","b"]']);
  });

  it("orders a racing write either before the removal or after the tombstone", async () => {
    for (let run = 0; run < 10; run++) {
      const tab = createRecoveryStorage(`owner-${run}`, "p1", open);
      const write = tab.put(record(`owner-${run}`, "p1", "racing"));
      await Promise.all([
        write.catch((error: unknown) => {
          expect(error).toBeInstanceOf(DeletedOwnerError);
        }),
        remove(`owner-${run}`),
      ]);
      expect(await tab.list(`owner-${run}`, "p1")).toEqual([]);
    }
  });
});

describe("finishing account deletion in the browser", () => {
  afterEach(() => vi.useRealTimers());

  it("disposes controllers, waits for their final write, then removes the range", async () => {
    // The debounce only; fake-indexeddb schedules with setImmediate.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const storage = createRecoveryStorage("owner-a", "portfolio-a", open);
    const transport = fixtureTransport();
    const controller = createDraftController({
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "content",
      transport: transport.transport,
      storage,
      coordinator: {
        exclusive: true,
        run: (work) => work(),
        publish: () => {},
        publishAttempt: () => {},
        close: () => {},
      },
    });
    await controller.initialize();
    const recovery = createRecoveryCoordinator({
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "content",
      controller,
      storage,
    });
    // Unsaved input is checkpointed locally before it would be sent.
    controller.setInput(["requestedSubdomain"], "not saved");
    const bob = createRecoveryStorage("bob", "p1", open);
    await bob.put(record("bob", "p1", "bob-recovery"));
    await vi.waitFor(async () =>
      expect((await keys()).some((key) => key.startsWith('["owner-a",'))).toBe(
        true,
      ),
    );
    const session = memoryStore({
      [CONTINUATION_KEY]: continuation("owner-a"),
    });
    const local = memoryStore({
      "hasaweb-publication:owner-a:portfolio-a": "{}",
      "hasaweb-publication:bob:p1": "{}",
    });
    const announced: string[] = [];
    await finishAccountDeletion("owner-a", recovery, {
      stores: { session, local },
      remove,
      announce: (ownerId) => announced.push(ownerId),
    });
    expect(announced).toEqual(["owner-a"]);
    expect(await keys()).toEqual([
      '["bob","p1","bob-recovery"]',
      '["owner-a"]',
    ]);
    expect([...session.values.keys()]).toEqual([]);
    expect([...local.values.keys()]).toEqual(["hasaweb-publication:bob:p1"]);
    // The disposed controller rejects edits, sends nothing and writes nothing.
    expect(() =>
      controller.setInput(["requestedSubdomain"], "after deletion"),
    ).toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await keys()).toEqual([
      '["bob","p1","bob-recovery"]',
      '["owner-a"]',
    ]);
    expect(
      transport.calls.filter(
        (call) => !["read", "pending"].includes(call.action),
      ),
    ).toEqual([]);
  });

  it("keeps another account's continuation and resumes an interrupted cleanup", async () => {
    const alice = createRecoveryStorage("alice", "alice-portfolio", open);
    await alice.put(record("alice", "alice-portfolio", "r1"));
    const session = memoryStore({
      [PENDING_KEY]: JSON.stringify({ ownerId: "alice" }),
      [CONTINUATION_KEY]: continuation("bob"),
    });
    await resumeAccountDeletion(
      { session, local: memoryStore() },
      { remove, deleted: (owner) => isOwnerDeleted(owner, open()) },
    );
    expect(await keys()).toEqual(['["alice"]']);
    expect(session.getItem(PENDING_KEY)).toBeNull();
    expect(session.getItem(CONTINUATION_KEY)).toBe(continuation("bob"));
    // A tab whose continuation names an owner deleted elsewhere drops it.
    const otherTab = memoryStore({
      [CONTINUATION_KEY]: continuation("alice"),
    });
    await resumeAccountDeletion(
      { session: otherTab, local: memoryStore() },
      { remove, deleted: (owner) => isOwnerDeleted(owner, open()) },
    );
    expect(otherTab.getItem(CONTINUATION_KEY)).toBeNull();
  });

  it("clears only the deleted owner's continuation", async () => {
    const session = memoryStore({
      [CONTINUATION_KEY]: continuation("bob"),
    });
    await clearDeletedOwner("alice", { session, local: memoryStore() }, remove);
    expect(session.getItem(CONTINUATION_KEY)).toBe(continuation("bob"));
  });
});

describe("cross-tab coordination", () => {
  it("tells only the deleted owner's tabs", async () => {
    const alice = vi.fn(),
      bob = vi.fn();
    const stopAlice = watchAccountDeletion("alice", alice);
    const stopBob = watchAccountDeletion("bob", bob);
    announceDeletion("alice");
    await vi.waitFor(() => expect(alice).toHaveBeenCalledTimes(1));
    expect(bob).not.toHaveBeenCalled();
    stopAlice();
    stopBob();
  });
});

describe("deletion request", () => {
  it("sends the confirmation with the expected owner and maps closed errors", async () => {
    const send = vi.fn(async () => Response.json({ deleted: true }));
    expect(await requestAccountDeletion("owner-a", send)).toBe("deleted");
    expect(send).toHaveBeenCalledWith(
      "/api/owner/account/delete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ confirm: "delete-account" }),
        headers: {
          "Content-Type": "application/json",
          "X-Expected-Owner-Id": "owner-a",
        },
      }),
    );
    const reply = (status: number, body: unknown) => async () =>
      Response.json(body, { status });
    expect(await requestAccountDeletion("a", reply(401, null))).toBe(
      "signed_out",
    );
    expect(
      await requestAccountDeletion("a", reply(409, { error: "owner_changed" })),
    ).toBe("owner_changed");
    expect(
      await requestAccountDeletion("a", reply(409, { error: "conflict" })),
    ).toBe("conflict");
    expect(await requestAccountDeletion("a", reply(503, null))).toBe("failed");
    expect(
      await requestAccountDeletion("a", async () => {
        throw new TypeError("offline");
      }),
    ).toBe("failed");
  });
});
