import type {
  DraftPath,
  DraftReadResult,
  SaveAttemptStatus,
} from "@hasaweb/schema";
import { equal, getAt } from "./planner";
import type { ValidationInput, ValidationJournal } from "./types";

export function validationInputKey(baseRevision: number, path: DraftPath) {
  return JSON.stringify([baseRevision, path]);
}

export function matchesValidationJournal(
  pending: SaveAttemptStatus,
  journal: ValidationJournal | null,
) {
  if (
    !journal ||
    pending.context !== "validation" ||
    journal.baseRevision !== pending.baseRevision
  )
    return false;
  if (journal.id) return journal.id === pending.id;
  // A lost validation begin can identify an untouched clone of the intended
  // canonical revision. Once any command ran, metadata cannot prove its content.
  return (
    journal.sent?.action === "validation-begin" &&
    pending.sequence === 0 &&
    pending.state === "open" &&
    !pending.validationComplete &&
    !pending.validationIssue
  );
}

export function remainingValidationInputs(
  inputs: Record<string, ValidationInput>,
  canonical: DraftReadResult,
  baseRevision: number,
  confirmedRevision: number,
) {
  // Later structural edits may have moved numeric issue paths. Keep the input
  // for explicit review unless this is the exact validated revision.
  if (canonical.revision !== confirmedRevision) return inputs;
  return Object.fromEntries(
    Object.entries(inputs).filter(
      ([, input]) =>
        input.baseRevision !== baseRevision ||
        !equal(getAt(canonical.draft, input.path), input.value),
    ),
  );
}
