import {
  type DraftDoc,
  type DraftReadResult,
  draftSchema,
  encodeJson,
  type LegacyValidationResult,
  type SaveAttemptStatus,
  type SetupProgress,
  setupProgressSchema,
} from "@hasaweb/schema";
import { createStore } from "zustand/vanilla";
import { createCoordinator } from "./coordination";
import {
  applyChange,
  batchMode,
  equal,
  planChanges,
  resolveField,
} from "./planner";
import { createRecoveryStorage } from "./recovery";
import { createDraftTransport } from "./transport";
import {
  type Batch,
  type Context,
  type Coordinator,
  DraftFailure,
  type DraftState,
  type FieldPath,
  type RecoveryRecord,
  type RecoveryStorage,
  type Transport,
  type ValidationJournal,
} from "./types";
import {
  matchesValidationJournal,
  remainingValidationInputs,
  validationInputKey,
} from "./validation-input";

type Options = {
  ownerId: string;
  portfolioId: string;
  context: Context;
  transport?: Transport;
  storage?: RecoveryStorage;
  coordinator?: Coordinator;
  id?: string;
  timers?: {
    set: (task: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  };
};
const initial = (): DraftState => ({
  confirmed: null,
  working: null,
  progress: null,
  inputs: {},
  validationInputs: {},
  discardJournal: null,
  batch: null,
  pending: null,
  remoteAttemptId: null,
  recoveries: [],
  status: "loading",
  error: null,
  localRecoveryAvailable: true,
  validation: null,
  validationJournal: null,
});
export function createDraftController(options: Options) {
  const store = createStore<DraftState>()(initial);
  const id = options.id ?? crypto.randomUUID();
  const network =
    options.transport ??
    createDraftTransport(options.ownerId, options.portfolioId);
  const storage =
    options.storage ??
    createRecoveryStorage(options.ownerId, options.portfolioId);
  const coordinator =
    options.coordinator ??
    createCoordinator(
      options.ownerId,
      options.portfolioId,
      (revision) => {
        const state = store.getState();
        if (state.confirmed && revision > state.confirmed.revision) {
          // Notifications are advisory. Do not rebase or replace unsaved input.
          if (
            dirty() ||
            Object.keys(state.inputs).length ||
            Object.keys(state.validationInputs).length
          )
            fail(new DraftFailure("revision_conflict"));
          else void initialize().catch(() => {});
        }
      },
      (attemptId) => store.setState({ remoteAttemptId: attemptId }),
    );
  const timers = options.timers ?? {
    set: (task: () => void, ms: number) => setTimeout(task, ms),
    clear: (timer: unknown) =>
      clearTimeout(timer as ReturnType<typeof setTimeout>),
  };
  let timer: unknown,
    disposed = false,
    active: Promise<unknown> | null = null;
  let persistence = Promise.resolve();
  let recoverySource: RecoveryRecord | null = null;
  let recoveryBlock: RecoveryRecord["blocked"];
  const transport: Transport = {
    read: () => {
      throwIfDisposed();
      return network.read();
    },
    readProgress: () => {
      throwIfDisposed();
      return network.readProgress();
    },
    download: () => {
      throwIfDisposed();
      return network.download();
    },
    action: (action, body) => {
      // Check when dispatching, including after an awaited local checkpoint.
      // In-flight replies may still be recorded, but disposal starts no command.
      throwIfDisposed();
      return network.action(action, body);
    },
  };
  const state = () => store.getState();
  const blockedReason = () => {
    const code = state().error;
    return code === "revision_conflict" || code === "setup_closed"
      ? code
      : null;
  };
  const contextClosed = () =>
    options.context === "setup" &&
    state().confirmed?.firstEditorEnteredAt != null;
  function dirty() {
    const s = state();
    return Boolean(
      s.confirmed &&
        (!equal(s.working, s.confirmed.draft) ||
          (options.context === "setup" &&
            !equal(s.progress, s.confirmed.progress))),
    );
  }
  const hasLocalInput = () =>
    Boolean(
      Object.keys(state().inputs).length ||
        Object.keys(state().validationInputs).length,
    );
  function status() {
    const s = state();
    if (s.error) return;
    if (!s.confirmed || !s.working) {
      store.setState({ status: "loading" });
      return;
    }
    store.setState({
      status:
        s.batch || dirty()
          ? "saving"
          : Object.keys(s.inputs).length ||
              Object.keys(s.validationInputs).length
            ? "unsaved"
            : "saved",
    });
  }
  function record(): RecoveryRecord {
    const s = state();
    if (s.error === "revision_conflict" || s.error === "setup_closed")
      recoveryBlock = s.error;
    return structuredClone({
      version: 1,
      id,
      ownerId: options.ownerId,
      portfolioId: options.portfolioId,
      context: options.context,
      base: s.confirmed,
      working: s.working,
      progress: s.progress,
      inputs: s.inputs,
      validationInputs: s.validationInputs,
      batch: s.batch,
      validationJournal: s.validationJournal,
      discardJournal: s.discardJournal,
      ...(recoveryBlock ? { blocked: recoveryBlock } : {}),
    });
  }
  function persist() {
    const snapshot = record();
    // Capture before queuing: an older asynchronous write cannot erase newer input.
    persistence = persistence.then(async () => {
      try {
        if (
          !snapshot.batch &&
          !snapshot.validationJournal &&
          !snapshot.discardJournal &&
          !snapshot.blocked &&
          ((!snapshot.base && !snapshot.working) ||
            (equal(snapshot.working, snapshot.base?.draft) &&
              equal(snapshot.progress, snapshot.base?.progress))) &&
          !Object.keys(snapshot.inputs).length &&
          !Object.keys(snapshot.validationInputs ?? {}).length
        )
          await storage.remove(id);
        else await storage.put(snapshot);
      } catch {
        store.setState({ localRecoveryAvailable: false });
      }
    });
    return persistence;
  }
  function fail(error: unknown) {
    if (state().error === "owner_changed")
      return new DraftFailure("owner_changed");
    const failure =
      error instanceof DraftFailure ? error : new DraftFailure("save_rejected");
    const blocked = blockedReason();
    if (blocked && failure.code !== "owner_changed")
      return new DraftFailure(blocked);
    store.setState({
      error: failure.code,
      status: ["network", "storage_unavailable"].includes(failure.code)
        ? "failed"
        : "blocked",
    });
    void persist();
    return failure;
  }
  function cancelTimer() {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  }
  function schedule() {
    cancelTimer();
    if (disposed || state().error || !dirty()) {
      status();
      return;
    }
    store.setState({ status: "saving" });
    timer = timers.set(() => {
      timer = undefined;
      void flush(false).catch(() => {});
    }, 2000);
  }
  async function exclusive<T>(
    work: () => Promise<T>,
    allowConflict = false,
  ): Promise<T> {
    if (disposed) throw new Error("Draft controller is disposed");
    if (state().error === "owner_changed")
      throw new DraftFailure("owner_changed");
    const blocked = blockedReason();
    if (!allowConflict && blocked) throw new DraftFailure(blocked);
    const promise = (active ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        if (disposed) throw new Error("Draft controller is disposed");
        return coordinator.run(() => {
          throwIfDisposed();
          const blocked = blockedReason();
          if (!allowConflict && blocked) throw new DraftFailure(blocked);
          return work();
        });
      });
    active = promise;
    try {
      return await promise;
    } catch (error) {
      throw fail(error);
    } finally {
      if (active === promise) active = null;
    }
  }
  function checkPortfolio(result: DraftReadResult) {
    if (result.portfolioId !== options.portfolioId)
      throw new DraftFailure("owner_changed");
    return result;
  }
  async function initialize() {
    return exclusive(async () => {
      if (dirty() || state().batch || state().discardJournal || hasLocalInput())
        throw new DraftFailure("recovery_required");
      const records = await storage
        .list(options.ownerId, options.portfolioId)
        .catch(() => {
          store.setState({ localRecoveryAvailable: false });
          return [];
        });
      let result: DraftReadResult | null = null,
        readError: unknown;
      try {
        result = checkPortfolio(await transport.read());
      } catch (error) {
        if (error instanceof DraftFailure && error.code === "owner_changed")
          throw error;
        readError = error;
      }
      const pending = await transport.action<SaveAttemptStatus | null>(
        "pending",
        {},
      );
      store.setState({
        ...(result
          ? {
              confirmed: result,
              working: structuredClone(result.draft),
              progress: result.progress,
            }
          : {}),
        pending,
        recoveries: records.filter((entry) => entry.id !== id),
      });
      if (readError) throw readError;
      recoveryBlock = undefined;
      store.setState({ error: null });
      if (pending || records.some((entry) => entry.id !== id))
        throw new DraftFailure("recovery_required");
      status();
    });
  }
  function editable() {
    if (!state().working || disposed)
      throw new Error("Load the draft before editing");
    if (state().error === "owner_changed")
      throw new DraftFailure("owner_changed");
    if (contextClosed()) throw fail(new DraftFailure("setup_closed"));
  }
  function update(draft: DraftDoc) {
    editable();
    const working = draftSchema.parse(draft);
    store.setState({ working: structuredClone(working) });
    void persist();
    schedule();
  }
  function setInput(path: FieldPath, value: unknown) {
    editable();
    // Only JSON form values enter recovery. File/Blob sources, functions
    // and arbitrary browser objects cannot become local draft assets.
    encodeJson(value, Number.MAX_SAFE_INTEGER);
    const inputs = {
      ...state().inputs,
      [JSON.stringify(path)]: {
        path: structuredClone(path),
        value: structuredClone(value),
      },
    };
    store.setState({ inputs });
    void persist();
    status();
  }
  function clearInput(path: FieldPath) {
    editable();
    const inputs = { ...state().inputs };
    delete inputs[JSON.stringify(path)];
    store.setState({ inputs });
    void persist();
    status();
  }
  function setValidationInput(value: string) {
    throwIfDisposed();
    const journal = state().validationJournal;
    const issue = state().validation?.issue ?? state().pending?.validationIssue;
    if (
      !journal?.id ||
      issue?.code !== "invalid_destination" ||
      typeof value !== "string"
    )
      throw new DraftFailure("invalid_input");
    const key = validationInputKey(journal.baseRevision, issue.path);
    store.setState({
      validationInputs: {
        ...state().validationInputs,
        [key]: {
          baseRevision: journal.baseRevision,
          path: structuredClone(issue.path),
          value,
        },
      },
    });
    void persist();
    return key;
  }
  function clearValidationInput(key: string) {
    throwIfDisposed();
    const inputs = { ...state().validationInputs };
    delete inputs[key];
    store.setState({ validationInputs: inputs });
    void persist();
    status();
  }
  function edit(path: FieldPath, value: unknown): boolean {
    editable();
    const working = state().working as DraftDoc;
    try {
      const next = draftSchema.parse(
        applyChange(working, {
          op: "set",
          path: resolveField(working, path),
          value,
        }),
      );
      const inputs = { ...state().inputs };
      delete inputs[JSON.stringify(path)];
      store.setState({ inputs });
      update(next);
      return true;
    } catch (error) {
      if (error instanceof DraftFailure) throw error;
      setInput(path, value);
      return false;
    }
  }
  function changeProgress(progress: SetupProgress) {
    editable();
    if (options.context !== "setup")
      throw new Error("Content controllers cannot change setup progress");
    store.setState({ progress: setupProgressSchema.parse(progress) });
    void persist();
    schedule();
  }
  async function checkpoint(batch: Batch) {
    if (batch.attemptId && batch.attemptId !== state().batch?.attemptId)
      coordinator.publishAttempt(batch.attemptId);
    store.setState({ batch: structuredClone(batch) });
    await persist();
  }
  async function send<T>(
    batch: Batch,
    action: NonNullable<Batch["sent"]>["action"],
    body: unknown,
  ): Promise<T> {
    batch.sent = { action, body: structuredClone(body) };
    await checkpoint(batch);
    const result = await transport.action<T>(action, body);
    delete batch.sent;
    return result;
  }
  async function cleanup() {
    // 512 retained pieces / 32 per call plus the final empty receipt.
    for (let calls = 0; calls < 18; calls++) {
      const removed = await transport.action<{
        pieces: number;
        attempts: number;
      }>("cleanup", {});
      if (!removed.pieces && !removed.attempts) {
        coordinator.publishAttempt(null);
        return;
      }
    }
    throw new DraftFailure("storage_unavailable");
  }
  async function acknowledge(
    batch: Batch,
    revision: number,
    canonical?: DraftReadResult,
  ) {
    if (!Number.isSafeInteger(revision) || revision <= batch.base.revision)
      throw new DraftFailure("attempt_conflict");
    const known = state().confirmed;
    if (
      !canonical &&
      known &&
      known.revision >= revision &&
      known.revision > batch.base.revision
    ) {
      if (
        !equal(known.draft, batch.target) ||
        (options.context === "setup" && !equal(known.progress, batch.progress))
      )
        throw new DraftFailure("revision_conflict");
      canonical = known;
      revision = known.revision;
    }
    batch.confirmedRevision = revision;
    const confirmed: DraftReadResult = canonical ?? {
      ...batch.base,
      draft: structuredClone(batch.target),
      revision,
      progress:
        options.context === "setup" ? batch.progress : batch.base.progress,
    };
    store.setState({ confirmed });
    // Receipt and newer edits are durable before either checkpoint is cleared.
    await checkpoint(batch);
    if (recoverySource && state().localRecoveryAvailable) {
      await storage
        .remove(recoverySource.id, recoverySource)
        .catch(() => store.setState({ localRecoveryAvailable: false }));
      recoverySource = null;
    }
    if (batch.attemptId) await cleanup();
    const blocked =
      state().error === "owner_changed" ? "owner_changed" : blockedReason();
    store.setState({ batch: null, pending: null, error: blocked });
    await persist();
    coordinator.publish(revision);
    if (blocked) throw new DraftFailure(blocked);
    status();
  }
  async function execute(batch: Batch) {
    if (batch.confirmedRevision) {
      await acknowledge(batch, batch.confirmedRevision);
      return;
    }
    if (batch.mode === "patch" || batch.mode === "progress") {
      const command = batch.commands[0];
      const body =
        batch.mode === "progress"
          ? { revision: batch.base.revision, progress: batch.progress }
          : {
              context: options.context,
              revision: batch.base.revision,
              ...(options.context === "setup"
                ? { progress: batch.progress }
                : {}),
              change: command?.action === "change" ? command.change : undefined,
            };
      const result = await send<{ revision: number }>(batch, batch.mode, body);
      await acknowledge(batch, result.revision);
      return;
    }
    if (!batch.attemptId) {
      const result = await send<{ id: string; sequence: number }>(
        batch,
        "begin",
        {
          context: options.context,
          revision: batch.base.revision,
          ...(options.context === "setup" ? { progress: batch.progress } : {}),
        },
      );
      batch.attemptId = result.id;
      batch.sequence = result.sequence;
      await checkpoint(batch);
    }
    while (batch.index < batch.commands.length) {
      if (disposed) throw new DraftFailure("recovery_required");
      const command = batch.commands[batch.index];
      if (!command) throw new DraftFailure("invalid_input");
      const { action, ...payload } = command;
      const result = await send<{ sequence: number }>(batch, action, {
        id: batch.attemptId,
        sequence: batch.sequence,
        ...payload,
      });
      if (result.sequence !== batch.sequence + 1)
        throw new DraftFailure("attempt_conflict");
      batch.sequence = result.sequence;
      batch.index++;
      await checkpoint(batch);
    }
    if (disposed) throw new DraftFailure("recovery_required");
    const result = await send<{ revision: number }>(batch, "commit", {
      id: batch.attemptId,
      sequence: batch.sequence,
    });
    await acknowledge(batch, result.revision);
  }
  async function flush(drain: boolean) {
    cancelTimer();
    return exclusive(async () => {
      if (state().error)
        throw new DraftFailure(state().error as DraftFailure["code"]);
      if (contextClosed()) throw new DraftFailure("setup_closed");
      // A timer added during the origin-lock wait belongs to newer input.
      // Controlled navigation also waits for the already queued local writes,
      // including raw-only edits which produce no network command.
      while (!disposed) {
        if (state().error)
          throw new DraftFailure(state().error as DraftFailure["code"]);
        if (dirty() && (drain || timer === undefined)) {
          const base = state().confirmed;
          const target = state().working;
          if (!base || !target) throw new DraftFailure("not_found");
          const commands = planChanges(base.draft, target);
          const batch: Batch = {
            base: structuredClone(base),
            target: structuredClone(target),
            progress: structuredClone(state().progress ?? base.progress),
            commands,
            mode: batchMode(commands),
            sequence: 0,
            index: 0,
          };
          await checkpoint(batch);
          await execute(batch);
          if (drain) continue;
        }
        const local = persistence;
        await local;
        if (!drain || (!dirty() && local === persistence)) break;
      }
      throwIfDisposed();
      status();
      const revision = state().confirmed?.revision;
      if (revision === undefined) throw new DraftFailure("not_found");
      return {
        revision,
        hasLocalOnlyInput: hasLocalInput(),
      };
    });
  }
  function flushValid() {
    return flush(true);
  }
  async function reconcileDirect(batch: Batch) {
    const canonical = checkPortfolio(await transport.read());
    if (
      equal(canonical.draft, batch.target) &&
      (options.context === "content" ||
        equal(canonical.progress, batch.progress)) &&
      canonical.revision > batch.base.revision
    ) {
      await acknowledge(batch, canonical.revision, canonical);
      return true;
    }
    if (canonical.revision !== batch.base.revision)
      throw new DraftFailure("revision_conflict");
    if (canonical.firstEditorEnteredAt !== null && options.context === "setup")
      throw new DraftFailure("setup_closed");
    return false;
  }
  async function resumeJournal(
    journal: Batch | ValidationJournal,
    pending: SaveAttemptStatus,
    explicit: boolean,
    save: () => Promise<void>,
  ) {
    const sequence = journal.resume ?? journal.sequence;
    if (pending.requiresResume) {
      if (!explicit) throw new DraftFailure("recovery_required");
      if (pending.sequence !== sequence)
        throw new DraftFailure("attempt_conflict");
    } else if (
      journal.resume === undefined ||
      pending.sequence !== sequence + 1
    )
      throw new DraftFailure("attempt_conflict");
    // A transfer invalidates the previous session's command receipt. Never
    // transfer a command which may already have advanced the cursor.
    journal.resume = sequence;
    await save();
    const resumed = await transport.action<SaveAttemptStatus>("resume", {
      id: pending.id,
    });
    if (
      resumed.id !== pending.id ||
      resumed.baseRevision !== pending.baseRevision ||
      resumed.context !== pending.context ||
      resumed.requiresResume ||
      resumed.sequence !== sequence + 1
    )
      throw new DraftFailure("attempt_conflict");
    journal.sequence = resumed.sequence;
    delete journal.resume;
    store.setState({ pending: resumed });
    await save();
    return resumed;
  }
  async function inspectBatch(batch: Batch, transfer: boolean) {
    const pending = await transport.action<SaveAttemptStatus | null>(
      "pending",
      {},
    );
    store.setState({ pending });
    if (!pending) {
      if (await reconcileDirect(batch)) return true;
      throw new DraftFailure("attempt_unavailable");
    }
    if (
      (batch.attemptId && pending.id !== batch.attemptId) ||
      pending.baseRevision !== batch.base.revision ||
      pending.context !== options.context
    )
      throw new DraftFailure("attempt_conflict");
    if (!batch.attemptId) {
      // Begin has no client idempotency key. Even sequence zero could belong
      // to another device and capture different setup progress. Origin locks
      // cannot prove its identity. Keep the input for explicit discard/rebuild.
      throw new DraftFailure("journal_missing");
    }
    if (pending.state === "committed") {
      if (
        pending.requiresResume ||
        batch.index !== batch.commands.length ||
        batch.sent?.action !== "commit" ||
        pending.sequence !== batch.sequence
      ) {
        if (await reconcileDirect(batch)) return true;
        throw new DraftFailure("attempt_conflict");
      }
      const receipt = await transport.action<{ revision: number }>("commit", {
        id: pending.id,
        sequence: pending.sequence,
      });
      await acknowledge(batch, receipt.revision);
      return true;
    }
    if (!["open", "string"].includes(pending.state))
      throw new DraftFailure("attempt_unavailable");
    if (batch.resume !== undefined || pending.requiresResume) {
      await resumeJournal(batch, pending, transfer, () => checkpoint(batch));
      delete batch.sent;
    } else if (
      pending.sequence === batch.sequence + 1 &&
      batch.sent &&
      !["begin", "commit"].includes(batch.sent.action)
    ) {
      const receipt = await transport.action<{ sequence: number }>(
        batch.sent.action,
        batch.sent.body,
      );
      if (receipt.sequence !== pending.sequence)
        throw new DraftFailure("attempt_conflict");
      batch.index++;
      batch.sequence++;
      delete batch.sent;
    } else if (pending.sequence !== batch.sequence)
      throw new DraftFailure("attempt_conflict");
    await checkpoint(batch);
    return false;
  }
  async function retry(transfer = false) {
    if (state().error === "owner_changed")
      throw new DraftFailure("owner_changed");
    const blocked = blockedReason();
    if (blocked) throw new DraftFailure(blocked);
    if (state().discardJournal) return discardAttempt(true);
    if (state().validationJournal) return validateLegacy();
    if (!state().confirmed && !state().batch) {
      await initialize();
      return flushValid();
    }
    await exclusive(async () => {
      if (state().error === "owner_changed")
        throw new DraftFailure("owner_changed");
      const batch = state().batch;
      store.setState({ error: null, status: "saving" });
      if (!batch) {
        const pending = await transport.action<SaveAttemptStatus | null>(
          "pending",
          {},
        );
        store.setState({ pending });
        if (pending) throw new DraftFailure("recovery_required");
        return;
      }
      if (batch.confirmedRevision) {
        await execute(batch);
        return;
      }
      const recovered =
        batch.mode === "staged"
          ? await inspectBatch(batch, transfer)
          : await reconcileDirect(batch);
      if (!recovered) await execute(batch);
    });
    return flushValid();
  }
  async function restore(recordId: string) {
    await exclusive(async () => {
      if (dirty() || state().batch) throw new DraftFailure("recovery_required");
      const records = await storage.list(options.ownerId, options.portfolioId);
      const saved = records.find((entry) => entry.id === recordId);
      if (
        !saved ||
        saved.ownerId !== options.ownerId ||
        saved.portfolioId !== options.portfolioId
      )
        throw new DraftFailure("owner_changed");
      if (
        saved.validationJournal ||
        (!saved.working &&
          (saved.discardJournal ||
            Object.keys(saved.validationInputs ?? {}).length))
      ) {
        recoverySource = structuredClone(saved);
        store.setState({
          inputs: { ...saved.inputs, ...state().inputs },
          validationInputs: {
            ...saved.validationInputs,
            ...state().validationInputs,
          },
          validationJournal: saved.validationJournal,
          discardJournal: saved.discardJournal ?? null,
          error: saved.blocked ?? "validation_required",
          status: "blocked",
        });
        await persist();
        return;
      }
      // A setup record after handoff is exposed as local input, never setup writes.
      if (saved.context !== options.context || contextClosed()) {
        store.setState({
          inputs: { ...saved.inputs, ...state().inputs },
          validationInputs: {
            ...saved.validationInputs,
            ...state().validationInputs,
          },
          error: "setup_closed",
          status: "blocked",
        });
        throw new DraftFailure("setup_closed");
      }
      recoverySource = structuredClone(saved);
      store.setState({
        inputs: { ...saved.inputs, ...state().inputs },
        validationInputs: {
          ...saved.validationInputs,
          ...state().validationInputs,
        },
      });
      if (!saved.batch && saved.base?.revision !== state().confirmed?.revision)
        throw new DraftFailure("revision_conflict");
      store.setState({
        working: saved.working,
        progress: saved.progress,
        batch: saved.batch,
        discardJournal: saved.discardJournal ?? null,
        recoveries: records.filter(
          (entry) => entry.id !== saved.id && entry.id !== id,
        ),
        error: saved.blocked ?? (saved.batch ? "recovery_required" : null),
      });
      await persist();
      if (!saved.batch && !saved.blocked) {
        if (state().localRecoveryAvailable) {
          await storage.remove(saved.id, recoverySource ?? saved);
          recoverySource = null;
        }
        schedule();
      } else store.setState({ status: "blocked" });
    });
  }
  async function discardRecovery(recordId: string) {
    await exclusive(async () => {
      const records = await storage.list(options.ownerId, options.portfolioId);
      const saved = records.find((entry) => entry.id === recordId);
      if (!saved) throw new DraftFailure("owner_changed");
      await storage.remove(recordId, saved);
      store.setState({
        recoveries: state().recoveries.filter((entry) => entry.id !== recordId),
      });
      if (
        !blockedReason() &&
        !state().pending &&
        !state().batch &&
        !state().validationJournal &&
        !state().discardJournal &&
        !state().recoveries.length
      ) {
        store.setState({ error: null });
        if (!state().confirmed) await initializeAfterDiscard();
        schedule();
      } else status();
    }, true);
  }
  async function discardAttempt(recover = false) {
    await exclusive(async () => {
      const blocked = blockedReason();
      const savedIntent = state().discardJournal;
      const expected =
        savedIntent?.id ??
        state().pending?.id ??
        state().batch?.attemptId ??
        state().validationJournal?.id;
      const pending = await transport.action<SaveAttemptStatus | null>(
        "pending",
        {},
      );
      store.setState({ pending });
      if (pending && expected && pending.id !== expected)
        throw new DraftFailure("attempt_conflict");
      if (recover && !savedIntent) throw new DraftFailure("recovery_required");
      if (
        blocked &&
        (!pending || pending.state === "committed") &&
        !savedIntent
      )
        throw new DraftFailure(blocked);
      if (!savedIntent && pending?.state === "committed") {
        const batch = state().batch;
        if (batch) {
          await inspectBatch(batch, false);
          return;
        }
        if (dirty() || Object.keys(state().inputs).length)
          throw new DraftFailure("revision_conflict");
        const canonical = checkPortfolio(await transport.read());
        if (canonical.revision <= pending.baseRevision)
          throw new DraftFailure("attempt_conflict");
        store.setState({
          confirmed: canonical,
          working: canonical.draft,
          progress: canonical.progress,
          error: null,
        });
      }
      const metadata = await transport.readProgress();
      if (metadata.portfolioId !== options.portfolioId)
        throw new DraftFailure("owner_changed");
      const intent = savedIntent ?? {
        id: pending?.id ?? null,
        revision: metadata.revision,
        confirmed: false,
      };
      // This checkpoint survives a lost abort or cleanup reply. Retry completes
      // the explicit discard; it never resumes content execution.
      store.setState({ discardJournal: intent });
      await persist();
      if (!intent.confirmed) {
        if (
          pending &&
          pending.state !== "committed" &&
          pending.state !== "aborted"
        ) {
          if (pending.requiresResume)
            await transport.action("resume", { id: pending.id });
          await transport.action("abort", { id: pending.id });
        }
        intent.confirmed = true;
        intent.revision = metadata.revision;
        store.setState({ discardJournal: { ...intent } });
        await persist();
      }
      // A different device may have advanced the canonical draft. Preserve the
      // original working state instead of silently rebasing it after discard.
      const base = state().batch?.base ?? state().confirmed;
      if (base && base.revision !== metadata.revision)
        throw new DraftFailure("revision_conflict");
      await cleanup();
      store.setState({
        validationJournal: null,
        validation: null,
        pending: null,
        batch: null,
        discardJournal: null,
      });
      await persist();
      if (recoverySource && state().localRecoveryAvailable) {
        await storage.remove(recoverySource.id, recoverySource);
        recoverySource = null;
      }
      if (blocked) throw new DraftFailure(blocked);
      if (!state().confirmed) await initializeAfterDiscard();
      store.setState({ error: null });
      await persist();
      if (contextClosed()) throw new DraftFailure("setup_closed");
      schedule();
    }, true);
  }
  async function initializeAfterDiscard() {
    // Validation abort leaves the canonical draft unvalidated. Read it again
    // before offering editing, rather than reporting Saved without a snapshot.
    if (Object.keys(state().inputs).length)
      throw new DraftFailure("recovery_required");
    const canonical = checkPortfolio(await transport.read());
    const batch = state().batch;
    if (batch && batch.base.revision !== canonical.revision)
      throw new DraftFailure("revision_conflict");
    store.setState({
      confirmed: canonical,
      working: state().working ?? canonical.draft,
      progress: state().progress ?? canonical.progress,
    });
  }
  async function validateLegacy(correction?: string, transfer = false) {
    return exclusive(async () => {
      if (dirty() || state().batch || Object.keys(state().inputs).length)
        throw new DraftFailure("recovery_required");
      let pending = await transport.action<SaveAttemptStatus | null>(
        "pending",
        {},
      );
      if (pending && pending.context !== "validation")
        throw new DraftFailure("recovery_required");
      if (
        pending &&
        pending.state !== "committed" &&
        !matchesValidationJournal(pending, state().validationJournal)
      )
        throw new DraftFailure("journal_missing");
      if (pending && !["open", "committed"].includes(pending.state))
        throw new DraftFailure("attempt_unavailable");
      if (correction !== undefined) setValidationInput(correction);
      const journal: ValidationJournal = structuredClone(
        state().validationJournal ?? {
          baseRevision:
            pending?.baseRevision ?? (await transport.readProgress()).revision,
          sequence: pending?.sequence ?? 0,
          ...(pending ? { id: pending.id } : {}),
        },
      );
      if (pending && journal.id && journal.id !== pending.id)
        throw new DraftFailure("attempt_conflict");
      const saveJournal = async () => {
        if (journal.id && journal.id !== state().validationJournal?.id)
          coordinator.publishAttempt(journal.id);
        store.setState({ validationJournal: structuredClone(journal) });
        await persist();
      };
      const command = async <T>(
        action: NonNullable<ValidationJournal["sent"]>["action"],
        body: unknown,
      ) => {
        journal.sent = { action, body: structuredClone(body) };
        await saveJournal();
        try {
          const result = await transport.action<T>(action, body);
          delete journal.sent;
          return result;
        } catch (error) {
          if (
            error instanceof DraftFailure &&
            !error.uncertain &&
            ["invalid_input", "byte_limit"].includes(error.code)
          ) {
            delete journal.sent;
            await saveJournal();
          }
          throw error;
        }
      };
      // Numeric issue paths and corrections belong to this journal's immutable
      // base. Metadata alone cannot authorize committing another browser's work.
      if (pending) {
        journal.id = pending.id;
        if (pending.state !== "committed") {
          if (journal.resume !== undefined || pending.requiresResume) {
            const previous = journal.sent;
            pending = await resumeJournal(
              journal,
              pending,
              transfer,
              saveJournal,
            );
            if (previous && previous.action !== "validation-begin")
              journal.sent = {
                ...previous,
                body: {
                  ...(previous.body as Record<string, unknown>),
                  sequence: journal.sequence,
                },
              };
          }
          if (journal.sent && journal.sent.action !== "commit") {
            if (journal.sent.action === "validation-begin") delete journal.sent;
            else {
              if (
                ![journal.sequence, journal.sequence + 1].includes(
                  pending.sequence,
                )
              )
                throw new DraftFailure("attempt_conflict");
              // A replacement is safe only when metadata proves the abandoned
              // correction has not run. Otherwise replay its exact receipt.
              if (
                correction !== undefined &&
                journal.sent.action === "validation-correct" &&
                pending.sequence === journal.sequence
              )
                delete journal.sent;
              else {
                const reply = await command<{ sequence: number }>(
                  journal.sent.action,
                  journal.sent.body,
                );
                if (reply.sequence !== journal.sequence + 1)
                  throw new DraftFailure("attempt_conflict");
                journal.sequence = reply.sequence;
                pending = await transport.action<SaveAttemptStatus>("status", {
                  id: journal.id,
                });
              }
            }
          } else if (pending.sequence !== journal.sequence)
            throw new DraftFailure("attempt_conflict");
        }
      } else {
        throwIfDisposed();
        const metadata = await transport.readProgress();
        if (metadata.portfolioId !== options.portfolioId)
          throw new DraftFailure("owner_changed");
        if (journal.id || journal.confirmedRevision) {
          const canonical = checkPortfolio(await transport.read());
          if (
            !journal.confirmedRevision ||
            canonical.revision < journal.confirmedRevision
          )
            throw new DraftFailure("attempt_unavailable");
          store.setState({
            confirmed: canonical,
            working: canonical.draft,
            progress: canonical.progress,
            validationJournal: null,
            validationInputs: remainingValidationInputs(
              state().validationInputs,
              canonical,
              journal.baseRevision,
              journal.confirmedRevision,
            ),
            error: null,
          });
          await persist();
          status();
          return;
        }
        journal.baseRevision = metadata.revision;
        const start = await command<{ id: string; sequence: number }>(
          "validation-begin",
          { revision: metadata.revision },
        );
        journal.id = start.id;
        journal.sequence = start.sequence;
      }
      await saveJournal();
      const attemptId = journal.id as string;
      if (correction !== undefined) {
        const issue = pending?.validationIssue;
        if (issue?.code !== "invalid_destination")
          throw new DraftFailure("invalid_input");
        const corrected = await command<{ sequence: number }>(
          "validation-correct",
          {
            id: attemptId,
            sequence: journal.sequence,
            path: issue.path,
            value: correction,
          },
        );
        journal.sequence = corrected.sequence;
        pending = null;
        await saveJournal();
      }
      while (!disposed) {
        const result: LegacyValidationResult =
          pending?.validationComplete ||
          pending?.validationIssue ||
          pending?.state === "committed"
            ? {
                sequence: pending.sequence,
                complete: pending.validationComplete,
                issue: pending.validationIssue,
              }
            : await command<LegacyValidationResult>("validation-step", {
                id: attemptId,
                sequence: journal.sequence,
              });
        journal.sequence = result.sequence;
        await saveJournal();
        store.setState({ validation: result, pending });
        if (result.issue) {
          const inspection = await transport.action<SaveAttemptStatus>(
            "status",
            { id: attemptId },
          );
          store.setState({
            pending: inspection,
            error: "validation_required",
            status: "blocked",
          });
          return;
        }
        if (!result.complete) {
          pending = null;
          continue;
        }
        const receipt = await command<{ revision: number }>("commit", {
          id: attemptId,
          sequence: journal.sequence,
        });
        journal.confirmedRevision = receipt.revision;
        await saveJournal();
        const canonical = checkPortfolio(await transport.read());
        if (canonical.revision < receipt.revision)
          throw new DraftFailure("revision_conflict");
        store.setState({
          confirmed: canonical,
          working: canonical.draft,
          progress: canonical.progress,
          validationInputs: remainingValidationInputs(
            state().validationInputs,
            canonical,
            journal.baseRevision,
            receipt.revision,
          ),
          error: null,
          pending: null,
        });
        await persist();
        await cleanup();
        store.setState({ validationJournal: null });
        await persist();
        if (recoverySource && state().localRecoveryAvailable) {
          await storage.remove(recoverySource.id, recoverySource);
          recoverySource = null;
        }
        status();
        return;
      }
    });
  }
  function throwIfDisposed() {
    if (disposed) throw new DraftFailure("recovery_required");
    if (state().error === "owner_changed")
      throw new DraftFailure("owner_changed");
  }
  function dispose() {
    disposed = true;
    cancelTimer();
    coordinator.close();
    void persist();
  }
  return {
    scopeKey: JSON.stringify([options.ownerId, options.portfolioId, id]),
    store,
    initialize,
    update,
    edit,
    setInput,
    clearInput,
    setValidationInput,
    clearValidationInput,
    changeProgress,
    flushValid,
    retry,
    restore,
    discardRecovery,
    discardAttempt,
    resumeAttempt: async () => {
      if (
        state().pending?.context !== "validation" &&
        !state().validationJournal
      )
        return retry(true);
      if (state().pending?.state === "committed" && !state().validationJournal)
        return discardAttempt();
      return validateLegacy(undefined, true);
    },
    validateLegacy,
    download: () => exclusive(() => transport.download(), true),
    persist,
    dispose,
  };
}
export type DraftController = ReturnType<typeof createDraftController>;
