"use client";

import { BIO_MAX } from "@hasaweb/schema";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { watchAccountDeletion } from "../lib/account-deletion";
import { signOutOwner } from "../lib/auth-client";
import { createDraftController } from "../lib/draft/controller";
import {
  createRecoveryCoordinator,
  type RecoveryCoordinator,
} from "../lib/draft/recovery-coordinator";
import { DraftFailure } from "../lib/draft/types";
import {
  type GraphSetupStatus,
  readGraphStatus,
} from "../lib/editor/github-graph";
import { findGraph, graphGap, graphGapMessage } from "../lib/guide/github";
import {
  findOptional,
  type OptionalType,
  projectIncomplete,
  settleOptional,
} from "../lib/guide/optional";
import { checkSetup } from "../lib/guide/setup-check";
import {
  type GuideStep,
  guideSteps,
  nextStep,
  previousStep,
  progressFor,
  progressSegments,
  type RequiredIssues,
  remainingTarget,
  requiredIssues,
  resumeStep,
  stepActions,
  stepFields,
  stepIndex,
} from "../lib/guide/steps";
import { AccountDeleted } from "./account-deletion";
import { DraftRecovery } from "./draft-recovery";
import { GuideAddress } from "./guide-address-step";
import { GuideGitHub } from "./guide-github-step";
import { GuideLinks } from "./guide-links-step";
import { GuideProjects, GuideSkills } from "./guide-optional-steps";
import { GuideProfile } from "./guide-profile-step";
import {
  GuideReview,
  type HandoffResult,
  type ReviewAction,
} from "./guide-review-step";
import { Button, Icon, StatusPill } from "./workbench";
import "./setup-guide.css";

type Owner = { ownerId: string; portfolioId: string };

// Each step asks one question (Setup v2 / Prompt): a kicker and a title,
// with no subtitle.
const stepCopy: Record<GuideStep, { label: string; title: string }> = {
  address: { label: "Address", title: "Pick your address" },
  profile: { label: "Profile", title: "Introduce yourself" },
  links: { label: "Links", title: "Where can people find you?" },
  skills: { label: "Skills", title: "What do you work with?" },
  projects: { label: "Projects", title: "Show something you made" },
  github: { label: "GitHub", title: "Add your GitHub activity" },
  review: { label: "Review", title: "Here's your portfolio" },
};

const formId = "setup-guide-step";

// The editor's iframe preview document (registered by the web Worker).
const defaultPreviewDocument = "/editor/preview";

// After the permanent handoff the same tab opens the editor, whose fresh
// content-scope controller offers any preserved setup input for review.
const openEditor = () => window.location.replace("/editor");

// The first-portfolio guide (Figma "Setup v2" on page 325:2): Address,
// Profile, Links, optional Skills, Projects and GitHub, then Review and the
// permanent editor handoff. The account entry (`OwnerEntry`) mounts it for
// owners who have not entered the editor.
export function SetupGuide(props: {
  owner: Owner;
  send?: typeof fetch;
  previewDocument?: string;
  onSignOut?: () => Promise<void>;
  onReady?(recovery: RecoveryCoordinator): void;
  onEntered?(result: HandoffResult | null): void;
}) {
  return <Session key={JSON.stringify(props.owner)} {...props} />;
}

function Session({
  owner,
  send,
  previewDocument,
  onSignOut,
  onReady,
  onEntered,
}: Parameters<typeof SetupGuide>[0]) {
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const [scope] = useState(owner);
  const [recovery, setRecovery] = useState<RecoveryCoordinator | null>(null);
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    let active = true;
    const options = { ...scope, context: "setup" as const };
    const controller = createDraftController(options);
    const coordinator = createRecoveryCoordinator({ ...options, controller });
    setRecovery(coordinator);
    void controller
      .initialize()
      .catch(() => {})
      .finally(() => {
        if (active) readyCallback.current?.(coordinator);
      });
    // Phase 49: another tab deleted this account; stop writing at once.
    const stopWatching = watchAccountDeletion(scope.ownerId, () => {
      void coordinator.dispose();
      setDeleted(true);
    });
    return () => {
      active = false;
      stopWatching();
      void coordinator.dispose();
    };
  }, [scope]);
  if (deleted) return <AccountDeleted elsewhere />;
  if (!recovery)
    return (
      <main className="setup-guide workbench">
        <p role="status" className="guide-loading">
          Opening your setup...
        </p>
      </main>
    );
  return (
    <Workspace
      recovery={recovery}
      send={send}
      previewDocument={previewDocument}
      onSignOut={onSignOut}
      onEntered={onEntered}
    />
  );
}

type ScopeProps = {
  recovery: RecoveryCoordinator;
  send?: typeof fetch | undefined;
  previewDocument?: string | undefined;
  onSignOut?: (() => Promise<void>) | undefined;
  onEntered?: ((result: HandoffResult | null) => void) | undefined;
};

function Workspace(props: ScopeProps) {
  const recoveryState = useStore(props.recovery.store);
  // Coordinator replacements change the scope; reset all step state with it.
  return <Scope key={recoveryState.controller.scopeKey} {...props} />;
}

function Scope({
  recovery,
  send = fetch,
  previewDocument = defaultPreviewDocument,
  onSignOut = signOutOwner,
  onEntered = openEditor,
}: ScopeProps) {
  const recoveryState = useStore(recovery.store);
  const controller = recoveryState.controller;
  const state = useStore(controller.store);
  const [checked, setChecked] = useState<{
    revision: number;
    issues: RequiredIssues;
  } | null>(null);
  const [checkError, setCheckError] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [navigating, setNavigating] = useState(false);
  const [stepError, setStepError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  // A handoff refused for missing required content; it stays visible on the
  // step the shell returns to until the owner moves on.
  const [handoffNotice, setHandoffNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const revision = state.confirmed?.revision;
  // The GitHub screen: whether a username was typed before any account was
  // accepted, the step's latest status, and a failed status read.
  const [addingGraph, setAddingGraph] = useState(false);
  const [graphStatus, setGraphStatus] = useState<GraphSetupStatus | null>(null);
  const [graphUnchecked, setGraphUnchecked] = useState(false);
  const [reviewAction, setReviewAction] = useState<ReviewAction>("idle");

  // GitHub consent returns to `/auth/entry?github=consent`. The step comes
  // from saved progress and the outcome from the status route, so the marker
  // only needs removing.
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get("github") !== "consent") return;
    url.searchParams.delete("github");
    history.replaceState(history.state, "", url);
  }, []);

  async function refresh() {
    const result = await checkSetup(controller, send);
    const next = { revision: result.revision, issues: requiredIssues(result) };
    setChecked(next);
    setCheckError(false);
    return next;
  }
  // Recheck authoritative required facts for every confirmed revision. The
  // previous result stays in use until the new one arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `checkAttempt` explicitly retries.
  useEffect(() => {
    if (revision === undefined) return;
    let active = true;
    const abort = new AbortController();
    checkSetup(controller, send, abort.signal)
      .then((result) => {
        if (!active) return;
        setChecked({
          revision: result.revision,
          issues: requiredIssues(result),
        });
        setCheckError(false);
      })
      .catch((error: unknown) => {
        // A newer revision is already being read; that read rechecks.
        if (
          active &&
          !(error instanceof DraftFailure && error.code === "revision_conflict")
        )
          setCheckError(true);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [controller, send, revision, checkAttempt]);

  const saved = state.progress?.step ?? state.confirmed?.progress?.step;
  const step = resumeStep(saved, checked?.issues ?? null);
  const index = stepIndex(step);
  const back = previousStep(step);
  const loading = !state.working || (!checked && !checkError);
  const disabled =
    navigating ||
    state.suspended ||
    Boolean(recoveryState.review) ||
    recoveryState.busy ||
    !state.working ||
    state.error === "owner_changed";
  const imagePending = Object.values(state.pendingImages).some(Boolean);
  // Another tab (or an earlier Open editor) already made the permanent
  // handoff. This tab cannot save setup changes or replay its progress; it
  // only offers the editor, which reviews any preserved input there.
  const closed =
    state.confirmed?.firstEditorEnteredAt != null ||
    state.error === "setup_closed";

  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    setStepError("");
    // Leaving the GitHub screen forgets a typed username nobody looked up;
    // the step reads a fresh status when it is shown again.
    setAddingGraph(false);
    setGraphStatus(null);
    setGraphUnchecked(false);
    heading.current?.focus();
  }, [step]);

  // Progress is navigation only: it is saved after the step's own content
  // has been confirmed, and the shell still clamps it to the server facts.
  async function go(target: GuideStep) {
    setNavigating(true);
    setStepError("");
    setHandoffNotice("");
    try {
      controller.changeProgress(progressFor(target));
      await controller.flushValid();
      // The control that started navigation may have been removed with its
      // step; move focus to the new heading once rendering has settled.
      requestAnimationFrame(() => heading.current?.focus());
      return true;
    } catch {
      setStepError(
        "We couldn't save your place. Your answers are kept. Retry to continue.",
      );
      return false;
    } finally {
      setNavigating(false);
    }
  }

  // Profile and Links continue only after their values are saved and the
  // authoritative setup check no longer reports them. Local input that does
  // not fit the draft, or an unfinished image, stays on the step.
  async function continueFrom(from: "profile" | "links") {
    if (navigating) return;
    const target = nextStep(from);
    if (!target) return;
    setNavigating(true);
    setStepError("");
    try {
      if (Object.keys(controller.store.getState().inputs).length > 0) {
        setStepError(
          "Some of your input isn't valid yet. Fix the highlighted fields to continue.",
        );
        return;
      }
      await controller.flushValid();
      const next = await refresh();
      const missing = stepFields[from].filter((field) =>
        next.issues?.includes(field),
      );
      if (missing.length > 0) {
        // The server reports a bio over the limit as an incomplete bio.
        const bio = controller.store.getState().working?.profile.bio ?? "";
        const long = [...bio].length > BIO_MAX;
        const rest = missing.filter((item) => !(long && item === "bio"));
        setStepError(
          from === "links"
            ? "Add at least one valid link with a label."
            : [
                rest.length > 0 ? `Still needed: ${rest.join(", ")}.` : "",
                long ? `Shorten your bio to ${BIO_MAX} characters.` : "",
              ]
                .filter(Boolean)
                .join(" "),
        );
        return;
      }
    } catch {
      setStepError(
        "We couldn't save and check this step. Your answers are kept. Retry to continue.",
      );
      return;
    } finally {
      setNavigating(false);
    }
    await go(target);
  }

  // Skills and Projects are optional. Continue keeps entered content and
  // drops only entries nothing was typed into; a project that has content
  // still needs its title and summary here, while Skip keeps it as is.
  async function continueOptional(from: OptionalType) {
    if (navigating) return;
    const target = nextStep(from);
    if (!target) return;
    setNavigating(true);
    setStepError("");
    try {
      if (Object.keys(controller.store.getState().inputs).length > 0) {
        setStepError(
          "Some of your input isn't valid yet. Fix the highlighted fields, or skip to keep it for later.",
        );
        return;
      }
      settleOptional(controller, from);
      if (from === "projects") {
        const projects = findOptional(
          controller.store.getState().working,
          "projects",
        );
        if (projects?.data.entries.some(projectIncomplete)) {
          setStepError(
            "Each project needs a title and summary. Add them, remove the project, or skip to keep it as is.",
          );
          return;
        }
      }
      await controller.flushValid();
    } catch {
      setStepError(
        "We couldn't save this step. Your answers are kept. Retry to continue.",
      );
      return;
    } finally {
      setNavigating(false);
    }
    await go(target);
  }

  // The GitHub screen continues only with a complete graph configuration, or
  // without a graph. An unfinished one offers Retry, Use public activity only
  // (in the panel) and Finish later, which keeps it with its publication
  // blocker. No graph state ever blocks reaching the editor.
  async function continueGitHub() {
    if (navigating) return;
    const target = nextStep("github");
    if (!target) return;
    setNavigating(true);
    setStepError("");
    try {
      const graph = findGraph(controller.store.getState().working);
      if (!graph) {
        if (addingGraph) {
          setStepError(graphGapMessage.fetch);
          return;
        }
      } else {
        let status: GraphSetupStatus;
        try {
          status = await readGraphStatus();
        } catch {
          setGraphUnchecked(true);
          setStepError(
            "We couldn't check your graph. Retry, or finish it later in the editor.",
          );
          return;
        }
        setGraphUnchecked(false);
        setGraphStatus(status);
        const gap = graphGap(status, graph);
        if (gap) {
          setStepError(graphGapMessage[gap]);
          return;
        }
      }
      await controller.flushValid();
    } catch {
      setStepError(
        "We couldn't save this step. Your answers are kept. Retry to continue.",
      );
      return;
    } finally {
      setNavigating(false);
    }
    await go(target);
  }

  // Skipping keeps entered content, and for GitHub the graph, its connection
  // and any granted access: skipping never disconnects.
  async function skip(from: GuideStep, target: GuideStep | null) {
    if (navigating || !target) return;
    if (from === "skills" || from === "projects")
      settleOptional(controller, from);
    await go(target);
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await onSignOut();
    } catch {
      setSigningOut(false);
      setSignOutError(
        "We couldn't sign you out. Check your connection and retry sign-out.",
      );
    }
  }

  const copy = stepCopy[step];
  const actions = stepActions(step);
  const segments = progressSegments(step);
  const currentGraph = findGraph(state.working);
  const graphUnfinished = Boolean(
    currentGraph &&
      (graphUnchecked ||
        (graphStatus && graphGap(graphStatus, currentGraph) !== null)),
  );
  const needsAttention =
    ["failed", "blocked"].includes(state.status) ||
    state.recoveries.length > 0 ||
    Boolean(recoveryState.review) ||
    Boolean(recoveryState.error) ||
    !state.localRecoveryAvailable ||
    Boolean(state.pending) ||
    Boolean(state.batch) ||
    Boolean(state.validationJournal) ||
    Boolean(state.discardJournal);
  // The top bar shows the address once the server confirms the hold.
  const heldAddress =
    checked && !checked.issues?.includes("address")
      ? state.confirmed?.draft.requestedSubdomain
      : undefined;
  const showActions = !loading && !closed;
  const opening = reviewAction === "opening";
  const primaryLabel =
    step === "review"
      ? opening
        ? "Opening editor..."
        : reviewAction === "failed"
          ? "Retry opening editor"
          : actions.primary
      : navigating
        ? "Saving..."
        : actions.primary;
  const progressItem =
    (offset: number) =>
    (progress: "done" | "current" | "todo", position: number) => {
      const item = guideSteps[offset + position] ?? "review";
      return (
        <li
          key={item}
          data-state={progress}
          aria-current={progress === "current" ? "step" : undefined}
        >
          <span className="wb-visually-hidden">
            {stepCopy[item].label}
            {progress === "done"
              ? ", done"
              : progress === "current"
                ? ", current step"
                : ""}
          </span>
        </li>
      );
    };

  return (
    <div
      className="setup-guide workbench"
      data-guide-step={loading ? "loading" : step}
      data-editor-scope={controller.scopeKey}
    >
      <header className="guide-topbar">
        <div className="guide-topbar-start">
          <a className="guide-mark" href="/">
            <span aria-hidden="true">h</span>
            <span className="wb-visually-hidden">hasaweb.site home</span>
          </a>
          {heldAddress && (
            <span className="guide-held" data-guide-address={heldAddress}>
              <span className="guide-held-name">
                {heldAddress}.hasaweb.site
              </span>
              <StatusPill status="draft">Private</StatusPill>
            </span>
          )}
        </div>
        {!loading && (
          <div className="guide-progress-wrap">
            <ol className="guide-progress" aria-label="Setup progress">
              <li className="guide-progress-group">
                <ol aria-label="Required steps">
                  {segments.required.map(progressItem(0))}
                </ol>
              </li>
              <li className="guide-progress-group">
                <ol aria-label="Optional steps">
                  {segments.optional.map(
                    progressItem(segments.required.length),
                  )}
                </ol>
              </li>
            </ol>
          </div>
        )}
        <div className="guide-topbar-end">
          <SaveState status={state.status} />
          <Button
            size="s"
            kind="ghost"
            className="guide-sign-out"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            <Icon name="log-out" size={16} />
            <span className="guide-label">
              {signingOut ? "Signing out..." : "Sign out"}
            </span>
          </Button>
        </div>
      </header>
      <main className="guide-stage" data-step-kind={step}>
        <div className="guide-column">
          {closed ? (
            <div className="guide-prompt" data-guide-closed="">
              <h1 ref={heading} tabIndex={-1}>
                Your portfolio is in the editor
              </h1>
              <Button kind="primary" onClick={() => onEntered(null)}>
                Open editor
              </Button>
            </div>
          ) : loading ? (
            checkError ? null : (
              <p role="status" className="guide-loading">
                Opening your setup...
              </p>
            )
          ) : (
            <>
              <div className="guide-prompt">
                {step !== "review" && (
                  <p className="guide-kicker">
                    {String(index + 1).padStart(2, "0")}
                    <span aria-hidden="true"> · </span>
                    <span className="wb-visually-hidden">, </span>
                    {copy.label}
                  </p>
                )}
                <h1 ref={heading} tabIndex={-1}>
                  {copy.title}
                </h1>
              </div>
              {step === "address" ? (
                <GuideAddress
                  formId={formId}
                  controller={controller}
                  disabled={disabled}
                  onReserved={async () => {
                    try {
                      const next = await refresh();
                      if (next.issues?.includes("address")) {
                        setStepError(
                          "We couldn't confirm your reservation. Retry to continue.",
                        );
                        return;
                      }
                    } catch {
                      setStepError(
                        "We couldn't confirm your reservation. Retry to continue.",
                      );
                      return;
                    }
                    const target = nextStep("address");
                    if (target) await go(target);
                  }}
                />
              ) : step === "profile" || step === "links" ? (
                <form
                  id={formId}
                  className="guide-answer"
                  aria-label={
                    step === "profile" ? "Your profile" : "Your links"
                  }
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    void continueFrom(step);
                  }}
                >
                  {step === "profile" ? (
                    <GuideProfile controller={controller} disabled={disabled} />
                  ) : (
                    <GuideLinks controller={controller} disabled={disabled} />
                  )}
                </form>
              ) : step === "skills" || step === "projects" ? (
                <form
                  id={formId}
                  className="guide-answer"
                  aria-label={
                    step === "skills" ? "Your skills" : "Your projects"
                  }
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    void continueOptional(step);
                  }}
                >
                  {step === "skills" ? (
                    <GuideSkills controller={controller} disabled={disabled} />
                  ) : (
                    <GuideProjects
                      controller={controller}
                      disabled={disabled}
                    />
                  )}
                </form>
              ) : step === "github" ? (
                <>
                  {/* The lookup field and its buttons stay outside the form,
                      so Enter in the username field looks it up instead of
                      continuing. */}
                  <form
                    id={formId}
                    aria-label="Your GitHub activity"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault();
                      void continueGitHub();
                    }}
                  />
                  <div className="guide-answer">
                    <GuideGitHub
                      controller={controller}
                      disabled={disabled}
                      onAdding={setAddingGraph}
                      onStatus={(status) => {
                        setGraphStatus(status);
                        if (status) setGraphUnchecked(false);
                      }}
                      beforeConsent={async () => {
                        try {
                          // Consent returns to this saved step.
                          controller.changeProgress(progressFor("github"));
                          await controller.flushValid();
                          return true;
                        } catch {
                          return false;
                        }
                      }}
                    />
                    {graphUnfinished && (
                      <div
                        className="guide-notice"
                        data-guide-github-unfinished=""
                      >
                        <StatusPill status="issue">Unfinished</StatusPill>
                        <Button
                          size="s"
                          kind="ghost"
                          disabled={disabled}
                          onClick={() => {
                            const target = nextStep("github");
                            if (target) void go(target);
                          }}
                        >
                          Finish later in the editor
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <GuideReview
                  formId={formId}
                  recovery={recovery}
                  controller={controller}
                  disabled={disabled}
                  send={send}
                  previewDocument={previewDocument}
                  onAction={setReviewAction}
                  onEntered={onEntered}
                  onRequired={(entered) => {
                    if (entered.result.kind !== "required") return;
                    const issues = entered.result.issues;
                    // The shell returns to the first step the server reports.
                    setChecked({ revision: entered.result.revision, issues });
                    setHandoffNotice(
                      `Required content is missing: ${issues.join(", ")}. Complete it to open the editor.`,
                    );
                  }}
                />
              )}
            </>
          )}
          {checkError && (
            <div className="guide-alert" role="alert">
              <p>We couldn't check your setup. Your answers are kept.</p>
              <Button
                size="s"
                onClick={() => {
                  setCheckError(false);
                  setCheckAttempt((value) => value + 1);
                }}
              >
                Retry
              </Button>
            </div>
          )}
          {handoffNotice && !closed && (
            <p className="guide-error" role="alert">
              {handoffNotice}
            </p>
          )}
          {stepError && (
            <p className="guide-error" role="alert">
              {stepError}
            </p>
          )}
          {signOutError && (
            <p className="guide-error" role="alert">
              {signOutError}
            </p>
          )}
          {needsAttention && (
            <div className="guide-recovery">
              <DraftRecovery recovery={recovery} />
            </div>
          )}
          {showActions && (
            // Setup v2 / Actions: Back on the left; Skip to review, Skip and
            // the primary action on the right. Required steps never offer a
            // skip or an editor bypass.
            <div className="guide-actions">
              {actions.back && back && (
                <Button
                  kind="ghost"
                  icon="chevron-left"
                  className="guide-back"
                  disabled={disabled}
                  onClick={() => void go(back)}
                >
                  <span className="guide-label">Back</span>
                </Button>
              )}
              <div className="guide-forward">
                {actions.skipToReview && (
                  <Button
                    kind="ghost"
                    className="guide-skip-review"
                    disabled={disabled}
                    onClick={() => void skip(step, remainingTarget)}
                  >
                    Skip to review
                  </Button>
                )}
                {actions.skip && (
                  <Button
                    kind="ghost"
                    className="guide-skip"
                    disabled={disabled}
                    onClick={() => void skip(step, nextStep(step))}
                  >
                    Skip
                  </Button>
                )}
                <Button
                  kind="primary"
                  type="submit"
                  form={formId}
                  className="guide-continue"
                  disabled={
                    disabled ||
                    (step === "review"
                      ? opening || state.status === "saving"
                      : imagePending)
                  }
                >
                  {primaryLabel}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const saveLabels = {
  loading: "Loading...",
  saving: "Saving",
  saved: "Saved",
  unsaved: "Unsaved",
  failed: "Couldn't save",
  blocked: "Couldn't save",
} as const;

// The top bar's save state (Figma 464:11845). Retry and the other recovery
// choices sit with the step, in the shared draft recovery controls.
function SaveState({ status }: { status: keyof typeof saveLabels }) {
  return (
    <span className="guide-save" data-save-status={status}>
      {status === "unsaved" ? (
        <span className="guide-save-dot" aria-hidden="true" />
      ) : (
        <Icon
          name={
            status === "saved"
              ? "cloud-check"
              : status === "saving" || status === "loading"
                ? "loader"
                : "wifi-off"
          }
          size={16}
        />
      )}
      {saveLabels[status]}
    </span>
  );
}
