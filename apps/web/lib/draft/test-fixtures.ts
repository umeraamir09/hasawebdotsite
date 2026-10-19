import {
  createEmptyDraft,
  type DraftReadResult,
  type OwnerSaveAction,
  type SaveAttemptStatus,
} from "@hasaweb/schema";
import { applyChange } from "./planner";
import {
  DraftFailure,
  type RecoveryRecord,
  type RecoveryStorage,
  type Transport,
} from "./types";
export function memoryStorage(): RecoveryStorage & {
  records: Map<string, RecoveryRecord>;
} {
  const records = new Map<string, RecoveryRecord>();
  return {
    records,
    async list(owner, portfolio) {
      return Array.from(records.values())
        .filter((v) => v.ownerId === owner && v.portfolioId === portfolio)
        .map((v) => structuredClone(v));
    },
    async put(record) {
      records.set(record.id, structuredClone(record));
    },
    async remove(id, expected) {
      if (
        expected &&
        JSON.stringify(records.get(id)) !== JSON.stringify(expected)
      )
        return;
      records.delete(id);
    },
  };
}
export function fixtureTransport() {
  let canonical: DraftReadResult = {
    portfolioId: "portfolio-a",
    revision: 0,
    draft: createEmptyDraft({
      themeId: "leaf",
      fontId: "dm-sans",
      colorMode: "system",
    }),
    progress: { schemaVersion: 1, step: "address" },
    firstEditorEnteredAt: null,
  };
  let pending: SaveAttemptStatus | null = null,
    staged = structuredClone(canonical);
  let text = "",
    textPath: (string | number)[] = [];
  let lastCommand = "",
    lastReply: unknown;
  const calls: {
    action: OwnerSaveAction | "read";
    body: Record<string, unknown>;
  }[] = [];
  let before: ((action: string) => Promise<void>) | null = null;
  let after: ((action: string) => void) | null = null;
  const transport: Transport = {
    async read() {
      calls.push({ action: "read", body: {} });
      return structuredClone(canonical);
    },
    async readProgress() {
      const { draft: _, ...metadata } = canonical;
      return structuredClone(metadata);
    },
    async download() {
      return new Blob([JSON.stringify(canonical)]);
    },
    async action<T>(action: OwnerSaveAction, raw: unknown) {
      const body = raw as Record<string, unknown>;
      calls.push({ action, body: structuredClone(body) });
      await before?.(action);
      let result: unknown = {};
      if (action === "pending" || action === "status") result = pending;
      else if (action === "cleanup") {
        pending = null;
        result = { pieces: 0, attempts: 0 };
      } else if (action === "abort") {
        pending = null;
        result = { aborted: true };
      } else if (action === "resume" && pending) {
        if (pending.requiresResume) pending.sequence++;
        pending.requiresResume = false;
        result = pending;
      } else if (
        action === "patch" ||
        action === "progress" ||
        action === "begin"
      ) {
        if (body.revision !== canonical.revision)
          throw new DraftFailure("revision_conflict");
        if (
          (body.context === "setup" &&
            canonical.firstEditorEnteredAt !== null) ||
          (action === "progress" && canonical.firstEditorEnteredAt !== null)
        )
          throw new DraftFailure("setup_closed");
        if (action === "begin") {
          if (pending) throw new DraftFailure("save_rejected");
          pending = {
            id: crypto.randomUUID(),
            baseRevision: canonical.revision,
            sequence: 0,
            state: "open",
            context: body.context as "setup",
            expiresAt: Date.now() + 3600000,
            requiresResume: false,
            pieceCount: 0,
            stringPath: null,
            validationComplete: false,
            validationIssue: null,
          };
          staged = structuredClone(canonical);
          if (body.progress)
            staged.progress = structuredClone(
              body.progress as DraftReadResult["progress"],
            );
          result = { id: pending.id, sequence: 0 };
        } else {
          if (body.change)
            canonical.draft = applyChange(
              canonical.draft,
              body.change as Parameters<typeof applyChange>[1],
            );
          if (body.progress)
            canonical.progress = structuredClone(
              body.progress as DraftReadResult["progress"],
            );
          result = { revision: ++canonical.revision };
        }
      } else if (pending) {
        if (
          body.id === pending.id &&
          body.sequence === pending.sequence - 1 &&
          JSON.stringify({ action, body }) === lastCommand
        )
          return structuredClone(lastReply) as T;
        if (body.id !== pending.id || body.sequence !== pending.sequence)
          throw new DraftFailure("attempt_conflict");
        if (action === "commit") {
          if (pending.state === "committed")
            result = { revision: pending.baseRevision + 1 };
          else {
            if (canonical.revision !== pending.baseRevision)
              throw new DraftFailure("revision_conflict");
            if (
              pending.context === "setup" &&
              canonical.firstEditorEnteredAt !== null
            )
              throw new DraftFailure("setup_closed");
            canonical = { ...staged, revision: canonical.revision + 1 };
            pending.state = "committed";
            result = { revision: canonical.revision };
          }
        } else {
          if (action === "change")
            staged.draft = applyChange(
              staged.draft,
              body.change as Parameters<typeof applyChange>[1],
            );
          if (action === "string-start") {
            text = "";
            textPath = body.path as (string | number)[];
            pending.state = "string";
          }
          if (action === "piece") text += body.text;
          if (action === "string-finish") {
            staged.draft = applyChange(staged.draft, {
              op: "set",
              path: textPath,
              value: text,
            });
            pending.state = "open";
          }
          result = { sequence: ++pending.sequence };
          lastCommand = JSON.stringify({ action, body });
          lastReply = structuredClone(result);
        }
      }
      after?.(action);
      return structuredClone(result) as T;
    },
  };
  return {
    transport,
    calls,
    get: () => canonical,
    pending: () => pending,
    before: (fn: typeof before) => {
      before = fn;
    },
    after: (fn: typeof after) => {
      after = fn;
    },
  };
}
