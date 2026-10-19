import { afterEach, describe, expect, it, vi } from "vitest";
import { createDraftController } from "./controller";
import { fixtureTransport, memoryStorage } from "./test-fixtures";
import { DraftFailure } from "./types";

const controllers: ReturnType<typeof createDraftController>[] = [];
function setup(
  transport = fixtureTransport(),
  storage = memoryStorage(),
  context: "setup" | "content" = "setup",
) {
  const controller = createDraftController({
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context,
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
  controllers.push(controller);
  return { controller, transport, storage };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
});
describe("shared autosave controller", () => {
  it("retries a failed initial read before claiming the canonical snapshot is saved", async () => {
    const { controller, transport } = setup();
    vi.spyOn(transport.transport, "read").mockRejectedValueOnce(
      new DraftFailure("network"),
    );
    await expect(controller.initialize()).rejects.toMatchObject({
      code: "network",
    });
    expect(controller.store.getState().status).toBe("failed");
    expect(controller.store.getState().confirmed).toBe(null);
    await controller.retry();
    expect(controller.store.getState().status).toBe("saved");
    expect(controller.store.getState().confirmed?.revision).toBe(0);
  });
  it("does not replace unsaved working values during reinitialization", async () => {
    const { controller } = setup();
    await controller.initialize();
    controller.edit(["profile", "name"], "Preserve current input");
    await expect(controller.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    expect(controller.store.getState().working?.profile.name).toBe(
      "Preserve current input",
    );
  });
  it("does not refresh the base underneath unfinished local input", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.setInput(["requestedSubdomain"], "bad space");
    await transport.transport.action("patch", {
      context: "content",
      revision: 0,
      change: { op: "set", path: ["requestedSubdomain"], value: "other-tab" },
    });
    await expect(controller.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    expect(controller.store.getState().confirmed?.revision).toBe(0);
    controller.edit(["requestedSubdomain"], "my-choice");
    await expect(controller.retry()).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(transport.get().draft.requestedSubdomain).toBe("other-tab");
  });
  it("stops before loading recovery when the returned portfolio changes at the same revision", async () => {
    const storage = memoryStorage(),
      transport = fixtureTransport();
    const first = setup(transport, storage).controller;
    await first.initialize();
    first.edit(["profile", "name"], "Original portfolio input");
    first.dispose();
    await first.persist();
    const count = storage.records.size;
    transport.transport.read = async () => ({
      ...structuredClone(transport.get()),
      portfolioId: "different-portfolio",
    });
    const requests = transport.calls.length;
    const second = setup(transport, storage).controller;
    await expect(second.initialize()).rejects.toMatchObject({
      code: "owner_changed",
    });
    expect(second.store.getState().working).toBe(null);
    expect(second.store.getState().recoveries).toEqual([]);
    expect(storage.records.size).toBe(count);
    expect(transport.calls).toHaveLength(requests);
  });
  it("keeps a changed-base input recovery blocked after another reload", async () => {
    const storage = memoryStorage(),
      transport = fixtureTransport();
    const first = setup(transport, storage).controller;
    await first.initialize();
    first.setInput(["requestedSubdomain"], "bad space");
    first.dispose();
    await first.persist();
    const originalId = Array.from(storage.records.keys())[0] as string;
    await transport.transport.action("patch", {
      context: "content",
      revision: 0,
      change: { op: "set", path: ["requestedSubdomain"], value: "other-tab" },
    });
    const second = setup(transport, storage).controller;
    await expect(second.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    await expect(second.restore(originalId)).rejects.toMatchObject({
      code: "revision_conflict",
    });
    await second.persist();
    await expect(
      second.discardRecovery("foreign-record"),
    ).rejects.toMatchObject({ code: "owner_changed" });
    await second.persist();
    second.dispose();
    await second.persist();
    const blocked = Array.from(storage.records.values()).find(
      (record) => record.blocked === "revision_conflict",
    );
    expect(blocked).toBeDefined();
    const third = setup(transport, storage).controller;
    await expect(third.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    await third.restore(blocked?.id as string);
    third.edit(["requestedSubdomain"], "my-choice");
    await expect(third.retry()).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(transport.get().draft.requestedSubdomain).toBe("other-tab");
  });
  it("does not load a newer committed receipt over unfinished input", async () => {
    const transport = fixtureTransport();
    const attempt = await transport.transport.action<{
      id: string;
      sequence: number;
    }>("begin", { context: "content", revision: 0 });
    const { controller } = setup(transport);
    await expect(controller.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    controller.setInput(["requestedSubdomain"], "bad space");
    const changed = await transport.transport.action<{ sequence: number }>(
      "change",
      {
        id: attempt.id,
        sequence: attempt.sequence,
        change: { op: "set", path: ["requestedSubdomain"], value: "other-tab" },
      },
    );
    await transport.transport.action("commit", {
      id: attempt.id,
      sequence: changed.sequence,
    });
    await expect(controller.discardAttempt()).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(controller.store.getState().confirmed?.revision).toBe(0);
    controller.edit(["requestedSubdomain"], "my-choice");
    await expect(controller.retry()).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(transport.get().draft.requestedSubdomain).toBe("other-tab");
  });
  it("does not retain original files or browser objects as unfinished form input", async () => {
    const { controller, storage } = setup();
    await controller.initialize();
    expect(() =>
      controller.setInput(["profile", "avatar"], new Blob(["source image"])),
    ).toThrow();
    await controller.persist();
    expect(storage.records.size).toBe(0);
  });
  it("serializes concurrent flushes without duplicate writes", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "name"], "One revision");
    const results = await Promise.all([
      controller.flushValid(),
      controller.flushValid(),
      controller.flushValid(),
    ]);
    expect(results.map((value) => value.revision)).toEqual([1, 1, 1]);
    expect(
      transport.calls.filter((value) => value.action === "patch"),
    ).toHaveLength(1);
  });
  it("stops staged commands on disposal and leaves the journal recoverable", async () => {
    const { controller, transport, storage } = setup();
    await controller.initialize();
    controller.edit(["profile", "bio"], "large".repeat(3000));
    transport.after((action) => {
      if (action === "begin") controller.dispose();
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "recovery_required",
    });
    await controller.persist();
    expect(
      transport.calls.filter((value) => value.action === "commit"),
    ).toHaveLength(0);
    expect(
      Array.from(storage.records.values())[0]?.batch?.attemptId,
    ).toBeTruthy();
  });
  it("starts no network work if disposed while waiting for another tab's lock", async () => {
    const fixture = fixtureTransport();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    const controller = createDraftController({
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "setup",
      transport: fixture.transport,
      storage: memoryStorage(),
      coordinator: {
        exclusive: true,
        run: async (work) => {
          entered = true;
          await held;
          return work();
        },
        publish: () => {},
        publishAttempt: () => {},
        close: () => {},
      },
    });
    controllers.push(controller);
    const loading = controller.initialize();
    await vi.waitFor(() => expect(entered).toBe(true));
    controller.dispose();
    release();
    await expect(loading).rejects.toMatchObject({ code: "recovery_required" });
    expect(fixture.calls).toHaveLength(0);
  });
  it("blocks changed-base local restore rather than replaying stale input", async () => {
    const { controller, transport, storage } = setup();
    await controller.initialize();
    controller.setInput(["requestedSubdomain"], "invalid space");
    await controller.persist();
    controller.dispose();
    transport.get().revision++;
    transport.get().draft.profile.name = "New device";
    const next = setup(transport, storage).controller;
    await expect(next.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    const record = next.store.getState().recoveries[0];
    await expect(next.restore(record?.id as string)).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(next.store.getState().working?.profile.name).toBe("New device");
    expect(Object.keys(next.store.getState().inputs)).toHaveLength(1);
  });
  it("preserves a source recovery record that its original tab updates during restoration", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const transport = fixtureTransport();
    const first = setup(transport, storage).controller;
    await first.initialize();
    first.edit(["profile", "name"], "Old recoverable input");
    await first.persist();
    const sourceId = Array.from(storage.records.keys())[0] as string;
    const second = setup(transport, storage).controller;
    await expect(second.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let copying = false;
    const originalPut = storage.put;
    storage.put = async (record) => {
      if (record.id !== sourceId) {
        copying = true;
        await held;
      }
      return originalPut(record);
    };
    const restoring = second.restore(sourceId);
    await vi.waitFor(() => expect(copying).toBe(true));
    first.edit(["profile", "name"], "Newer input in original tab");
    await first.persist();
    release();
    await restoring;
    expect(storage.records.get(sourceId)?.working?.profile.name).toBe(
      "Newer input in original tab",
    );
    expect(second.store.getState().working?.profile.name).toBe(
      "Old recoverable input",
    );
  });
  it("keeps the original recovery when its replacement cannot be persisted", async () => {
    const storage = memoryStorage();
    const transport = fixtureTransport();
    const first = setup(transport, storage).controller;
    await first.initialize();
    first.edit(["profile", "name"], "Keep the durable source");
    await first.persist();
    first.dispose();
    await first.persist();
    const sourceId = Array.from(storage.records.keys())[0] as string;
    const second = setup(transport, storage).controller;
    await expect(second.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    storage.put = async () => {
      throw new Error("IndexedDB quota unavailable");
    };
    await second.restore(sourceId);
    expect(second.store.getState().localRecoveryAvailable).toBe(false);
    expect(storage.records.has(sourceId)).toBe(true);
    await second.flushValid();
    expect(transport.get().draft.profile.name).toBe("Keep the durable source");
    expect(storage.records.has(sourceId)).toBe(true);
  });
  it("schedules current edits after the last older recovery is explicitly discarded", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage(),
      transport = fixtureTransport();
    const first = setup(transport, storage).controller;
    await first.initialize();
    first.edit(["profile", "name"], "Older recovery");
    first.dispose();
    await first.persist();
    const sourceId = Array.from(storage.records.keys())[0] as string;
    const second = setup(transport, storage).controller;
    await expect(second.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    second.edit(["profile", "name"], "Current input");
    await second.discardRecovery(sourceId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.get().draft.profile.name).toBe("Current input");
    expect(second.store.getState().status).toBe("saved");
  });
  it("reschedules preserved valid input after explicit staging discard", async () => {
    vi.useFakeTimers();
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "bio"], "x".repeat(9000));
    transport.before(async (action) => {
      if (action === "piece") {
        transport.before(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    await controller.discardAttempt();
    expect(transport.get().revision).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.get().draft.profile.bio).toBe("x".repeat(9000));
    expect(controller.store.getState().status).toBe("saved");
  });
  it("never reports Saved after discarding unfinished legacy validation", async () => {
    const fixture = fixtureTransport();
    await fixture.transport.action("begin", {
      context: "content",
      revision: 0,
    });
    const pending = fixture.pending();
    if (pending) pending.context = "validation";
    fixture.transport.read = async () => {
      throw new DraftFailure("validation_required");
    };
    const { controller } = setup(fixture);
    await expect(controller.initialize()).rejects.toMatchObject({
      code: "validation_required",
    });
    await expect(controller.discardAttempt()).rejects.toMatchObject({
      code: "validation_required",
    });
    expect(fixture.pending()).toBe(null);
    expect(controller.store.getState().status).toBe("blocked");
    expect(controller.store.getState().confirmed).toBe(null);
  });
  it("does not rebase a stale restored batch when its staging is discarded", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage(),
      transport = fixtureTransport();
    const first = setup(transport, storage).controller;
    await first.initialize();
    first.edit(["profile", "name"], "Mine");
    first.edit(["profile", "bio"], "Pending biography");
    transport.after((action) => {
      if (action === "change") {
        transport.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(first.flushValid()).rejects.toMatchObject({ code: "network" });
    first.dispose();
    await first.persist();
    await transport.transport.action("patch", {
      context: "content",
      revision: 0,
      change: { op: "set", path: ["profile", "name"], value: "Another device" },
    });
    const sourceId = Array.from(storage.records.keys())[0] as string;
    const second = setup(transport, storage).controller;
    await expect(second.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    await second.restore(sourceId);
    await expect(second.discardAttempt()).rejects.toMatchObject({
      code: "revision_conflict",
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.get().draft.profile.name).toBe("Another device");
    expect(second.store.getState().working?.profile.name).toBe("Mine");
    expect(second.store.getState().status).toBe("blocked");
  });
  it("coalesces a typing burst and omits reverted changes", async () => {
    vi.useFakeTimers();
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "name"], "A");
    controller.edit(["profile", "name"], "Ada");
    await vi.advanceTimersByTimeAsync(1999);
    expect(transport.calls.filter((v) => v.action === "patch")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.get().draft.profile.name).toBe("Ada");
    expect(controller.store.getState().status).toBe("saved");
    controller.edit(["profile", "name"], "X");
    controller.edit(["profile", "name"], "Ada");
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.calls.filter((v) => v.action === "patch")).toHaveLength(1);
    expect(transport.calls.filter((v) => v.action === "read")).toHaveLength(1);
  });
  it("retains newer input while an older save is in flight", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    transport.before(async (action) => {
      if (action !== "patch") return;
      transport.before(null);
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    controller.edit(["profile", "name"], "First");
    const flush = controller.flushValid();
    await started;
    controller.edit(["profile", "name"], "Second");
    release();
    await flush;
    expect(transport.get().draft.profile.name).toBe("Second");
    expect(transport.get().revision).toBe(2);
    expect(controller.store.getState().status).toBe("saved");
  });
  it("keeps the two-second debounce for edits arriving during an automatic save", async () => {
    vi.useFakeTimers();
    const { controller, transport } = setup();
    await controller.initialize();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    transport.before(async (action) => {
      if (action === "patch") {
        transport.before(null);
        await held;
      }
    });
    controller.edit(["profile", "name"], "First batch");
    await vi.advanceTimersByTimeAsync(2000);
    controller.edit(["profile", "name"], "New typing");
    await vi.advanceTimersByTimeAsync(500);
    controller.edit(["profile", "name"], "Latest typing");
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.get().draft.profile.name).toBe("First batch");
    expect(transport.calls.filter((v) => v.action === "patch")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(transport.calls.filter((v) => v.action === "patch")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.get().draft.profile.name).toBe("Latest typing");
    expect(transport.calls.filter((v) => v.action === "patch")).toHaveLength(2);
    expect(controller.store.getState().status).toBe("saved");
  });
  it("does not let an old timer save newer input early after waiting for a tab lock", async () => {
    vi.useFakeTimers();
    const fixture = fixtureTransport();
    let hold = false;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = createDraftController({
      ownerId: "owner-a",
      portfolioId: "portfolio-a",
      context: "setup",
      transport: fixture.transport,
      storage: memoryStorage(),
      coordinator: {
        exclusive: true,
        run: async (work) => {
          if (hold) await held;
          return work();
        },
        publish: () => {},
        publishAttempt: () => {},
        close: () => {},
      },
    });
    controllers.push(controller);
    await controller.initialize();
    hold = true;
    controller.edit(["profile", "name"], "Old timer");
    await vi.advanceTimersByTimeAsync(2000);
    controller.edit(["profile", "name"], "New timer");
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.calls.filter((v) => v.action === "patch")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fixture.calls.filter((v) => v.action === "patch")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.calls.filter((v) => v.action === "patch")).toHaveLength(1);
    expect(fixture.get().draft.profile.name).toBe("New timer");
  });
  it("saves valid progress while retaining invalid input locally", async () => {
    const { controller, transport, storage } = setup();
    await controller.initialize();
    expect(controller.edit(["requestedSubdomain"], "bad space")).toBe(false);
    controller.changeProgress({ schemaVersion: 1, step: "profile" });
    const result = await controller.flushValid();
    await controller.persist();
    expect(result).toEqual({ revision: 1, hasLocalOnlyInput: true });
    expect(controller.store.getState().status).toBe("unsaved");
    expect(transport.get().draft.requestedSubdomain).toBeUndefined();
    expect(storage.records.size).toBe(1);
    const second = setup(transport, storage).controller;
    await expect(second.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    const record = second.store.getState().recoveries[0];
    expect(record).toBeDefined();
    await second.restore(record?.id as string);
    expect(second.store.getState().inputs).toEqual(
      controller.store.getState().inputs,
    );
  });
  it("reconciles a lost patch reply without duplicating its write", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    transport.after((action) => {
      if (action === "patch") {
        transport.after(null);
        throw new DraftFailure("network", true);
      }
    });
    controller.edit(["profile", "name"], "Saved despite reply loss");
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    expect(controller.store.getState().status).toBe("failed");
    await controller.retry();
    expect(transport.get().revision).toBe(1);
    expect(transport.calls.filter((v) => v.action === "patch")).toHaveLength(1);
    expect(controller.store.getState().status).toBe("saved");
  });
  it("does not use revision advancement alone as proof of saving", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    transport.before(async (action) => {
      if (action === "patch") {
        transport.before(null);
        transport.get().revision++;
        transport.get().draft.profile.name = "Other device";
        throw new DraftFailure("network", true);
      }
    });
    controller.edit(["profile", "name"], "Mine");
    await expect(controller.flushValid()).rejects.toBeInstanceOf(DraftFailure);
    await expect(controller.retry()).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(controller.store.getState().working?.profile.name).toBe("Mine");
    expect(transport.get().draft.profile.name).toBe("Other device");
  });
  it.each(["begin", "change", "piece", "string-finish", "commit"])(
    "recovers a lost %s response",
    async (lost) => {
      const { controller, transport } = setup();
      await controller.initialize();
      controller.edit(["profile", "name"], "Ada");
      controller.edit(["profile", "bio"], "bio".repeat(4000));
      transport.after((action) => {
        if (action === lost) {
          transport.after(null);
          throw new DraftFailure("network", true);
        }
      });
      await expect(controller.flushValid()).rejects.toMatchObject({
        code: "network",
      });
      if (lost === "begin") {
        await expect(controller.retry()).rejects.toMatchObject({
          code: "journal_missing",
        });
        await controller.discardAttempt();
        await controller.flushValid();
      } else await controller.retry();
      expect(transport.get().revision).toBe(1);
      expect(transport.get().draft.profile.bio).toBe("bio".repeat(4000));
      expect(controller.store.getState().status).toBe("saved");
    },
  );
  it("requires explicit resume for a transferred session", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "bio"], "x".repeat(9000));
    transport.before(async (action) => {
      if (action === "piece") {
        transport.before(null);
        throw new DraftFailure("unauthorized");
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "unauthorized",
    });
    const pending = transport.pending();
    if (pending) pending.requiresResume = true;
    await expect(controller.retry()).rejects.toMatchObject({
      code: "recovery_required",
    });
    await controller.resumeAttempt();
    expect(transport.get().draft.profile.bio).toBe("x".repeat(9000));
  });
  it("does not adopt a different device's sequence-zero begin or its setup progress", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "name"], "Mine");
    controller.edit(["profile", "bio"], "My biography");
    transport.before(async (action) => {
      if (action === "begin") {
        transport.before(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    await transport.transport.action("begin", {
      context: "setup",
      revision: 0,
      progress: { schemaVersion: 1, step: "links" },
    });
    await expect(controller.retry()).rejects.toMatchObject({
      code: "journal_missing",
    });
    expect(transport.get().revision).toBe(0);
    await controller.discardAttempt();
    await controller.flushValid();
    expect(transport.get().progress.step).toBe("address");
    expect(transport.get().draft.profile.bio).toBe("My biography");
  });
  it("does not acknowledge another command merely because its sequence advanced", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "bio"], "x".repeat(9000));
    transport.before(async (action) => {
      if (action === "piece") {
        transport.before(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    const pending = transport.pending();
    if (pending) pending.sequence++;
    await expect(controller.retry()).rejects.toMatchObject({
      code: "attempt_conflict",
    });
    expect(transport.get().revision).toBe(0);
    expect(controller.store.getState().working?.profile.bio).toBe(
      "x".repeat(9000),
    );
  });
  it("retains a confirmed revision across cleanup failure without committing twice", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "name"], "Confirmed name");
    controller.edit(["profile", "bio"], "Confirmed biography");
    transport.after((action) => {
      if (action === "cleanup") {
        transport.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    expect(controller.store.getState().batch?.confirmedRevision).toBe(1);
    expect(controller.store.getState().confirmed?.revision).toBe(1);
    await controller.retry();
    expect(controller.store.getState().status).toBe("saved");
    expect(transport.get().revision).toBe(1);
    expect(transport.calls.filter((v) => v.action === "commit")).toHaveLength(
      1,
    );
  });
  it("preserves an uncertain command when session transfer would erase its receipt proof", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "bio"], "x".repeat(9000));
    transport.after((action) => {
      if (action === "piece") {
        transport.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    const pending = transport.pending();
    if (pending) pending.requiresResume = true;
    await expect(controller.resumeAttempt()).rejects.toMatchObject({
      code: "attempt_conflict",
    });
    expect(transport.calls.filter((v) => v.action === "resume")).toHaveLength(
      0,
    );
    expect(transport.get().revision).toBe(0);
  });
  it("does not acknowledge a different actor's partial commit as the full batch", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "name"], "Mine");
    controller.edit(["profile", "bio"], "Still pending");
    transport.after((action) => {
      if (action === "change") {
        transport.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    const pending = transport.pending();
    await transport.transport.action("commit", {
      id: pending?.id,
      sequence: pending?.sequence,
    });
    await expect(controller.retry()).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(controller.store.getState().status).toBe("blocked");
    expect(controller.store.getState().working?.profile.bio).toBe(
      "Still pending",
    );
    expect(transport.get().draft.profile.bio).not.toBe("Still pending");
  });
  it("rejects stale setup and preserves frozen progress for content", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    transport.get().firstEditorEnteredAt = 123;
    controller.edit(["profile", "name"], "Stale");
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "setup_closed",
    });
    const requests = transport.calls.length;
    await expect(controller.retry()).rejects.toMatchObject({
      code: "setup_closed",
    });
    expect(transport.calls).toHaveLength(requests);
    const content = setup(transport, memoryStorage(), "content").controller;
    await content.initialize();
    content.edit(["profile", "name"], "Editor");
    await content.flushValid();
    expect(transport.get().firstEditorEnteredAt).toBe(123);
    expect(transport.get().progress.step).toBe("address");
  });
  it("never loads another owner's recovery and reports unavailable local storage", async () => {
    const { controller, storage } = setup();
    await controller.initialize();
    const put = vi.spyOn(storage, "put").mockRejectedValue(new Error("denied"));
    controller.setInput(["requestedSubdomain"], "bad space");
    await controller.persist();
    expect(controller.store.getState().localRecoveryAvailable).toBe(false);
    expect(controller.store.getState().status).toBe("unsaved");
    expect(put).toHaveBeenCalled();
    await expect(controller.restore("foreign-id")).rejects.toMatchObject({
      code: "owner_changed",
    });
  });
  it("preserves edits when the account changes or an unfinished attempt has no journal", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "bio"], "x".repeat(8000));
    transport.before(async (action) => {
      if (action === "begin") throw new DraftFailure("owner_changed");
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "owner_changed",
    });
    await expect(controller.retry()).rejects.toMatchObject({
      code: "owner_changed",
    });
    const requests = transport.calls.length;
    for (const action of [
      () => controller.initialize(),
      () => controller.restore("source"),
      () => controller.discardRecovery("source"),
      () => controller.discardAttempt(),
      () => controller.validateLegacy(),
      () => controller.download(),
    ])
      await expect(action()).rejects.toMatchObject({ code: "owner_changed" });
    expect(transport.calls).toHaveLength(requests);
    expect(controller.store.getState().working?.profile.bio).toHaveLength(8000);
  });
  it("recovers a lost session-transfer reply without advancing or duplicating a piece", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "bio"], "resume".repeat(2000));
    transport.before(async (action) => {
      if (action === "piece") {
        transport.before(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    const transferred = transport.pending();
    if (transferred) transferred.requiresResume = true;
    transport.after((action) => {
      if (action === "resume") {
        transport.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.resumeAttempt()).rejects.toMatchObject({
      code: "network",
    });
    expect(controller.store.getState().batch?.resume).toBeDefined();
    await controller.retry();
    expect(transport.get().draft.profile.bio).toBe("resume".repeat(2000));
    expect(controller.store.getState().status).toBe("saved");
  });
  it("stops when another session advances the cursor while a transfer is dispatched", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "bio"], "resume".repeat(2000));
    transport.before(async (action) => {
      if (action === "piece") {
        transport.before(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    const transferred = transport.pending();
    if (transferred) transferred.requiresResume = true;
    transport.before(async (action) => {
      if (action === "resume") {
        transport.before(null);
        const raced = transport.pending();
        if (raced) raced.sequence++;
      }
    });
    await expect(controller.resumeAttempt()).rejects.toMatchObject({
      code: "attempt_conflict",
    });
    expect(transport.get().revision).toBe(0);
    expect(transport.calls.filter((v) => v.action === "commit")).toHaveLength(
      0,
    );
  });
  it("retries a lost abort as discard and retains local values", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "bio"], "discard".repeat(2000));
    transport.before(async (action) => {
      if (action === "piece") {
        transport.before(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    transport.after((action) => {
      if (action === "abort") {
        transport.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.discardAttempt()).rejects.toMatchObject({
      code: "network",
    });
    expect(controller.store.getState().discardJournal?.confirmed).toBe(false);
    await controller.retry();
    expect(controller.store.getState().discardJournal).toBeNull();
    expect(controller.store.getState().working?.profile.bio).toBe(
      "discard".repeat(2000),
    );
    expect(transport.calls.filter((v) => v.action === "commit")).toHaveLength(
      0,
    );
    expect(transport.get().revision).toBe(0);
  });
  it("never replaces a known newer canonical snapshot with an older local receipt", async () => {
    const { controller: first, transport, storage } = setup();
    await first.initialize();
    first.edit(["profile", "name"], "Older committed name");
    first.edit(["profile", "bio"], "Older biography");
    transport.after((action) => {
      if (action === "cleanup") {
        transport.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(first.flushValid()).rejects.toMatchObject({ code: "network" });
    first.dispose();
    await first.persist();
    const source = [...storage.records.keys()][0] as string;
    await transport.transport.action("patch", {
      context: "content",
      revision: 1,
      change: {
        op: "set",
        path: ["profile", "name"],
        value: "Newer canonical name",
      },
    });
    const second = setup(transport, storage).controller;
    await expect(second.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    await second.restore(source);
    await expect(second.retry()).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(second.store.getState().confirmed?.revision).toBe(2);
    expect(transport.get().draft.profile.name).toBe("Newer canonical name");
  });
  it("does not abort an attempt that changed after the discard was displayed", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "bio"], "pending".repeat(2000));
    transport.before(async (action) => {
      if (action === "piece") {
        transport.before(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "network",
    });
    controller.store.setState({
      pending: structuredClone(transport.pending()),
    });
    const replaced = transport.pending();
    if (replaced) replaced.id = "another-device-attempt";
    await expect(controller.discardAttempt()).rejects.toMatchObject({
      code: "attempt_conflict",
    });
    expect(transport.calls.filter((v) => v.action === "abort")).toHaveLength(0);
  });
  it("permanently stops on an account mismatch reported by recovery download", async () => {
    const { controller, transport } = setup();
    await controller.initialize();
    controller.edit(["profile", "name"], "Original owner");
    transport.transport.download = async () => {
      throw new DraftFailure("owner_changed");
    };
    await expect(controller.download()).rejects.toMatchObject({
      code: "owner_changed",
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "owner_changed",
    });
    expect(controller.store.getState().working?.profile.name).toBe(
      "Original owner",
    );
  });
  it("restores valid working edits with a lost discard checkpoint after reload", async () => {
    vi.useFakeTimers();
    const { controller: first, transport, storage } = setup();
    await first.initialize();
    first.edit(["profile", "bio"], "preserved".repeat(1500));
    transport.before(async (action) => {
      if (action === "piece") {
        transport.before(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(first.flushValid()).rejects.toMatchObject({ code: "network" });
    transport.after((action) => {
      if (action === "abort") {
        transport.after(null);
        throw new DraftFailure("network", true);
      }
    });
    await expect(first.discardAttempt()).rejects.toMatchObject({
      code: "network",
    });
    first.dispose();
    await first.persist();
    const source = [...storage.records.keys()][0] as string;
    const second = setup(transport, storage).controller;
    await expect(second.initialize()).rejects.toMatchObject({
      code: "recovery_required",
    });
    await second.restore(source);
    await second.retry();
    expect(second.store.getState().working?.profile.bio).toBe(
      "preserved".repeat(1500),
    );
    expect(second.store.getState().batch).toBeNull();
    expect(storage.records.has(source)).toBe(false);
    await second.flushValid();
    expect(transport.get().draft.profile.bio).toBe("preserved".repeat(1500));
    expect(transport.get().revision).toBe(1);
  });
  it("waits for unfinished input persistence before a navigation flush completes", async () => {
    const { controller, storage } = setup();
    await controller.initialize();
    const put = storage.put;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    storage.put = async (record) => {
      await held;
      await put(record);
    };
    controller.setInput(["requestedSubdomain"], "unfinished input");
    let completed = false;
    const navigation = controller.flushValid().then((result) => {
      completed = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toBe(false);
    release();
    expect(await navigation).toEqual({ revision: 0, hasLocalOnlyInput: true });
    expect(
      [...storage.records.values()][0]?.inputs[
        JSON.stringify(["requestedSubdomain"])
      ]?.value,
    ).toBe("unfinished input");
  });
  it("does not clear a newer revision notification when an older save acknowledges", async () => {
    const { controller, transport, storage } = setup();
    await controller.initialize();
    controller.edit(["profile", "name"], "Acknowledged input");
    transport.after((action) => {
      if (action === "patch")
        controller.store.setState({
          error: "revision_conflict",
          status: "blocked",
        });
    });
    await expect(controller.flushValid()).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(transport.get().draft.profile.name).toBe("Acknowledged input");
    expect(controller.store.getState().confirmed?.revision).toBe(1);
    expect([...storage.records.values()][0]?.blocked).toBe("revision_conflict");
    expect(controller.store.getState().status).toBe("blocked");
    await expect(controller.retry()).rejects.toMatchObject({
      code: "revision_conflict",
    });
  });
});
