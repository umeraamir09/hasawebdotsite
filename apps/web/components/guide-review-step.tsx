"use client";

import type { PublicationIssue } from "@hasaweb/schema";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { readPublicationIssues } from "../lib/draft/publication";
import { publicationIssueLabel } from "../lib/draft/publication-labels";
import type { RecoveryCoordinator } from "../lib/draft/recovery-coordinator";
import { EditorPreview } from "./editor-preview";

export type HandoffResult = Awaited<ReturnType<RecoveryCoordinator["handoff"]>>;

type Statuses =
  | { kind: "checking" }
  | { kind: "failed" }
  | {
      kind: "checked";
      revision: number;
      issues: PublicationIssue[];
      more: boolean;
    };

// Setup Review: the saved private draft in the shared renderer, honest
// unfinished-content statuses and Open editor. Open editor runs the Phase 22A
// handoff under the recovery coordinator; nothing here publishes or claims.
export function GuideReview({
  recovery,
  controller,
  disabled,
  send,
  previewDocument,
  onEntered,
  onRequired,
}: {
  recovery: RecoveryCoordinator;
  controller: DraftController;
  disabled: boolean;
  send: typeof fetch;
  previewDocument: string;
  onEntered(result: HandoffResult): void;
  onRequired(result: HandoffResult): void;
}) {
  const state = useStore(controller.store);
  const saved = state.confirmed;
  const [statuses, setStatuses] = useState<Statuses>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState(false);
  const busy = useRef(false);
  const localInput =
    Object.keys(state.inputs).length > 0 ||
    Object.keys(state.validationInputs).length > 0;

  // Publication blockers of the saved revision. Optional gaps are reported,
  // never enforced: Open editor stays available whatever this read says.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` explicitly retries.
  useEffect(() => {
    if (!saved) return;
    let active = true;
    const abort = new AbortController();
    setStatuses({ kind: "checking" });
    readPublicationIssues(
      controller.identity,
      saved.revision,
      send,
      abort.signal,
    )
      .then((result) => {
        if (active)
          setStatuses({
            kind: "checked",
            revision: saved.revision,
            issues: result.issues,
            more: result.hasMoreIssues,
          });
      })
      .catch(() => {
        // A newer saved revision re-runs this effect and replaces this state.
        // Any other failure, including a revision conflict while local input
        // blocks `confirmed` from advancing, must offer Retry check.
        if (active) setStatuses({ kind: "failed" });
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [controller, send, saved?.revision, attempt]);

  async function open() {
    if (busy.current || disabled) return;
    const current = recovery.store.getState();
    if (current.busy || current.review) return;
    busy.current = true;
    setOpening(true);
    setFailure(false);
    try {
      const entered = await recovery.handoff(send);
      if (entered.result.kind === "editor") onEntered(entered);
      else if (entered.result.kind === "required") onRequired(entered);
      else setFailure(true);
    } catch {
      setFailure(true);
    } finally {
      busy.current = false;
      setOpening(false);
    }
  }

  const draft = saved?.draft ?? null;
  const address = draft?.requestedSubdomain;
  const issues = statuses.kind === "checked" ? statuses.issues : [];
  const optionalOnly = issues.every((issue) => issue.path[0] === "components");
  return (
    <div className="guide-review" data-guide-review="">
      <p className="guide-review-address">
        {address ? `${address}.hasaweb.site` : "Your address"}
        <span aria-hidden="true"> · </span>
        <span className="sr-only">, </span>
        Private draft
      </p>
      {draft && (
        <EditorPreview
          owner={controller.identity}
          draft={draft}
          documentUrl={previewDocument}
          label="Your private portfolio review"
        />
      )}
      <section
        className="guide-review-status"
        aria-labelledby="guide-review-status-title"
        data-review-status={statuses.kind}
      >
        <h2 id="guide-review-status-title">Before you publish</h2>
        {statuses.kind === "checking" ? (
          <p role="status">Checking your saved draft...</p>
        ) : statuses.kind === "failed" ? (
          <div className="guide-note" role="alert">
            <p>We couldn't check what's left to finish</p>
            <p>
              You can still open the editor. It checks everything again before
              you publish.
            </p>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry check
            </button>
          </div>
        ) : issues.length === 0 && !statuses.more ? (
          <p role="status">
            Nothing in your saved draft is unfinished right now. The editor
            checks everything again when you publish.
          </p>
        ) : (
          <>
            <ul className="guide-review-issues">
              {issues.map((issue) => (
                <li
                  key={JSON.stringify(issue)}
                  className="guide-note"
                  data-review-issue={issue.code}
                >
                  <p>{publicationIssueLabel(issue, draft)}</p>
                  <p>
                    It stays in your draft. Finish or remove it in the editor
                    before publishing.
                  </p>
                </li>
              ))}
            </ul>
            {statuses.more && <p>More items need attention in the editor.</p>}
            <p role="status">
              {optionalOnly
                ? "Your required profile is complete. You can open the editor and finish these sections there."
                : "Open the editor to finish these before publishing."}
            </p>
          </>
        )}
        {localInput && (
          <div className="guide-note" data-review-local-input="">
            <p>Some input isn't saved</p>
            <p>
              It isn't valid yet, so it stays only in this browser. The editor
              offers it for recovery after you open it.
            </p>
          </div>
        )}
      </section>
      <div className="guide-review-actions">
        {failure && (
          <div className="guide-note guide-review-failure" role="alert">
            <p>Your draft is safe</p>
            <p>
              We couldn't confirm your saved changes and open the editor. Retry
              to continue with this same draft.
            </p>
          </div>
        )}
        <button
          type="button"
          className="guide-continue"
          disabled={disabled || opening || state.status === "saving"}
          onClick={() => void open()}
        >
          {opening
            ? "Opening editor..."
            : failure
              ? "Retry opening editor"
              : "Open editor"}
        </button>
        <p className="guide-help">
          Your portfolio stays private until you Publish.
        </p>
      </div>
    </div>
  );
}
