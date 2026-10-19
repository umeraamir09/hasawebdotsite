import type { DraftReadResult, SaveAttemptStatus } from "@hasaweb/schema";
import { createStore } from "zustand/vanilla";
import { readContinuation, writeContinuation } from "./auth-recovery";
import {
  createDraftController,
  type DraftController,
  recoverable,
} from "./controller";
import { createRecoveryStorage } from "./recovery";
import { applySelections, compareRecovery } from "./review";
import { createDraftTransport } from "./transport";
import {
  type Context,
  DraftFailure,
  type RecoveryRecord,
  type RecoveryStorage,
  type ReviewItem,
  type Transport,
} from "./types";

type Options = {
  ownerId: string;
  portfolioId: string;
  context: Context;
  controller?: DraftController;
  storage?: RecoveryStorage;
  transport?: Transport;
};
type RecoveryState = {
  controller: DraftController;
  review: RecoveryRecord | null;
  items: ReviewItem[];
  selected: string[];
  error: string | null;
  busy: boolean;
};
export function createRecoveryCoordinator(options: Options) {
  const storage =
    options.storage ??
    createRecoveryStorage(options.ownerId, options.portfolioId);
  const transport =
    options.transport ??
    createDraftTransport(options.ownerId, options.portfolioId);
  const make = (context: Context, id?: string) =>
    createDraftController({
      ...options,
      context,
      ...(id ? { id } : {}),
      storage,
      transport,
    });
  const store = createStore<RecoveryState>()(() => ({
    controller: options.controller ?? make(options.context),
    review: null,
    items: [],
    selected: [],
    error: null,
    busy: false,
  }));
  let running = false;
  async function action<T>(work: () => Promise<T>): Promise<T> {
    if (running) throw new DraftFailure("recovery_required");
    running = true;
    store.setState({ busy: true, error: null });
    try {
      return await work();
    } catch (error) {
      store.setState({
        error:
          error instanceof Error ? error.message : "Recovery could not finish",
      });
      throw error;
    } finally {
      if (!store.getState().review)
        store.getState().controller.releaseReviewPause();
      running = false;
      store.setState({ busy: false });
    }
  }
  function scope(record: RecoveryRecord) {
    if (
      record.ownerId !== options.ownerId ||
      record.portfolioId !== options.portfolioId
    )
      throw new DraftFailure("owner_changed");
    return record;
  }
  async function canonical() {
    const result = await transport.read();
    if (result.portfolioId !== options.portfolioId)
      throw new DraftFailure("owner_changed");
    return result;
  }
  async function noPending(allowCommitted = false) {
    const pending = await transport.action<SaveAttemptStatus | null>(
      "pending",
      {},
    );
    if (pending) {
      store.getState().controller.store.setState({ pending });
      if (!allowCommitted || pending.state !== "committed")
        throw new DraftFailure("journal_missing");
    }
    return pending;
  }
  async function getRecord(id: string) {
    const record = (
      await storage.list(options.ownerId, options.portfolioId)
    ).find((v) => v.id === id);
    if (!record) throw new DraftFailure("recovery_required");
    return scope(record);
  }
  function remapContinuation(
    source: RecoveryRecord,
    replacement: RecoveryRecord,
  ) {
    if (typeof sessionStorage !== "undefined") {
      const continuation = readContinuation();
      if (
        continuation?.recordId === source.id &&
        continuation.ownerId === source.ownerId &&
        continuation.portfolioId === source.portfolioId
      )
        writeContinuation(replacement);
    }
  }
  async function finishReviewReceipt(
    source: RecoveryRecord,
  ): Promise<RecoveryRecord> {
    if (!source.review?.receipt) return source;
    let review = source;
    const receipt = source.review.receipt;
    const id = crypto.randomUUID();
    const controller = make("content", id);
    async function checkpoint(recoveryId: string) {
      if (!review.review) throw new DraftFailure("recovery_required");
      review = {
        ...review,
        review: { ...review.review, receipt: { ...receipt, recoveryId } },
      };
      await storage.put(review);
      store.setState({ review });
    }
    try {
      await controller.initialize().catch((error) => {
        if (!controller.store.getState().confirmed) throw error;
      });
      const saved = receipt.recoveryId
        ? (await storage.list(options.ownerId, options.portfolioId)).find(
            (entry) => entry.id === receipt.recoveryId,
          )
        : undefined;
      if (saved?.discardJournal) {
        await controller.restore(saved.id, async (replacement) => {
          await checkpoint(replacement.id);
        });
        await controller.retry();
      } else {
        const pending = controller.store.getState().pending;
        if (
          pending &&
          (pending.id !== receipt.pending.id || pending.state !== "committed")
        )
          throw new DraftFailure("attempt_conflict");
        // Pin the displayed terminal receipt even if it disappeared since review.
        controller.store.setState({ pending: receipt.pending });
        await checkpoint(id);
        await controller.discardAttempt();
      }
      if (!review.review) throw new DraftFailure("recovery_required");
      const { receipt: _receipt, ...decision } = review.review;
      review = { ...review, review: decision };
      await storage.put(review);
      store.setState({ review });
      controller.dispose();
      await controller.persist();
      return review;
    } catch (error) {
      if (controller.store.getState().discardJournal)
        store.setState({ controller });
      else controller.dispose();
      throw error;
    }
  }
  async function start(
    recordId?: string,
    choice: "review" | "load" = "review",
  ) {
    return action(async () => {
      const controller = store.getState().controller;
      // Quiesce before copying. An in-flight acknowledgement may update the base.
      const checkpoint = await controller.quiesce();
      const source = recordId ? await getRecord(recordId) : checkpoint;
      scope(source);
      const pending = await noPending(true);
      const latest = await canonical();
      if (
        (source.validationJournal && pending?.state !== "committed") ||
        source.discardJournal ||
        (source.batch?.mode === "staged" &&
          (source.batch.sent || source.batch.attemptId) &&
          !source.blocked &&
          pending?.state !== "committed" &&
          !(source.context === "setup" && latest.firstEditorEnteredAt !== null))
      )
        throw new DraftFailure("recovery_required");
      const review: RecoveryRecord = {
        ...structuredClone(source),
        id: crypto.randomUUID(),
        reviewOnly: false,
        review: {
          version: 1,
          phase: "review",
          choice,
          canonical: latest,
          selection: { itemIds: [] },
          ...(pending ? { receipt: { pending } } : {}),
        },
      };
      // The review copy exists before conditional retirement of either source.
      await storage.put(review);
      remapContinuation(source, review);
      controller.dispose();
      await controller.persist();
      store.setState({
        review,
        items: compareRecovery(review, latest),
        selected: [],
      });
      await storage.remove(source.id, source);
      // Reviewing an archived record must not delete the active scope's newer
      // work. Keep a recoverable checkpoint; only a clean one is retired.
      if (checkpoint.id !== source.id && !recoverable(checkpoint))
        await storage.remove(checkpoint.id, checkpoint);
      await finishReviewReceipt(review);
    });
  }
  async function reopen(recordId: string) {
    return action(async () => {
      if (store.getState().review) throw new DraftFailure("recovery_required");
      let source = await getRecord(recordId);
      if (!source.review) throw new DraftFailure("recovery_required");
      const previous = store.getState().controller;
      const checkpoint = await previous.quiesce();
      if (
        checkpoint.working &&
        checkpoint.base &&
        JSON.stringify(checkpoint.working) !==
          JSON.stringify(checkpoint.base.draft)
      )
        throw new DraftFailure("recovery_required");
      const prepared = source.review.phase === "prepared";
      const replacement =
        prepared && source.review.replacementId
          ? (await storage.list(options.ownerId, options.portfolioId)).find(
              (entry) => entry.id === source.review?.replacementId,
            )
          : undefined;
      const journal = Boolean(
        replacement?.batch ||
          replacement?.validationJournal ||
          replacement?.discardJournal,
      );
      let latest: DraftReadResult | undefined;
      if (!journal) {
        const pending = await noPending(true);
        if (pending && !source.review.receipt) {
          source = {
            ...source,
            review: { ...source.review, receipt: { pending } },
          };
          await storage.put(source);
        }
        store.setState({ review: source });
        source = await finishReviewReceipt(source);
        if (!source.review) throw new DraftFailure("recovery_required");
        latest = await canonical();
        if (
          prepared &&
          (!replacement?.base ||
            replacement.base.revision !== latest.revision ||
            replacement.base.firstEditorEnteredAt !==
              latest.firstEditorEnteredAt)
        ) {
          const refreshed: RecoveryRecord = {
            ...source,
            reviewOnly: false,
            review: {
              ...source.review,
              phase: "review",
              canonical: latest,
              selection: { itemIds: [] },
            },
          };
          await storage.put(refreshed);
          if (replacement) {
            // Preserve the prepared target too. Another tab may have updated it.
            await storage.put({
              ...replacement,
              id: crypto.randomUUID(),
              reviewOnly: true,
              review: {
                version: 1,
                phase: "resolved",
                choice: "review",
                canonical: latest,
                selection: { itemIds: [] },
              },
            });
            await storage.remove(replacement.id, replacement);
          }
          previous.dispose();
          await previous.persist();
          store.setState({
            review: refreshed,
            items: compareRecovery(refreshed, latest),
            selected: [],
          });
          throw new DraftFailure("review_changed");
        }
      }
      if (prepared && replacement) {
        const controller = make(replacement.context);
        await controller.initialize().catch(() => {});
        await controller.quiesce();
        previous.dispose();
        await previous.persist();
        store.setState({ controller });
        if (!journal && controller.store.getState().pending)
          throw new DraftFailure("journal_missing");
        let activeRecord = replacement;
        await controller.restore(replacement.id, async (record) => {
          if (!source.review) throw new DraftFailure("recovery_required");
          activeRecord = record;
          source = {
            ...source,
            review: { ...source.review, replacementId: record.id },
          };
          await storage.put(source);
          remapContinuation(replacement, record);
        });
        if (!controller.store.getState().localRecoveryAvailable)
          throw new DraftFailure("storage_unavailable");
        if (!source.review) throw new DraftFailure("recovery_required");
        await storage.put({
          ...source,
          reviewOnly: true,
          review: { ...source.review, phase: "resolved" },
        });
        remapContinuation(source, activeRecord);
        controller.store.setState({
          recoveries: (
            await storage.list(options.ownerId, options.portfolioId)
          ).filter((entry) => entry.id !== activeRecord.id),
        });
        store.setState({ controller, review: null, items: [], selected: [] });
        controller.releaseReviewPause();
        if (journal) await controller.retry();
        else await controller.flushValid();
        await controller.persist();
        return;
      }
      if (!source.review) throw new DraftFailure("recovery_required");
      latest ??= await canonical();
      previous.dispose();
      await previous.persist();
      const same =
        source.review.canonical.revision === latest.revision &&
        source.review.canonical.firstEditorEnteredAt ===
          latest.firstEditorEnteredAt;
      const review: RecoveryRecord = {
        ...source,
        reviewOnly: false,
        review: {
          ...source.review,
          phase: "review",
          canonical: latest,
          selection: same ? source.review.selection : { itemIds: [] },
        },
      };
      await storage.put(review);
      store.setState({
        review,
        items: compareRecovery(review, latest),
        selected: review.review?.selection.itemIds ?? [],
      });
    });
  }
  async function select(itemId: string, checked: boolean) {
    return action(async () => {
      const state = store.getState(),
        review = state.review;
      if (
        !review?.review ||
        !state.items.some((v) => v.id === itemId && v.selectable)
      )
        throw new DraftFailure("invalid_input");
      const selected = checked
        ? [...new Set([...state.selected, itemId])]
        : state.selected.filter((v) => v !== itemId);
      const next = {
        ...review,
        review: { ...review.review, selection: { itemIds: selected } },
      };
      await storage.put(next);
      store.setState({ review: next, selected });
    });
  }
  async function apply(loadNewer = false) {
    return action(async () => {
      const state = store.getState();
      let source = state.review;
      if (!source?.review) throw new DraftFailure("recovery_required");
      source = await finishReviewReceipt(source);
      if (!source.review) throw new DraftFailure("recovery_required");
      await noPending();
      const latest = await canonical();
      if (
        latest.revision !== source.review.canonical.revision ||
        latest.firstEditorEnteredAt !==
          source.review.canonical.firstEditorEnteredAt
      ) {
        const refreshed = {
          ...source,
          review: {
            ...source.review,
            canonical: latest,
            selection: { itemIds: [] },
          },
        };
        await storage.put(refreshed);
        store.setState({
          review: refreshed,
          items: compareRecovery(source, latest),
          selected: [],
        });
        throw new DraftFailure("review_changed");
      }
      const result = loadNewer
        ? { draft: latest.draft, progress: latest.progress }
        : applySelections(source, latest, state.items, {
            itemIds: state.selected,
          });
      const id = crypto.randomUUID();
      const context =
        latest.firstEditorEnteredAt !== null ? "content" : source.context;
      const replacement: RecoveryRecord = {
        version: 1,
        id,
        ownerId: options.ownerId,
        portfolioId: options.portfolioId,
        context,
        base: latest,
        working: result.draft,
        progress: context === "setup" ? result.progress : latest.progress,
        inputs: loadNewer ? {} : structuredClone(source.inputs),
        validationInputs: loadNewer
          ? {}
          : structuredClone(source.validationInputs ?? {}),
        batch: null,
        validationJournal: null,
      };
      const prepared: RecoveryRecord = {
        ...source,
        review: {
          ...source.review,
          phase: "prepared",
          choice: loadNewer ? "load" : "review",
          replacementId: id,
          selection: { itemIds: loadNewer ? [] : state.selected },
        },
      };
      await storage.put(replacement);
      await storage.put(prepared);
      const controller = make(context, id);
      try {
        await controller.adoptReviewed(replacement);
        // Do not retire review until replacement persistence has succeeded.
        if (!controller.store.getState().localRecoveryAvailable)
          throw new DraftFailure("storage_unavailable");
        const retained: RecoveryRecord = {
          ...prepared,
          reviewOnly: true,
          review: { ...source.review, ...prepared.review, phase: "resolved" },
        };
        await storage.put(retained);
        remapContinuation(source, replacement);
        controller.store.setState({
          recoveries: (
            await storage.list(options.ownerId, options.portfolioId)
          ).filter((entry) => entry.id !== id),
        });
      } catch (error) {
        controller.dispose();
        await controller.persist();
        throw error;
      }
      store.setState({ controller, review: null, items: [], selected: [] });
      // Explicit Apply authorizes only the selected valid values. The controller
      // checkpoints every command and reports Saved only on canonical acknowledgement.
      await controller.flushValid();
      await controller.persist();
    });
  }
  async function continueRecord(recordId: string) {
    return action(async () => {
      const controller = store.getState().controller;
      await controller.quiesce();
      const saved = await getRecord(recordId);
      if (saved.review) throw new DraftFailure("recovery_required");
      const beforeRetire = async (replacement: RecoveryRecord) => {
        remapContinuation(saved, replacement);
      };
      if (saved.discardJournal || saved.validationJournal) {
        await controller.restore(recordId, beforeRetire);
        if (saved.discardJournal) {
          controller.releaseReviewPause();
          await controller.discardAttempt(true);
        }
        // Validation is restore-only. Its controls verify the journal and
        // require the appropriate explicit correction/transfer choice.
        return;
      }
      const latest = await canonical();
      if (
        saved.blocked ||
        (saved.context === "setup" && latest.firstEditorEnteredAt !== null) ||
        (!saved.batch && saved.base?.revision !== latest.revision)
      )
        throw new DraftFailure(
          saved.context === "setup" && latest.firstEditorEnteredAt !== null
            ? "setup_closed"
            : "revision_conflict",
        );
      await controller.restore(recordId, beforeRetire);
      controller.releaseReviewPause();
      if (saved.batch || saved.validationJournal || saved.discardJournal)
        await controller.retry();
      else await controller.flushValid();
    });
  }
  return {
    store,
    start,
    reopen,
    select,
    apply,
    continueRecord,
    async dismiss(recordId: string) {
      return action(async () => {
        const saved = await getRecord(recordId);
        if (!saved.reviewOnly) throw new DraftFailure("recovery_required");
        await storage.remove(saved.id, saved);
        const controller = store.getState().controller;
        controller.store.setState({
          recoveries: controller.store
            .getState()
            .recoveries.filter((v) => v.id !== recordId),
        });
      });
    },
  };
}
export type RecoveryCoordinator = ReturnType<typeof createRecoveryCoordinator>;
