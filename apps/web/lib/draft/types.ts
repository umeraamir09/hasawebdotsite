import type {
  AddressCommand,
  DraftDoc,
  DraftPath,
  DraftReadResult,
  LegacyValidationResult,
  OwnerSaveAction,
  ownerSaveActions,
  ProgressReadResult,
  SaveAttemptStatus,
  SaveErrorCode,
  SetupProgress,
} from "@hasaweb/schema";

export type Context = "setup" | "content";
export type Change = (typeof ownerSaveActions.patch)["_output"]["change"];
export type ActionBody<A extends OwnerSaveAction> =
  (typeof ownerSaveActions)[A]["_output"];
export type LocalCode =
  | SaveErrorCode
  | "network"
  | "recovery_required"
  | "journal_missing"
  | "review_changed";
export class DraftFailure extends Error {
  constructor(
    readonly code: LocalCode,
    readonly uncertain = false,
  ) {
    super(code);
  }
}
export interface Transport {
  read(): Promise<DraftReadResult>;
  readProgress(): Promise<ProgressReadResult>;
  action<T = unknown>(action: OwnerSaveAction, body: unknown): Promise<T>;
  download(): Promise<Blob>;
}
export type FieldPath = (string | { id: string } | number)[];
export type LocalInput = { path: FieldPath; value: unknown };
// Legacy issues expose numeric paths in an immutable server-owned revision.
// Never apply these values to another revision without explicit field review.
export type ValidationInput = {
  path: DraftPath;
  baseRevision: number;
  value: string;
};
export type PlannedCommand =
  | { action: "change"; change: Change }
  | { action: "string-start"; path: DraftPath }
  | { action: "piece"; text: string }
  | { action: "string-finish" };
type BatchData = {
  base: DraftReadResult;
  target: DraftDoc;
  progress: SetupProgress;
  commands: PlannedCommand[];
  attemptId?: string;
  sequence: number;
  index: number;
  // Sent-but-unacknowledged commands are retried only through protocol recovery.
  sent?: { action: OwnerSaveAction; body: unknown };
  confirmedRevision?: number;
  resume?: number;
};
export type Batch = BatchData &
  (
    | { mode: "patch" | "progress" | "staged"; address?: never }
    | { mode: "address"; address: AddressCommand }
  );
export type DiscardJournal = {
  id: string | null;
  revision: number;
  confirmed: boolean;
};
export type RecoveryRecord = {
  version: 1;
  id: string;
  ownerId: string;
  portfolioId: string;
  context: Context;
  base: DraftReadResult | null;
  working: DraftDoc | null;
  progress: SetupProgress | null;
  inputs: Record<string, LocalInput>;
  validationInputs?: Record<string, ValidationInput>;
  batch: Batch | null;
  validationJournal: ValidationJournal | null;
  discardJournal?: DiscardJournal | null;
  blocked?: "revision_conflict" | "setup_closed";
  // Optional extension keeps Phase 14 version-1 records readable.
  review?: ReviewCheckpoint;
  reviewOnly?: boolean;
  reviewBase?: DraftReadResult;
};
export type ValidationJournal = {
  baseRevision: number;
  id?: string;
  sequence: number;
  sent?: { action: OwnerSaveAction; body: unknown };
  confirmedRevision?: number;
  resume?: number;
};
export interface RecoveryStorage {
  list(ownerId: string, portfolioId: string): Promise<RecoveryRecord[]>;
  put(record: RecoveryRecord): Promise<void>;
  // With an expected snapshot, preserve any newer record written by its tab.
  remove(id: string, expected?: RecoveryRecord): Promise<void>;
}
export interface Coordinator {
  readonly exclusive: boolean;
  run<T>(work: () => Promise<T>): Promise<T>;
  publish(revision: number): void;
  publishAttempt(id: string | null): void;
  close(): void;
}
export type DraftState = {
  suspended: boolean;
  pendingImages: Partial<Record<"avatar" | "banner" | "face", boolean>>;
  confirmed: DraftReadResult | null;
  working: DraftDoc | null;
  progress: SetupProgress | null;
  inputs: Record<string, LocalInput>;
  validationInputs: Record<string, ValidationInput>;
  batch: Batch | null;
  pending: SaveAttemptStatus | null;
  remoteAttemptId: string | null;
  recoveries: RecoveryRecord[];
  status: "loading" | "saved" | "saving" | "unsaved" | "failed" | "blocked";
  error: LocalCode | null;
  localRecoveryAvailable: boolean;
  validation: LegacyValidationResult | null;
  discardJournal: DiscardJournal | null;
  validationJournal: ValidationJournal | null;
};

export type ReviewItem = {
  id: string;
  path: FieldPath;
  kind:
    | "value"
    | "add"
    | "remove"
    | "order"
    | "structure"
    | "missing"
    | "progress";
  base: unknown;
  local: unknown;
  current: unknown;
  conflicting: boolean;
  selectable: boolean;
};
export type SelectedResolution = { itemIds: string[] };
export type ReviewCheckpoint = {
  version: 1;
  phase: "review" | "prepared" | "resolved";
  choice: "review" | "load";
  canonical: DraftReadResult;
  selection: SelectedResolution;
  replacementId?: string;
  receipt?: { pending: SaveAttemptStatus; recoveryId?: string };
};
export type AuthContinuation = {
  version: 1;
  ownerId: string;
  portfolioId: string;
  recordId: string;
  context: Context;
  flow: "draft-recovery";
};
