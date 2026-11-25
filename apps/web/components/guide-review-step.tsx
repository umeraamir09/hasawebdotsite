"use client";

import type { PreviewScheme } from "@hasaweb/components/browser";
import type { PublicationIssue } from "@hasaweb/schema";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { readPublicationIssues } from "../lib/draft/publication";
import { publicationIssueLabel } from "../lib/draft/publication-labels";
import type { RecoveryCoordinator } from "../lib/draft/recovery-coordinator";
import { EditorPreview, type PreviewDevice } from "./editor-preview";
import {
  Button,
  Icon,
  IconButton,
  SegmentedControl,
  StatusPill,
} from "./workbench";

export type HandoffResult = Awaited<ReturnType<RecoveryCoordinator["handoff"]>>;
export type ReviewAction = "idle" | "opening" | "failed";

type Statuses =
  | { kind: "checking" }
  | { kind: "failed" }
  | {
      kind: "checked";
      revision: number;
      issues: PublicationIssue[];
      more: boolean;
    };

// Setup Review (Figma 471:11880): the saved private draft in the shared
// renderer under its address bar, with the device and scheme switch. Items
// the draft still needs are listed with their state; Open editor (the shell's
// primary action, which submits this step's form) runs the handoff under the
// recovery coordinator. Nothing here publishes or claims the address.
export function GuideReview({
  formId,
  recovery,
  controller,
  disabled,
  send,
  previewDocument,
  onAction,
  onEntered,
  onRequired,
}: {
  formId: string;
  recovery: RecoveryCoordinator;
  controller: DraftController;
  disabled: boolean;
  send: typeof fetch;
  previewDocument: string;
  onAction(action: ReviewAction): void;
  onEntered(result: HandoffResult): void;
  onRequired(result: HandoffResult): void;
}) {
  const state = useStore(controller.store);
  const saved = state.confirmed;
  const [statuses, setStatuses] = useState<Statuses>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  const [device, setDevice] = useState<PreviewDevice>(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 640px)").matches
      ? "mobile"
      : "desktop",
  );
  const [scheme, setScheme] = useState<PreviewScheme | null>(null);
  const [failure, setFailure] = useState(false);
  const busy = useRef(false);
  const report = useRef(onAction);
  report.current = onAction;
  useEffect(() => () => report.current("idle"), []);
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
    report.current("opening");
    setFailure(false);
    let next: ReviewAction = "idle";
    try {
      const entered = await recovery.handoff(send);
      if (entered.result.kind === "editor") onEntered(entered);
      else if (entered.result.kind === "required") onRequired(entered);
      else next = "failed";
    } catch {
      next = "failed";
    } finally {
      busy.current = false;
      setFailure(next === "failed");
      report.current(next);
    }
  }

  const draft = saved?.draft ?? null;
  const address = draft?.requestedSubdomain;
  const issues = statuses.kind === "checked" ? statuses.issues : [];
  return (
    <form
      id={formId}
      className="guide-review"
      aria-label="Review your portfolio"
      data-guide-review=""
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void open();
      }}
    >
      <div className="guide-review-controls">
        <SegmentedControl
          label="Preview device"
          size="s"
          value={device}
          onChange={setDevice}
          options={[
            { value: "desktop", label: "Desktop", icon: "monitor" },
            { value: "mobile", label: "Mobile", icon: "phone" },
          ]}
        />
        <span className="guide-review-divider" aria-hidden="true" />
        <IconButton
          icon={scheme === "dark" ? "moon" : "sun"}
          label="Dark preview"
          aria-pressed={scheme === "dark"}
          onClick={() => setScheme(scheme === "dark" ? "light" : "dark")}
        />
      </div>
      <div className="guide-review-frame" data-device={device}>
        <p className="guide-review-address">
          <Icon name="lock" size={12} />
          {address ? `${address}.hasaweb.site` : "hasaweb.site"}
          <span className="wb-visually-hidden">, private draft</span>
        </p>
        {draft && (
          <EditorPreview
            owner={controller.identity}
            draft={draft}
            documentUrl={previewDocument}
            label="Your private portfolio review"
            device={device}
            scheme={scheme}
            onScheme={setScheme}
            canvasActions={false}
          />
        )}
      </div>
      <section
        className="guide-review-status"
        aria-label="Still to finish"
        data-review-status={statuses.kind}
      >
        {statuses.kind === "checking" ? (
          <p role="status" className="wb-visually-hidden">
            Checking your saved draft...
          </p>
        ) : statuses.kind === "failed" ? (
          <div className="guide-notice" role="alert">
            <StatusPill status="issue">Couldn't check</StatusPill>
            <Button
              size="s"
              kind="ghost"
              icon="refresh"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry check
            </Button>
          </div>
        ) : issues.length === 0 && !statuses.more ? (
          <p role="status" className="wb-visually-hidden">
            Nothing in your saved draft is unfinished.
          </p>
        ) : (
          <ul className="guide-review-issues">
            {issues.map((issue) => (
              <li key={JSON.stringify(issue)} data-review-issue={issue.code}>
                <StatusPill status="issue">Unfinished</StatusPill>
                {publicationIssueLabel(issue, draft)}
              </li>
            ))}
            {statuses.more && (
              <li data-review-issue="more">
                <StatusPill status="issue">Unfinished</StatusPill>
                More in the editor
              </li>
            )}
          </ul>
        )}
        {localInput && (
          <p className="guide-notice" data-review-local-input="">
            <StatusPill status="pending">Unsaved</StatusPill>
            Some input stays in this browser until you fix it in the editor.
          </p>
        )}
        {failure && (
          <p className="guide-error" role="alert">
            We couldn't open the editor. Your draft is safe. Retry to continue.
          </p>
        )}
      </section>
    </form>
  );
}
