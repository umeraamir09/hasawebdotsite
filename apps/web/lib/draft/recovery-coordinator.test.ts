// biome-ignore-all lint/style/noNonNullAssertion: The fixture asserts the review entries before using them.
import type { OwnerSaveAction } from "@hasaweb/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTINUATION_KEY,
  loadRecoveryEntry,
  readContinuation,
  writeContinuation,
} from "./auth-recovery";
import { createDraftController } from "./controller";
import {
  createRecoveryCoordinator,
  type RecoveryCoordinator,
} from "./recovery-coordinator";
import { fixtureTransport, memoryStorage } from "./test-fixtures";
import { DraftFailure, type RecoveryRecord, type Transport } from "./types";

const scopes: RecoveryCoordinator[] = [];
afterEach(() => {
  for (const scope of scopes) scope.dispose();
  scopes.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function fixture() {
  vi.useFakeTimers();
  const network = fixtureTransport(),
    storage = memoryStorage();
  const options = {
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "setup" as const,
    storage,
    transport: network.transport,
  };
  const recovery = createRecoveryCoordinator(options);
  scopes.push(recovery);
  const controller = recovery.store.getState().controller;
  await controller.initialize();
  controller.edit(["profile", "name"], "Mine");
  network.get().draft.profile.bio = "Newer bio";
  network.get().revision++;
  await expect(controller.flushValid()).rejects.toMatchObject({
    code: "revision_conflict",
  });
  return { network, storage, options, recovery, controller };
}
it.each(["replacement", "retained"])(
  "disposal stops replacement writers while %s persistence waits",
  async (stage) => {
    const { recovery, network, storage } = await fixture();
    await recovery.start();
    const item = recovery.store
      .getState()
      .items.find((entry) => entry.selectable);
    if (!item) throw new Error("A selectable change is required");
    await recovery.select(item.id, true);
    let release = () => {};
    let reached = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const put = storage.put;
    let waiting = true;
    storage.put = async (record) => {
      if (
        waiting &&
        (stage === "replacement" ? !record.review : record.reviewOnly)
      ) {
        waiting = false;
        reached();
        await held;
      }
      return put(record);
    };
    const saved = structuredClone(network.get());
    const applying = recovery.apply().catch((error: unknown) => error);
    await entered;
    recovery.dispose();
    const sent = network.calls.length;
    release();
    expect(await applying).toBeInstanceOf(Error);
    expect(network.calls.slice(sent)).toEqual([]);
    expect(network.get()).toEqual(saved);
    expect(() =>
      recovery.store
        .getState()
        .controller.edit(["profile", "bio"], "after exit"),
    ).toThrow();
    await expect(recovery.start()).rejects.toThrow("disposed");
    expect(
      [...storage.records.values()].some(
        (record) =>
          !record.reviewOnly && record.working?.profile.name === "Mine",
      ),
    ).toBe(true);
  },
);
const seedPreserved = async (
  storage: ReturnType<typeof memoryStorage>,
  network: ReturnType<typeof fixtureTransport>,
  options: { ownerId: string; portfolioId: string },
) => {
  const base = structuredClone(network.get());
  const working = structuredClone(base.draft);
  working.profile.bio = "Other session bio";
  const record: RecoveryRecord = {
    version: 1,
    id: "preserved-other-session",
    ownerId: options.ownerId,
    portfolioId: options.portfolioId,
    context: "setup",
    base,
    working,
    progress: base.progress,
    inputs: {},
    batch: null,
    validationJournal: null,
  };
  await storage.put(record);
};
describe("durable recovery coordination", () => {
  it.each(["setup", "content"] as const)(
    "finishes setup discard in %s context after handoff without replaying content or progress",
    async (context) => {
      vi.useFakeTimers();
      const network = fixtureTransport(),
        storage = memoryStorage();
      const options = {
        ownerId: "owner-a",
        portfolioId: "portfolio-a",
        context: "setup" as const,
        storage,
        transport: network.transport,
      };
      const original = createDraftController(options);
      await original.initialize();
      original.edit(["profile", "name"], "Post-handoff selection");
      const source = await original.quiesce();
      original.dispose();
      await original.persist();
      await storage.put({
        ...source,
        discardJournal: { id: null, revision: 0, confirmed: true },
      });
      // The permanent milestone is independently authoritative, even at the same revision.
      network.get().firstEditorEnteredAt = 123;
      network.get().progress = { schemaVersion: 1, step: "review" };
      const recovery = createRecoveryCoordinator({ ...options, context });
      scopes.push(recovery);
      const controller = recovery.store.getState().controller;
      await controller.initialize().catch(() => {});
      await expect(recovery.continueRecord(source.id)).rejects.toMatchObject({
        code: "setup_closed",
      });
      expect(controller.store.getState().discardJournal).toBeNull();
      expect(network.get().draft.profile.name).not.toBe(
        "Post-handoff selection",
      );
      expect(
        network.calls.some((call) =>
          ["patch", "begin", "commit"].includes(call.action),
        ),
      ).toBe(false);
      await recovery.start();
      await recovery.select(
        recovery.store
          .getState()
          .items.find((item) => item.path.at(-1) === "name")!.id,
        true,
      );
      await recovery.apply();
      expect(network.get().draft.profile.name).toBe("Post-handoff selection");
      expect(network.get().progress.step).toBe("review");
      expect(network.get().firstEditorEnteredAt).toBe(123);
      expect(
        network.calls.filter((call) => call.action === "patch").at(-1)?.body
          .context,
      ).toBe("content");
    },
  );
  it("keeps a freshly readable canonical draft when a discard checkpoint has no working draft", async () => {
    vi.useFakeTimers();
    const network = fixtureTransport(),
      storage = memoryStorage();
    const options = {
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "content" as const,
      storage,
      transport: network.transport,
    };
    await storage.put({
      version: 1,
      id: "discard-without-draft",
      ownerId: options.ownerId,
      portfolioId: options.portfolioId,
      context: options.context,
      base: null,
      working: null,
      progress: null,
      inputs: {},
      batch: null,
      validationJournal: null,
      discardJournal: { id: null, revision: 0, confirmed: true },
    });
    const recovery = createRecoveryCoordinator(options);
    scopes.push(recovery);
    const controller = recovery.store.getState().controller;
    await controller.initialize().catch(() => {});
    await recovery.continueRecord("discard-without-draft");
    expect(controller.store.getState().working).toEqual(network.get().draft);
    expect(controller.store.getState().status).toBe("saved");
    expect(
      network.calls.some((call) =>
        ["patch", "begin", "commit"].includes(call.action),
      ),
    ).toBe(false);
  });
  it.each(["abort", "cleanup"])(
    "finishes a crash-retained %s discard before reviewing changed-base working values",
    async (lostReply) => {
      vi.useFakeTimers();
      const network = fixtureTransport(),
        storage = memoryStorage();
      const options = {
        ownerId: "owner-a",
        portfolioId: "portfolio-a",
        context: "setup" as const,
        storage,
        transport: network.transport,
      };
      const first = createRecoveryCoordinator(options);
      scopes.push(first);
      const original = first.store.getState().controller;
      await original.initialize();
      original.edit(["profile", "bio"], "preserved".repeat(1500));
      original.setInput(["requestedSubdomain"], "unfinished-");
      network.before(async (action) => {
        if (action === "piece") throw new DraftFailure("network", true);
      });
      await original.flushValid().catch(() => {});
      network.before(null);
      network.get().revision++;
      network.get().draft.profile.location = "Remote location";
      network.after((action) => {
        if (action === lostReply) {
          network.after(null);
          throw new DraftFailure("network", true);
        }
      });
      await original.discardAttempt().catch(() => {});
      original.dispose();
      await original.persist();
      const source = [...storage.records.values()][0]!;
      expect(source.discardJournal).toBeTruthy();
      // A journal may outlive its batch checkpoint as well.
      if (lostReply === "abort") {
        source.batch = null;
        await storage.put(source);
      }
      const reload = createRecoveryCoordinator(options);
      scopes.push(reload);
      const controller = reload.store.getState().controller;
      await controller.initialize().catch(() => {});
      await expect(reload.continueRecord(source.id)).rejects.toMatchObject({
        code: "revision_conflict",
      });
      expect(controller.store.getState().discardJournal).toBeNull();
      expect(
        controller.store
          .getState()
          .recoveries.some((record) => record.id === source.id),
      ).toBe(false);
      expect(controller.store.getState().working?.profile.bio).toBe(
        "preserved".repeat(1500),
      );
      expect(controller.store.getState().suspended).toBe(false);
      expect(network.pending()).toBeNull();
      expect(network.calls.some((call) => call.action === "commit")).toBe(
        false,
      );
      await reload.start();
      expect(
        reload.store
          .getState()
          .items.some((item) => item.path.at(-1) === "location"),
      ).toBe(false);
      expect(
        Object.values(reload.store.getState().review!.inputs)[0]?.value,
      ).toBe("unfinished-");
      await reload.select(
        reload.store
          .getState()
          .items.find((item) => item.path.at(-1) === "bio")!.id,
        true,
      );
      await reload.apply();
      expect(network.get().draft.profile.location).toBe("Remote location");
      expect(network.get().draft.profile.bio).toBe("preserved".repeat(1500));
    },
  );
  it.each([false, true])(
    "suspends edits throughout preserved restoration and releases the pause, storage failure: %s",
    async (storageFails) => {
      vi.useFakeTimers();
      const network = fixtureTransport(),
        storage = memoryStorage();
      const options = {
        ownerId: "owner-a",
        portfolioId: "portfolio-a",
        context: "setup" as const,
        storage,
        transport: network.transport,
      };
      const recovery = createRecoveryCoordinator(options);
      scopes.push(recovery);
      const controller = recovery.store.getState().controller;
      await controller.initialize();
      await seedPreserved(storage, network, options);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const restoring = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const list = storage.list;
      let reads = 0;
      storage.list = async (...args) => {
        // The coordinator reads the source first; hold restore's own lookup.
        if (++reads === 2) {
          entered();
          await held;
          if (storageFails) throw new Error("IndexedDB unavailable");
        }
        return list(...args);
      };
      const continuing = recovery.continueRecord("preserved-other-session");
      const completed = continuing.catch((error: unknown) => error);
      await restoring;
      const suspended = controller.store.getState().suspended;
      let accepted = false;
      try {
        accepted = controller.edit(["profile", "name"], "During restore");
      } catch (error) {
        expect(error).toMatchObject({ code: "recovery_required" });
      } finally {
        release();
      }
      const result = await completed;
      expect(suspended).toBe(true);
      expect(accepted).toBe(false);
      expect(controller.store.getState().suspended).toBe(false);
      if (storageFails) {
        expect(result).toBeInstanceOf(Error);
        expect(storage.records.has("preserved-other-session")).toBe(true);
      } else {
        expect(result).toBeUndefined();
        expect(network.get().draft.profile.bio).toBe("Other session bio");
        expect(controller.store.getState().status).toBe("saved");
      }
      expect(controller.edit(["profile", "name"], "After restore")).toBe(true);
    },
  );
  it("applies selected changes with a new scope and keeps a nonblocking review copy", async () => {
    const { recovery, network, storage, controller, options } = await fixture();
    controller.setInput(["requestedSubdomain"], "unfinished-");
    await recovery.start();
    expect(recovery.store.getState().selected).toEqual([]);
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    await recovery.apply();
    const current = recovery.store.getState().controller;
    expect(current.scopeKey).not.toBe(controller.scopeKey);
    expect(network.get().draft.profile).toMatchObject({
      name: "Mine",
      bio: "Newer bio",
    });
    expect(current.store.getState().status).toBe("unsaved");
    expect([...storage.records.values()].some((v) => v.reviewOnly)).toBe(true);
    current.dispose();
    await current.persist();
    const reload = createRecoveryCoordinator(options);
    scopes.push(reload);
    await expect(
      reload.store.getState().controller.initialize(),
    ).rejects.toMatchObject({ code: "recovery_required" });
    // Only the unfinished raw input blocks; retained copies alone do not.
    for (const [id, record] of storage.records)
      if (!record.reviewOnly) storage.records.delete(id);
    const clean = createDraftController(options);
    await clean.initialize();
    expect(clean.store.getState().status).toBe("saved");
    clean.dispose();
  });
  it("refreshes and clears selections when another save occurs during review", async () => {
    const { recovery, network } = await fixture();
    await recovery.start();
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    network.get().revision++;
    network.get().draft.profile.location = "Latest";
    await expect(recovery.apply()).rejects.toMatchObject({
      code: "review_changed",
    });
    expect(recovery.store.getState().selected).toEqual([]);
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    await recovery.apply();
    expect(network.get().draft.profile.location).toBe("Latest");
  });
  it("load newer preserves a review-only local copy and makes no draft write", async () => {
    const { recovery, network, storage } = await fixture();
    await recovery.start(undefined, "load");
    const revision = network.get().revision;
    await recovery.apply(true);
    expect(network.get().revision).toBe(revision);
    expect(
      recovery.store.getState().controller.store.getState().working,
    ).toEqual(network.get().draft);
    expect(
      [...storage.records.values()].find((v) => v.reviewOnly)?.working?.profile
        .name,
    ).toBe("Mine");
  });
  it("survives reload during review with durable selections", async () => {
    const { recovery, storage, options } = await fixture();
    await recovery.start();
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    const record = [...storage.records.values()].find((v) => v.review)!;
    const reload = createRecoveryCoordinator(options);
    scopes.push(reload);
    await reload.store
      .getState()
      .controller.initialize()
      .catch(() => {});
    await reload.reopen(record.id);
    expect(reload.store.getState().selected).toHaveLength(1);
    await reload.apply();
    expect(
      reload.store.getState().controller.store.getState().confirmed?.draft
        .profile.name,
    ).toBe("Mine");
  });
  it("retains the source on failed replacement storage", async () => {
    const { recovery, storage, controller } = await fixture();
    await controller.persist();
    const source = [...storage.records.values()][0]!;
    storage.put = async () => {
      throw new Error("storage unavailable");
    };
    await expect(recovery.start()).rejects.toThrow();
    expect(storage.records.get(source.id)?.working?.profile.name).toBe("Mine");
    expect(controller.store.getState().suspended).toBe(false);
    expect(controller.edit(["profile", "name"], "After storage failure")).toBe(
      true,
    );
  });
  it("suspends a prepared journal replacement while its restore lookup waits", async () => {
    const { recovery, network, storage, options } = await fixture();
    await recovery.start();
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    network.after((action) => {
      if (action === "patch") {
        network.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await recovery.apply().catch(() => {});
    const review = [...storage.records.values()].find(
      (record) => record.reviewOnly,
    )!;
    review.reviewOnly = false;
    review.review!.phase = "prepared";
    await storage.put(review);
    const reload = createRecoveryCoordinator(options);
    scopes.push(reload);
    const previous = reload.store.getState().controller;
    await previous.initialize().catch(() => {});
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restoring = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const list = storage.list;
    let waiting = true;
    storage.list = async (...args) => {
      if (waiting && reload.store.getState().controller !== previous) {
        waiting = false;
        entered();
        await held;
      }
      return list(...args);
    };
    const reopening = reload.reopen(review.id);
    const completed = reopening.catch((error: unknown) => error);
    await restoring;
    const current = reload.store.getState().controller;
    const suspended = current.store.getState().suspended;
    let accepted = false;
    try {
      accepted = current.edit(["profile", "bio"], "During prepared restore");
    } catch (error) {
      expect(error).toMatchObject({ code: "recovery_required" });
    } finally {
      release();
    }
    expect(await completed).toBeUndefined();
    expect(suspended).toBe(true);
    expect(accepted).toBe(false);
    expect(current.store.getState().suspended).toBe(false);
    expect(current.store.getState().working?.profile.name).toBe("Mine");
    expect(network.get().draft.profile.bio).toBe("Newer bio");
  });
  it("does not erase a source another tab updated", async () => {
    const { recovery, storage } = await fixture();
    const original = storage.remove;
    storage.remove = async (id, expected) => {
      const source = storage.records.get(id);
      if (expected && source) {
        source.inputs.new = { path: ["profile", "bio"], value: "Later raw" };
      }
      await original(id, expected);
    };
    await recovery.start();
    expect(
      [...storage.records.values()].some(
        (v) => v.inputs.new?.value === "Later raw",
      ),
    ).toBe(true);
  });
  it("applies setup content after handoff without changing frozen progress", async () => {
    const { recovery, network } = await fixture();
    network.get().firstEditorEnteredAt = 123;
    network.get().progress = { schemaVersion: 1, step: "review" };
    await recovery.start();
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    await recovery.apply();
    expect(network.get().firstEditorEnteredAt).toBe(123);
    expect(network.get().progress.step).toBe("review");
    expect(
      network.calls.filter((v) => v.action === "patch").at(-1)?.body.context,
    ).toBe("content");
  });
  it("leaves unknown staging for explicit journal recovery or discard", async () => {
    const { recovery, network } = await fixture();
    await network.transport.action("begin", {
      context: "setup",
      revision: network.get().revision,
      progress: network.get().progress,
    });
    await expect(recovery.start()).rejects.toMatchObject({
      code: "journal_missing",
    });
    expect(
      network.calls.some((v) =>
        ["resume", "abort", "commit"].includes(v.action),
      ),
    ).toBe(false);
  });
  it("settles an in-flight acknowledgement before review and stops later commands", async () => {
    vi.useFakeTimers();
    const network = fixtureTransport(),
      storage = memoryStorage();
    const recovery = createRecoveryCoordinator({
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "content",
      storage,
      transport: network.transport,
    });
    scopes.push(recovery);
    const controller = recovery.store.getState().controller;
    await controller.initialize();
    let release!: () => void;
    network.before(async (action) => {
      if (action === "patch")
        await new Promise<void>((r) => {
          release = r;
        });
    });
    controller.edit(["profile", "name"], "Acknowledged");
    const save = controller.flushValid();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    controller.edit(["profile", "bio"], "Newer local");
    const review = recovery.start();
    release();
    await save.catch(() => {});
    await review;
    expect(recovery.store.getState().review?.base?.draft.profile.name).toBe(
      "Acknowledged",
    );
    expect(
      recovery.store.getState().items.some((v) => v.local === "Newer local"),
    ).toBe(true);
    expect(network.calls.filter((v) => v.action === "patch")).toHaveLength(1);
  });
  it("reconciles a lost selected-save reply after reload without duplicating writes", async () => {
    const { recovery, network, storage, options } = await fixture();
    await recovery.start();
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    network.after((action) => {
      if (action === "patch") {
        network.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(recovery.apply()).rejects.toMatchObject({ code: "network" });
    const replacement = [...storage.records.values()].find(
      (record) => record.batch && !record.review,
    )!;
    const revision = network.get().revision;
    const reload = createRecoveryCoordinator(options);
    scopes.push(reload);
    await reload.store
      .getState()
      .controller.initialize()
      .catch(() => {});
    await reload.continueRecord(replacement.id);
    expect(network.get().revision).toBe(revision);
    expect(reload.store.getState().controller.store.getState().status).toBe(
      "saved",
    );
  });
  it("recovers a crash between durable replacement and retained-review confirmation", async () => {
    const { recovery, network, storage, options } = await fixture();
    await recovery.start();
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    const put = storage.put;
    storage.put = async (record) => {
      if (record.reviewOnly) throw new Error("interrupted checkpoint");
      await put(record);
    };
    await expect(recovery.apply()).rejects.toThrow("interrupted checkpoint");
    expect(network.get().draft.profile.name).not.toBe("Mine");
    storage.put = put;
    const checkpoint = [...storage.records.values()].find(
      (record) => record.review?.phase === "prepared",
    )!;
    const reload = createRecoveryCoordinator(options);
    scopes.push(reload);
    await reload.store
      .getState()
      .controller.initialize()
      .catch(() => {});
    await reload.reopen(checkpoint.id);
    expect(network.get().draft.profile.name).toBe("Mine");
    expect(
      reload.store
        .getState()
        .controller.store.getState()
        .recoveries.every((record) => record.reviewOnly),
    ).toBe(true);
  });
  it("checkpoints the original comparison base before discarding changed-base staging", async () => {
    vi.useFakeTimers();
    const network = fixtureTransport(),
      storage = memoryStorage();
    const options = {
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "setup" as const,
      storage,
      transport: network.transport,
    };
    const recovery = createRecoveryCoordinator(options);
    scopes.push(recovery);
    const controller = recovery.store.getState().controller;
    await controller.initialize();
    controller.edit(["profile", "name"], "Selected name");
    controller.edit(["profile", "bio"], "local".repeat(2000));
    network.before(async (action) => {
      if (action === "piece") throw new DraftFailure("network", true);
    });
    await controller.flushValid().catch(() => {});
    network.before(null);
    network.get().draft.profile.location = "Remote location";
    network.get().revision++;
    controller.store.setState({
      error: "revision_conflict",
      status: "blocked",
    });
    await controller.discardAttempt().catch(() => {});
    const record = [...storage.records.values()].find((v) => !v.review)!;
    expect(record.blocked).toBe("revision_conflict");
    expect(record.reviewBase?.revision).toBe(0);
    expect(record.batch).toBeNull();
    expect(network.pending()).toBeNull();
    await recovery.start();
    expect(
      recovery.store
        .getState()
        .items.some((item) => item.path.at(-1) === "location"),
    ).toBe(false);
    const name = recovery.store
      .getState()
      .items.find((item) => item.path.at(-1) === "name")!;
    await recovery.select(name.id, true);
    await recovery.apply();
    expect(network.get().draft.profile).toMatchObject({
      name: "Selected name",
      location: "Remote location",
    });
  });
  it("moves the tab continuation before source retirement and reopens unfinished input on callback reload", async () => {
    vi.useFakeTimers();
    const network = fixtureTransport(),
      storage = memoryStorage();
    const options = {
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "content" as const,
      storage,
      transport: network.transport,
    };
    const original = createDraftController(options);
    await original.initialize();
    original.edit(["profile", "name"], "Reauthenticated");
    original.setInput(["requestedSubdomain"], "unfinished-");
    const source = await original.quiesce();
    original.dispose();
    await original.persist();
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
    writeContinuation(source);
    const recovery = createRecoveryCoordinator(options);
    scopes.push(recovery);
    await recovery.store
      .getState()
      .controller.initialize()
      .catch(() => {});
    const remove = storage.remove;
    storage.remove = async (id, expected) => {
      if (id === source.id) {
        expect(readContinuation()?.recordId).not.toBe(source.id);
        expect(storage.records.has(readContinuation()!.recordId)).toBe(true);
      }
      await remove(id, expected);
    };
    await recovery.continueRecord(source.id);
    expect(values.has(CONTINUATION_KEY)).toBe(true);
    expect(storage.records.has(source.id)).toBe(false);
    const entry = await loadRecoveryEntry({
      owner: async () => ({
        user: { id: "owner-a", name: "A" },
        portfolio: { id: "portfolio-a" },
      }),
      records: storage.list,
    });
    expect(entry.kind).toBe("ready");
    expect(recovery.store.getState().controller.store.getState().status).toBe(
      "unsaved",
    );
  });
  it("reviews setup input rejected by expired auth after permanent handoff", async () => {
    vi.useFakeTimers();
    const network = fixtureTransport(),
      storage = memoryStorage();
    const recovery = createRecoveryCoordinator({
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "setup",
      storage,
      transport: network.transport,
    });
    scopes.push(recovery);
    const controller = recovery.store.getState().controller;
    await controller.initialize();
    controller.edit(["profile", "name"], "Recovered after sign-in");
    network.before(async (action) => {
      if (action === "patch") throw new DraftFailure("unauthorized");
    });
    await controller.flushValid().catch(() => {});
    network.before(null);
    network.get().firstEditorEnteredAt = 123;
    network.get().revision++;
    network.get().progress = { schemaVersion: 1, step: "review" };
    await recovery.start();
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    await recovery.apply();
    expect(network.get().draft.profile.name).toBe("Recovered after sign-in");
    expect(network.get().firstEditorEnteredAt).toBe(123);
    expect(network.get().progress.step).toBe("review");
    expect(
      network.calls.filter((call) => call.action === "patch").at(-1)?.body
        .context,
    ).toBe("content");
  });
  it("does not block reload on a clean replacement checkpoint", async () => {
    const { recovery, network, storage, options } = await fixture();
    await recovery.start(undefined, "load");
    await recovery.apply(true);
    const canonical = network.get();
    await storage.put({
      version: 1,
      id: "clean-checkpoint",
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "setup",
      base: structuredClone(canonical),
      working: structuredClone(canonical.draft),
      progress: canonical.progress,
      inputs: {},
      batch: null,
      validationJournal: null,
    });
    const reload = createRecoveryCoordinator(options);
    scopes.push(reload);
    await reload.store.getState().controller.initialize();
    expect(reload.store.getState().controller.store.getState().status).toBe(
      "saved",
    );
    expect(
      reload.store
        .getState()
        .controller.store.getState()
        .recoveries.every((record) => record.reviewOnly),
    ).toBe(true);
  });
  it("quiesces legacy validation after the current acknowledgement", async () => {
    vi.useFakeTimers();
    const network = fixtureTransport(),
      storage = memoryStorage();
    const calls: string[] = [];
    let release!: () => void;
    const transport: Transport = {
      ...network.transport,
      read: async () => {
        throw new DraftFailure("validation_required");
      },
      async action<T>(action: OwnerSaveAction) {
        calls.push(action);
        if (action === "pending") return null as T;
        if (action === "validation-begin")
          return { id: "validation-attempt", sequence: 0 } as T;
        if (action === "validation-step") {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { sequence: 1, complete: false, issue: null } as T;
        }
        throw new Error(`Unexpected validation command ${action}`);
      },
    };
    const recovery = createRecoveryCoordinator({
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "content",
      storage,
      transport,
    });
    scopes.push(recovery);
    const controller = recovery.store.getState().controller;
    await controller.initialize().catch(() => {});
    const validation = controller.validateLegacy().catch(() => {});
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const checkpoint = controller.quiesce();
    release();
    await validation;
    const source = await checkpoint;
    expect(calls.filter((action) => action === "validation-step")).toHaveLength(
      1,
    );
    expect(source.validationJournal?.sequence).toBe(1);
  });
  it("moves a setup continuation to the fresh content scope after handoff review", async () => {
    const { recovery, network, storage, controller } = await fixture();
    controller.setInput(["requestedSubdomain"], "unfinished-");
    await controller.persist();
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
    const original = [...storage.records.values()].find(
      (record) => !record.review,
    )!;
    writeContinuation(original);
    network.get().firstEditorEnteredAt = 123;
    network.get().revision++;
    await recovery.start();
    expect(readContinuation()?.recordId).toBe(
      recovery.store.getState().review?.id,
    );
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    await recovery.apply();
    const continuation = readContinuation()!;
    expect(continuation.context).toBe("content");
    expect(
      storage.records.get(continuation.recordId)?.inputs[
        JSON.stringify(["requestedSubdomain"])
      ]?.value,
    ).toBe("unfinished-");
    expect(storage.records.get(continuation.recordId)?.context).toBe("content");
  });
  it("preserves local work before retiring another session's committed receipt for review", async () => {
    vi.useFakeTimers();
    const network = fixtureTransport(),
      storage = memoryStorage();
    const options = {
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "content" as const,
      storage,
      transport: network.transport,
    };
    const recovery = createRecoveryCoordinator(options);
    scopes.push(recovery);
    const controller = recovery.store.getState().controller;
    await controller.initialize();
    controller.edit(["profile", "name"], "Mine");
    const attempt = await network.transport.action<{
      id: string;
      sequence: number;
    }>("begin", { context: "content", revision: 0 });
    const changed = await network.transport.action<{ sequence: number }>(
      "change",
      {
        id: attempt.id,
        sequence: 0,
        change: {
          op: "set",
          path: ["profile", "name"],
          value: "Saved elsewhere",
        },
      },
    );
    await network.transport.action("commit", {
      id: attempt.id,
      sequence: changed.sequence,
    });
    await recovery.start();
    expect(network.pending()).toBeNull();
    expect(network.get().draft.profile.name).toBe("Saved elsewhere");
    expect(recovery.store.getState().review?.working?.profile.name).toBe(
      "Mine",
    );
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    await recovery.apply();
    expect(network.get().draft.profile.name).toBe("Mine");
    expect(
      network.calls.filter((call) => call.action === "commit"),
    ).toHaveLength(1);
    expect(network.calls.some((call) => call.action === "resume")).toBe(false);
  });
  it("recovers a lost terminal-receipt cleanup reply through its linked review checkpoint", async () => {
    vi.useFakeTimers();
    const network = fixtureTransport(),
      storage = memoryStorage();
    const options = {
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "content" as const,
      storage,
      transport: network.transport,
    };
    const recovery = createRecoveryCoordinator(options);
    scopes.push(recovery);
    const controller = recovery.store.getState().controller;
    await controller.initialize();
    controller.edit(["profile", "name"], "Mine after cleanup");
    const attempt = await network.transport.action<{
      id: string;
      sequence: number;
    }>("begin", { context: "content", revision: 0 });
    const changed = await network.transport.action<{ sequence: number }>(
      "change",
      {
        id: attempt.id,
        sequence: 0,
        change: {
          op: "set",
          path: ["profile", "bio"],
          value: "Other saved bio",
        },
      },
    );
    await network.transport.action("commit", {
      id: attempt.id,
      sequence: changed.sequence,
    });
    network.after((action) => {
      if (action === "cleanup") {
        network.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(recovery.start()).rejects.toMatchObject({ code: "network" });
    const review = recovery.store.getState().review!;
    expect(review.review?.receipt?.recoveryId).toBeTypeOf("string");
    const reload = createRecoveryCoordinator(options);
    scopes.push(reload);
    await reload.store
      .getState()
      .controller.initialize()
      .catch(() => {});
    await reload.reopen(review.id);
    expect(reload.store.getState().review?.review?.receipt).toBeUndefined();
    await reload.select(reload.store.getState().items[0]!.id, true);
    await reload.apply();
    expect(network.get().draft.profile).toMatchObject({
      name: "Mine after cleanup",
      bio: "Other saved bio",
    });
  });
  it("never adopts a new attempt after a discard checkpoint observed no attempt", async () => {
    vi.useFakeTimers();
    const network = fixtureTransport(),
      storage = memoryStorage();
    const recovery = createRecoveryCoordinator({
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "content",
      storage,
      transport: network.transport,
    });
    scopes.push(recovery);
    const controller = recovery.store.getState().controller;
    await controller.initialize();
    controller.store.setState({
      discardJournal: { id: null, revision: 0, confirmed: false },
    });
    await network.transport.action("begin", {
      context: "content",
      revision: 0,
    });
    await expect(controller.retry()).rejects.toMatchObject({
      code: "attempt_conflict",
    });
    expect(network.pending()?.state).toBe("open");
    expect(network.calls.some((call) => call.action === "abort")).toBe(false);
  });
  it("requires fresh review when canonical values change after replacement preparation", async () => {
    const { recovery, network, storage, options } = await fixture();
    await recovery.start();
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    const put = storage.put;
    storage.put = async (record) => {
      if (record.reviewOnly) throw new Error("interrupted retention");
      await put(record);
    };
    await recovery.apply().catch(() => {});
    storage.put = put;
    const checkpoint = [...storage.records.values()].find(
      (record) => record.review?.phase === "prepared",
    )!;
    network.get().revision++;
    network.get().draft.profile.bio = "Saved after preparation";
    const reload = createRecoveryCoordinator(options);
    scopes.push(reload);
    await reload.store
      .getState()
      .controller.initialize()
      .catch(() => {});
    await expect(reload.reopen(checkpoint.id)).rejects.toMatchObject({
      code: "review_changed",
    });
    expect(reload.store.getState().selected).toEqual([]);
    expect(
      [...storage.records.values()].some(
        (record) =>
          record.reviewOnly && record.working?.profile.name === "Mine",
      ),
    ).toBe(true);
    await reload.select(reload.store.getState().items[0]!.id, true);
    await reload.apply();
    expect(network.get().draft.profile).toMatchObject({
      name: "Mine",
      bio: "Saved after preparation",
    });
  });
  it("keeps an active review unchanged when another review is requested", async () => {
    const { recovery, storage, network } = await fixture();
    await recovery.start();
    const review = recovery.store.getState().review!;
    const records = JSON.stringify([...storage.records.values()]),
      calls = network.calls.length;
    await expect(recovery.reopen(review.id)).rejects.toMatchObject({
      code: "recovery_required",
    });
    expect(JSON.stringify([...storage.records.values()])).toBe(records);
    expect(network.calls).toHaveLength(calls);
    expect(recovery.store.getState().review?.id).toBe(review.id);
  });
  it("keeps the active checkpoint when reviewing another preserved record", async () => {
    const { recovery, storage, network, options } = await fixture();
    await seedPreserved(storage, network, options);
    await recovery.start("preserved-other-session");
    expect(recovery.store.getState().review?.working?.profile.bio).toBe(
      "Other session bio",
    );
    expect(
      [...storage.records.values()].some(
        (record) => !record.review && record.working?.profile.name === "Mine",
      ),
    ).toBe(true);
  });
  it("keeps unfinished raw input in the active scope when reviewing another record", async () => {
    const { recovery, storage, network, options, controller } = await fixture();
    controller.setInput(["requestedSubdomain"], "unfinished-");
    await seedPreserved(storage, network, options);
    await recovery.start("preserved-other-session");
    expect(
      [...storage.records.values()].some((record) =>
        Object.values(record.inputs).some(
          (input) => input.value === "unfinished-",
        ),
      ),
    ).toBe(true);
  });
  it("leaves the kept active checkpoint listed after applying another review", async () => {
    const { recovery, storage, network, options } = await fixture();
    await seedPreserved(storage, network, options);
    await recovery.start("preserved-other-session");
    await recovery.select(recovery.store.getState().items[0]!.id, true);
    await recovery.apply();
    expect(network.get().draft.profile.bio).toBe("Other session bio");
    const current = recovery.store.getState().controller;
    expect(
      current.store
        .getState()
        .recoveries.some((record) => record.working?.profile.name === "Mine"),
    ).toBe(true);
  });
});
