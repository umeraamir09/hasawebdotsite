import { z } from "zod";
import type { DraftDoc } from "./draft";
import { JSON_MAX_DEPTH } from "./json";
import { type SetupProgress, setupProgressSchema } from "./setup";

export const SAVE_REQUEST_BYTES = 8192;
export const SAVE_CHANGE_BYTES = 5120;
export const saveRevisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1);
export const draftPathSchema = z
  .array(z.union([z.string().max(160), saveRevisionSchema]))
  .max(JSON_MAX_DEPTH);
export const saveChangeSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("set"),
    path: draftPathSchema,
    value: z.unknown(),
  }),
  z.strictObject({
    op: z.literal("append"),
    path: draftPathSchema,
    values: z.array(z.unknown()).min(1).max(32),
  }),
  z.strictObject({ op: z.literal("remove"), path: draftPathSchema }),
]);
const start = {
  revision: saveRevisionSchema,
};
const attempt = { id: z.uuid() };
const continuation = { ...attempt, sequence: saveRevisionSchema };
export const ownerSaveActions = {
  patch: z.discriminatedUnion("context", [
    z.strictObject({
      ...start,
      context: z.literal("setup"),
      progress: setupProgressSchema,
      change: saveChangeSchema,
    }),
    z.strictObject({
      ...start,
      context: z.literal("content"),
      change: saveChangeSchema,
    }),
  ]),
  progress: z.strictObject({ ...start, progress: setupProgressSchema }),
  begin: z.discriminatedUnion("context", [
    z.strictObject({
      ...start,
      context: z.literal("setup"),
      progress: setupProgressSchema,
    }),
    z.strictObject({ ...start, context: z.literal("content") }),
  ]),
  change: z.strictObject({ ...continuation, change: saveChangeSchema }),
  "string-start": z.strictObject({ ...continuation, path: draftPathSchema }),
  piece: z.strictObject({ ...continuation, text: z.string() }),
  "string-finish": z.strictObject(continuation),
  commit: z.strictObject(continuation),
  pending: z.strictObject({}),
  status: z.strictObject(attempt),
  resume: z.strictObject(attempt),
  abort: z.strictObject(attempt),
  cleanup: z.strictObject({}),
  "validation-begin": z.strictObject(start),
  "validation-step": z.strictObject(continuation),
  "validation-correct": z.strictObject({
    ...continuation,
    path: draftPathSchema,
    value: z.string(),
  }),
} as const;
export type OwnerSaveAction = keyof typeof ownerSaveActions;
export type SaveContext = "setup" | "content" | "validation";
export type DraftReadResult = {
  portfolioId: string;
  draft: DraftDoc;
  revision: number;
  progress: SetupProgress;
  firstEditorEnteredAt: number | null;
};
export type ProgressReadResult = Omit<DraftReadResult, "draft">;
export type SaveAcknowledgement =
  | { revision: number; replayed?: true }
  | { id?: string; sequence: number; replayed?: true };
export type LegacyValidationIssue = {
  path: (string | number)[];
  code: "invalid_destination" | "invalid_structure" | "invalid_references";
};
export type LegacyValidationResult = {
  sequence: number;
  complete: boolean;
  issue: LegacyValidationIssue | null;
  examined?: number;
  validationBytes?: number;
  replayed?: true;
};
export type SaveAttemptStatus = {
  id: string;
  baseRevision: number;
  sequence: number;
  state: "open" | "string" | "committed" | "aborted";
  context: SaveContext;
  expiresAt: number;
  requiresResume: boolean;
  pieceCount: number;
  stringPath: string | null;
  validationComplete: boolean;
  validationIssue: LegacyValidationIssue | null;
};
export type SaveErrorCode =
  | "owner_changed"
  | "revision_conflict"
  | "attempt_conflict"
  | "attempt_unavailable"
  | "setup_closed"
  | "validation_required"
  | "unsupported_version"
  | "invalid_input"
  | "byte_limit"
  | "save_rejected"
  | "storage_unavailable"
  | "unauthorized"
  | "not_found";
export type OwnerSaveFailure = { error: SaveErrorCode; revision?: number };
