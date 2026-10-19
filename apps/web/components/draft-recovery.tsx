"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  leaveForRecovery,
  signInForRecovery,
} from "../lib/draft/auth-recovery";
import type { RecoveryCoordinator } from "../lib/draft/recovery-coordinator";
import { DraftStatus } from "./draft-status";
import "./draft-status.css";

const display = (value: unknown) =>
  value === undefined
    ? "Not present"
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
export function DraftRecovery({ recovery }: { recovery: RecoveryCoordinator }) {
  const state = useStore(recovery.store);
  const draft = useStore(state.controller.store);
  const [confirm, setConfirm] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const authBusy = useRef(false);
  const activeFocus = useRef<HTMLDivElement>(null);
  const scopeKey = state.controller.scopeKey;
  useEffect(() => {
    if (scopeKey) activeFocus.current?.focus();
  }, [scopeKey]);
  useEffect(() => {
    const reset = () => {
      authBusy.current = false;
      setAuthPending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const focus = useRef<HTMLHeadingElement>(null);
  const reviewId = state.review?.id;
  useEffect(() => {
    if (reviewId) focus.current?.focus();
    setConfirm(false);
  }, [reviewId]);
  const run = (work: () => Promise<unknown>) => {
    void work().catch(() => {});
  };
  const unresolved = draft.recoveries.filter((v) => !v.reviewOnly);
  const retained = draft.recoveries.filter((v) => v.reviewOnly);
  return (
    <div className="draft-recovery-layout" ref={activeFocus} tabIndex={-1}>
      <DraftStatus controller={state.controller} managedRecovery />
      {state.error && (
        <p role="alert">
          {state.error === "review_changed"
            ? "Another version was saved during review. Review the updated comparison and select your changes again."
            : state.error === "journal_missing"
              ? "An interrupted save needs its original journal or explicit staged discard before review can continue."
              : state.error === "unauthorized"
                ? "Sign in again to continue reviewing your preserved edits."
                : state.error === "owner_changed"
                  ? "The signed-in account changed. Sign in with the original account to continue."
                  : state.error === "revision_conflict"
                    ? "A newer version is saved. Review your preserved edits against it."
                    : state.error === "setup_closed"
                      ? "Setup has ended. Review preserved content for the current draft."
                      : "Recovery could not finish. Your preserved input remains available. Try again."}
        </p>
      )}
      {authError && <p role="alert">{authError}</p>}
      {[draft.error, state.error].some((error) =>
        ["unauthorized", "owner_changed"].includes(error ?? ""),
      ) && (
        <section className="draft-status" aria-label="Sign in to recover">
          <p>
            Sign in with the original account to recover these edits in this
            tab.
          </p>
          {(["github", "google"] as const).map((provider) => (
            <button
              className="ghost-button"
              type="button"
              disabled={state.busy || authPending}
              key={provider}
              onClick={() => {
                if (authBusy.current) return;
                authBusy.current = true;
                setAuthPending(true);
                setAuthError("");
                const leave = state.review
                  ? signInForRecovery(state.review, provider)
                  : leaveForRecovery(state.controller, provider);
                void leave.catch(() => {
                  authBusy.current = false;
                  setAuthPending(false);
                  setAuthError(
                    "Sign-in could not start. Keep this tab open and try again. Browser recovery storage must be available before leaving.",
                  );
                });
              }}
            >
              Sign in with {provider === "github" ? "GitHub" : "Google"}
            </button>
          ))}
        </section>
      )}
      {!state.review && (
        <>
          {["revision_conflict", "setup_closed", "attempt_conflict"].includes(
            draft.error ?? "",
          ) && (
            <section
              className="draft-status"
              aria-label="Resolve saved version"
            >
              <p>
                Your local values remain available for review. Loading the newer
                version replaces the active working values.
              </p>
              <button
                className="ghost-button"
                type="button"
                disabled={state.busy}
                onClick={() => run(() => recovery.start(undefined, "load"))}
              >
                Load newer version
              </button>
              <button
                className="ghost-button"
                type="button"
                disabled={state.busy}
                onClick={() => run(() => recovery.start())}
              >
                Keep my edits for review
              </button>
            </section>
          )}
          {unresolved.map((entry) => (
            <section
              className="draft-status"
              key={entry.id}
              aria-label="Preserved input"
            >
              <p>
                Preserved {entry.context} input is ready for explicit recovery.
              </p>
              {entry.review ? (
                <button
                  className="ghost-button"
                  type="button"
                  disabled={state.busy}
                  onClick={() => run(() => recovery.reopen(entry.id))}
                >
                  Reopen review
                </button>
              ) : (
                <>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={state.busy}
                    onClick={() => run(() => recovery.continueRecord(entry.id))}
                  >
                    Continue preserved edits
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={state.busy}
                    onClick={() => run(() => recovery.start(entry.id, "load"))}
                  >
                    Load newer version
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={state.busy}
                    onClick={() => run(() => recovery.start(entry.id))}
                  >
                    Keep my edits for review
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={state.busy}
                    onClick={() =>
                      run(() => state.controller.discardRecovery(entry.id))
                    }
                  >
                    Discard local recovery
                  </button>
                </>
              )}
            </section>
          ))}
        </>
      )}
      {state.review?.review && (
        <section
          className="draft-status draft-review"
          aria-labelledby="draft-review-heading"
        >
          <h2 id="draft-review-heading" tabIndex={-1} ref={focus}>
            Review your preserved edits
          </h2>
          <p>
            Saved revision {state.review.review.canonical.revision}. Select only
            the changes you want to apply. Unselected values remain in a review
            copy.
          </p>
          {state.review.review.canonical.firstEditorEnteredAt !== null && (
            <p>
              Setup has ended. Selected content opens a fresh content scope.
              Setup progress stays frozen.
            </p>
          )}
          {state.items.map((item) => (
            <fieldset key={item.id} className="draft-review-item">
              <legend>
                {item.path
                  .map((v) => (typeof v === "object" ? v.id : v))
                  .join(" / ")}{" "}
                · {item.kind}
              </legend>
              <label>
                <input
                  type="checkbox"
                  disabled={state.busy || !item.selectable}
                  checked={state.selected.includes(item.id)}
                  onChange={(event) =>
                    run(() => recovery.select(item.id, event.target.checked))
                  }
                />
                Apply this change
                {item.conflicting ? " (both versions changed)" : ""}
              </label>
              {!item.selectable && (
                <p>
                  This entry or setup step is no longer available. These values
                  remain for review.
                </p>
              )}
              <dl>
                <dt>Original</dt>
                <dd>
                  <pre>{display(item.base)}</pre>
                </dd>
                <dt>Your edits</dt>
                <dd>
                  <pre>{display(item.local)}</pre>
                </dd>
                <dt>Newer saved values</dt>
                <dd>
                  <pre>{display(item.current)}</pre>
                </dd>
              </dl>
            </fieldset>
          ))}
          {(Object.keys(state.review.inputs).length > 0 ||
            Object.keys(state.review.validationInputs ?? {}).length > 0) && (
            <details>
              <summary>Unfinished input, kept separately</summary>
              {Object.values(state.review.inputs).map((input) => (
                <pre key={JSON.stringify(input.path)}>
                  {JSON.stringify(input.path)}: {display(input.value)}
                </pre>
              ))}
              {Object.values(state.review.validationInputs ?? {}).map(
                (input) => (
                  <pre key={JSON.stringify([input.baseRevision, input.path])}>
                    Revision {input.baseRevision}, {JSON.stringify(input.path)}:{" "}
                    {input.value}
                  </pre>
                ),
              )}
            </details>
          )}
          {state.review.review.choice === "review" && (
            <button
              className="ghost-button"
              type="button"
              disabled={state.busy}
              onClick={() => run(() => recovery.apply())}
            >
              Apply selected changes
            </button>
          )}
          <button
            className="ghost-button"
            type="button"
            disabled={state.busy}
            onClick={() => setConfirm(true)}
          >
            Load newer version
          </button>
          {confirm && (
            <fieldset className="draft-confirm">
              <legend>Replace local working values?</legend>
              <p>
                The newer saved values become active. Your local values stay in
                a review-only copy until you dismiss it.
              </p>
              <button
                className="ghost-button"
                type="button"
                disabled={state.busy}
                onClick={() => run(() => recovery.apply(true))}
              >
                Confirm load newer version
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
        </section>
      )}
      {retained.map((entry) => (
        <details className="draft-status" key={entry.id}>
          <summary>Retained recovery copy</summary>
          <p>Review-only values do not block this active draft.</p>
          <button
            className="ghost-button"
            type="button"
            disabled={state.busy}
            onClick={() => run(() => recovery.reopen(entry.id))}
          >
            Review retained edits
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={state.busy}
            onClick={() => run(() => recovery.dismiss(entry.id))}
          >
            Dismiss review copy
          </button>
        </details>
      ))}
    </div>
  );
}
