"use client";

import { useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import {
  matchesValidationJournal,
  validationInputKey,
} from "../lib/draft/validation-input";
import "./draft-status.css";

const messages: Record<string, string> = {
  invalid_input:
    "The value does not match this field's requirements. Correct it and retry.",
  revision_conflict:
    "A newer version is saved. Your edits are preserved for review.",
  attempt_conflict: "This save attempt changed. Your edits are preserved.",
  attempt_unavailable:
    "The interrupted attempt is unavailable. Your local edits are preserved.",
  unauthorized:
    "Sign in again to continue. Your recoverable edits are preserved.",
  owner_changed:
    "The signed-in account changed. These edits remain with the original account.",
  setup_closed:
    "Setup has ended. Applicable unfinished input remains available for editor recovery.",
  journal_missing:
    "This interrupted save cannot be verified. Return to its original browser, or explicitly discard staging and save any preserved local input again.",
  recovery_required:
    "Review the recoverable input or interrupted save before continuing.",
  validation_required: "The saved draft needs validation before editing.",
  unsupported_version:
    "This draft version cannot be edited. Download the original for recovery.",
};

export function DraftStatus({ controller }: { controller: DraftController }) {
  // Reset confirmations and correction text when a flow/account replaces its
  // controller. These controls must never carry input into a different scope.
  return (
    <DraftStatusControls key={controller.scopeKey} controller={controller} />
  );
}

function DraftStatusControls({ controller }: { controller: DraftController }) {
  const state = useStore(controller.store);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const issue = state.validation?.issue ?? state.pending?.validationIssue;
  const journal = state.validationJournal;
  const correction =
    issue && journal
      ? (state.validationInputs[
          validationInputKey(journal.baseRevision, issue.path)
        ]?.value ?? "")
      : "";
  const knownValidation =
    !state.pending ||
    state.pending.state === "committed" ||
    matchesValidationJournal(state.pending, journal);
  async function action(task: () => Promise<unknown>) {
    setBusy(true);
    try {
      await task();
    } catch {
      /* The controller exposes its typed failure. */
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    const url = URL.createObjectURL(await controller.download());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "portfolio-recovery.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const label = {
    loading: "Loading draft...",
    saving: "Saving",
    saved: "Saved",
    failed: "Couldn't save",
    unsaved: "Unsaved input",
    blocked: "Couldn't save",
  }[state.status];
  const validating =
    state.error === "validation_required" ||
    state.pending?.context === "validation" ||
    Boolean(state.validationJournal);
  const confirmedReceipt =
    state.batch?.confirmedRevision ??
    state.validationJournal?.confirmedRevision;
  return (
    <section className="draft-status" aria-label="Draft saving">
      <p role="status" aria-live="polite" aria-atomic="true">
        {label}
      </p>
      {state.error && (
        <p className="draft-message">
          {confirmedReceipt &&
          ["network", "storage_unavailable"].includes(state.error)
            ? "The last save was confirmed. Retry to finish the remaining work."
            : (messages[state.error] ??
              "Your input is preserved. Check your connection and retry.")}
        </p>
      )}
      {!state.localRecoveryAvailable && (
        <p role="alert">
          Local recovery is unavailable in this browser. Keep this page open
          until your valid edits save.
        </p>
      )}
      {(Object.keys(state.inputs).length > 0 ||
        Object.keys(state.validationInputs).length > 0) && (
        <p className="draft-message">
          Unfinished input is stored in this browser when local recovery is
          available. It is not saved across devices.
        </p>
      )}
      {(state.status === "failed" || state.batch || state.discardJournal) && (
        <button
          className="ghost-button"
          type="button"
          disabled={busy}
          onClick={() => void action(() => controller.retry())}
        >
          Retry
        </button>
      )}
      {state.recoveries.map((entry) => (
        <div className="draft-recovery" key={entry.id}>
          <p>
            Unfinished {entry.context === "setup" ? "setup" : "editor"} input is
            available from this browser.
          </p>
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={() => void action(() => controller.restore(entry.id))}
          >
            Restore input
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={() =>
              void action(() => controller.discardRecovery(entry.id))
            }
          >
            Discard local recovery
          </button>
        </div>
      ))}
      {(state.pending ||
        state.batch?.mode === "staged" ||
        state.validationJournal ||
        state.discardJournal) && (
        <div className="draft-recovery">
          <p>
            {state.pending?.state === "committed"
              ? "A completed save receipt is available."
              : "An interrupted save is available."}
          </p>
          {!state.discardJournal &&
            (state.batch ||
              (state.validationJournal && knownValidation) ||
              (state.pending?.context === "validation" && knownValidation)) && (
              <button
                className="ghost-button"
                type="button"
                disabled={busy}
                onClick={() => void action(() => controller.resumeAttempt())}
              >
                Resume save
              </button>
            )}
          {state.pending?.state !== "committed" &&
            !state.batch &&
            !state.validationJournal && (
              <p className="draft-message">
                Restore its local journal to continue, or return to its original
                browser.
              </p>
            )}
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            {state.pending?.state === "committed"
              ? "Review saved receipt"
              : "Discard staged save"}
          </button>
          {confirm && (
            <fieldset
              className="draft-confirm"
              aria-label="Confirm staged save action"
            >
              <p>
                {state.pending?.state === "committed"
                  ? "Confirm the saved revision and clear its receipt?"
                  : "Discard this staged attempt? Your canonical draft and local input will remain."}
              </p>
              <button
                className="ghost-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    setConfirm(false);
                    await controller.discardAttempt();
                  })
                }
              >
                Confirm
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setConfirm(false)}
              >
                Cancel
              </button>
            </fieldset>
          )}
        </div>
      )}
      {validating &&
        knownValidation &&
        !state.pending?.requiresResume &&
        !state.discardJournal && (
          <div className="draft-recovery">
            {issue?.code === "invalid_destination" && (
              <label>
                Correct destination
                <input
                  value={correction}
                  disabled={busy}
                  onChange={(event) =>
                    controller.setValidationInput(event.target.value)
                  }
                  autoComplete="off"
                />
              </label>
            )}
            {(!issue || issue.code === "invalid_destination") && (
              <button
                className="ghost-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    controller.validateLegacy(issue ? correction : undefined),
                  )
                }
              >
                {issue ? "Validate correction" : "Validate saved draft"}
              </button>
            )}
          </div>
        )}
      {(validating || state.error === "unsupported_version") && (
        <button
          className="ghost-button"
          type="button"
          disabled={busy}
          onClick={() => void action(download)}
        >
          Download original draft
        </button>
      )}
    </section>
  );
}
