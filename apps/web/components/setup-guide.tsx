"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import { watchAccountDeletion } from "../lib/account-deletion";
import { takeAddressSuggestion } from "../lib/address-suggestion";
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
  isSkippable,
  nextStep,
  previousStep,
  progressFor,
  type RequiredIssues,
  remainingTarget,
  requiredIssues,
  requiredSteps,
  resumeStep,
  stepFields,
  stepIndex,
} from "../lib/guide/steps";
import { AccountDeleted } from "./account-deletion";
import { Brand } from "./brand";
import { DraftRecovery } from "./draft-recovery";
import { GuideGitHub } from "./guide-github-step";
import { GuideProjects, GuideSkills } from "./guide-optional-steps";
import { GuideReview, type HandoffResult } from "./guide-review-step";
import { ProfileControls } from "./profile-controls";
import { SocialLinksControl } from "./social-links-control";
import { useAddressReservation } from "./use-address-reservation";
import "./setup-guide.css";

type Owner = { ownerId: string; portfolioId: string };

const stepCopy: Record<
  GuideStep,
  { label: string; title: string; intro: string }
> = {
  address: {
    label: "Address",
    title: "Choose your address",
    intro: "A place on the web for your work.",
  },
  profile: {
    label: "Profile",
    title: "Introduce yourself",
    intro: "Your name, a short bio, a photo and a banner.",
  },
  links: {
    label: "Links",
    title: "Where can people find you?",
    intro: "Add at least one link to show on your profile.",
  },
  skills: {
    label: "Skills",
    title: "What do you work with?",
    intro: "Add the skills you want to share.",
  },
  projects: {
    label: "Projects",
    title: "Show your work",
    intro: "Add the projects you want people to see.",
  },
  github: {
    label: "GitHub",
    title: "Your activity, at a glance",
    intro: "Add a GitHub contribution graph to your portfolio.",
  },
  review: {
    label: "Review",
    title: "Take a look around",
    intro: "Review your portfolio before opening the editor.",
  },
};

const formId = "setup-guide-step";

// The editor's iframe preview document (registered by the web Worker).
const defaultPreviewDocument = "/editor/preview";

// After the permanent handoff the same tab opens the editor, whose fresh
// content-scope controller offers any preserved setup input for review.
const openEditor = () => window.location.replace("/editor");

// The first-portfolio guide: Address, Profile, Links, optional Skills,
// Projects and GitHub, then Review and the permanent editor handoff. The
// account entry (`OwnerEntry`) mounts it for owners who have not entered the
// editor, behind the Phase 42E activation gate.
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
      <main className="setup-guide">
        <p role="status">Opening your setup...</p>
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
  // The GitHub screen: whether Add graph was chosen before any account was
  // accepted, the panel's latest status, and a failed status read.
  const [addingGraph, setAddingGraph] = useState(false);
  const [graphStatus, setGraphStatus] = useState<GraphSetupStatus | null>(null);
  const [graphUnchecked, setGraphUnchecked] = useState(false);

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
  const required = requiredSteps.has(step);
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
    // Leaving the GitHub screen forgets an unfinished Add graph choice; the
    // panel reads a fresh status when it is shown again.
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
        setStepError(
          from === "profile"
            ? `Still needed: ${missing.join(", ")}. Sample content does not count.`
            : "Add at least one valid link with a label, shown in your profile.",
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
          "Some of your input isn't valid yet. Fix the highlighted fields, or skip this step to keep it for later.",
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
            "Each project needs a title and summary. Add them, remove the project, or skip this step to keep it as is.",
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

  const saveLabel = {
    loading: "Loading...",
    saving: "Saving",
    saved: "Saved",
    unsaved: "Unsaved input",
    failed: "Couldn't save",
    blocked: "Couldn't save",
  }[state.status];
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
  const copy = stepCopy[step];
  const currentGraph = findGraph(state.working);
  const graphUnfinished = Boolean(
    currentGraph &&
      (graphUnchecked ||
        (graphStatus && graphGap(graphStatus, currentGraph) !== null)),
  );

  return (
    <div
      className="setup-guide"
      data-guide-step={loading ? "loading" : step}
      data-editor-scope={controller.scopeKey}
    >
      <header className="guide-header">
        <Brand />
        <span className="guide-spacer" />
        <span className="guide-save" data-save-status={state.status}>
          {saveLabel}
        </span>
        <button
          type="button"
          className="ghost-button"
          onClick={() => void signOut()}
          disabled={signingOut}
        >
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </header>
      <nav className="guide-nav" aria-label="Setup steps">
        <div className="guide-nav-back">
          {back && !loading && !closed && (
            <button
              type="button"
              className="ghost-button guide-back"
              disabled={disabled}
              onClick={() => void go(back)}
            >
              <span aria-hidden="true">‹</span> Back
            </button>
          )}
        </div>
        <ol className="guide-progress" aria-label="Setup progress">
          {guideSteps.map((item, position) => (
            <li
              key={item}
              data-reached={position <= index ? "true" : "false"}
              aria-current={position === index && !loading ? "step" : undefined}
            >
              <span className="sr-only">
                {stepCopy[item].label}
                {position < index
                  ? ", visited"
                  : position === index
                    ? ", current step"
                    : ""}
              </span>
            </li>
          ))}
        </ol>
        {/* Required steps never offer a skip or an editor bypass. */}
        <div className="guide-nav-skip">
          {!loading && !closed && isSkippable(step) && (
            <>
              <button
                type="button"
                className="ghost-button"
                disabled={disabled}
                onClick={() => void skip(step, nextStep(step))}
              >
                Skip this step
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={disabled}
                onClick={() => void skip(step, remainingTarget)}
              >
                Skip remaining steps
              </button>
            </>
          )}
        </div>
      </nav>
      <main className="guide-content">
        {closed ? (
          <div className="guide-form" data-guide-closed="">
            <div className="guide-heading">
              <h1 ref={heading} tabIndex={-1}>
                Your portfolio is in the editor
              </h1>
              <p className="guide-intro">
                Setup is complete, so this page can't change your draft. Any
                unsaved input from this tab stays available for recovery in the
                editor.
              </p>
            </div>
            <button
              type="button"
              className="guide-continue"
              onClick={() => onEntered(null)}
            >
              Open editor
            </button>
          </div>
        ) : loading ? (
          checkError ? null : (
            <p role="status">Opening your setup...</p>
          )
        ) : (
          <div className="guide-form">
            <div className="guide-heading">
              <p className="caption">
                {String(index + 1).padStart(2, "0")} /{" "}
                {String(guideSteps.length).padStart(2, "0")}
                {required ? "" : " · Optional"}
              </p>
              <h1 ref={heading} tabIndex={-1}>
                {copy.title}
              </h1>
              <p className="guide-intro">{copy.intro}</p>
            </div>
            {step === "address" ? (
              <AddressStep
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
                className="guide-fields guide-wide"
                aria-label={step === "profile" ? "Your profile" : "Your links"}
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void continueFrom(step);
                }}
              >
                {step === "profile" ? (
                  <ProfileControls
                    controller={controller}
                    disabled={disabled}
                    showLocation={false}
                  />
                ) : (
                  <SocialLinksControl
                    controller={controller}
                    disabled={disabled}
                  />
                )}
              </form>
            ) : step === "skills" || step === "projects" ? (
              <form
                id={formId}
                className="guide-fields guide-wide"
                aria-label={step === "skills" ? "Your skills" : "Your projects"}
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void continueOptional(step);
                }}
              >
                {step === "skills" ? (
                  <GuideSkills controller={controller} disabled={disabled} />
                ) : (
                  <GuideProjects controller={controller} disabled={disabled} />
                )}
              </form>
            ) : step === "github" ? (
              <>
                {/* The panel's own fields and buttons stay outside the
                    form, so Enter in the username field never continues. */}
                <form
                  id={formId}
                  aria-label="Your GitHub activity"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    void continueGitHub();
                  }}
                />
                <div className="guide-fields guide-wide">
                  <GuideGitHub
                    controller={controller}
                    disabled={disabled}
                    adding={addingGraph}
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
                    <div className="guide-note" data-guide-github-unfinished="">
                      <p>GitHub needs attention</p>
                      <p>
                        Your graph stays in your draft as unfinished, and
                        publishing is blocked until you complete it or remove it
                        in the editor. The rest of your portfolio isn't
                        affected.
                      </p>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={disabled}
                        onClick={() => {
                          const target = nextStep("github");
                          if (target) void go(target);
                        }}
                      >
                        Finish later in the editor
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <GuideReview
                recovery={recovery}
                controller={controller}
                disabled={disabled}
                send={send}
                previewDocument={previewDocument}
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
          </div>
        )}
        {checkError && (
          <div className="auth-error guide-alert" role="alert">
            <p>We couldn't check your setup.</p>
            <p>Your answers are kept. Check your connection and retry.</p>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setCheckError(false);
                setCheckAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
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
      </main>
      {!loading &&
        !closed &&
        (requiredSteps.has(step) || isSkippable(step)) && (
          <footer className="guide-footer">
            <button
              className="guide-continue"
              type="submit"
              form={formId}
              disabled={disabled || imagePending}
            >
              {navigating ? "Saving..." : "Continue"}
            </button>
          </footer>
        )}
    </div>
  );
}

function AddressStep({
  controller,
  disabled,
  onReserved,
}: {
  controller: ReturnType<typeof createDraftController>;
  disabled: boolean;
  onReserved(): Promise<void>;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const address = useAddressReservation(controller, {
    action: "Continue",
    idle: "Continue to reserve this address. Your site stays private.",
  });
  const { value, valid, busy, registry } = address;
  const status = address.status;
  // A name typed on the entry page fills an empty field once and is checked
  // like any typed name; only Continue reserves it.
  const [suggested, setSuggested] = useState<string | null>(null);
  const change = address.change;
  // biome-ignore lint/correctness/useExhaustiveDependencies: The suggestion is taken once, against the field as the step first shows it.
  useEffect(() => {
    const name = takeAddressSuggestion();
    if (name && !value) {
      change(name);
      setSuggested(name);
    }
  }, []);
  const check = address.check;
  useEffect(() => {
    if (suggested === null || suggested !== value) return;
    setSuggested(null);
    void check();
  }, [suggested, value, check]);
  async function submit() {
    if (working || busy || disabled) return;
    if (!valid) {
      input.current?.focus();
      return;
    }
    setWorking(true);
    try {
      // A confirmed hold on this exact name needs no new reservation.
      if (!address.held) {
        const available = await address.check();
        if (available !== "available" && available !== "held") {
          input.current?.focus();
          return;
        }
        if (!(await address.reserve())) {
          input.current?.focus();
          return;
        }
      }
      await onReserved();
    } finally {
      setWorking(false);
    }
  }
  return (
    <form
      id={formId}
      className="guide-fields"
      aria-label="Portfolio address"
      data-publication-field="address"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="guide-field">
        <label htmlFor={id}>Your address</label>
        <div className="guide-address-input">
          <input
            ref={input}
            id={id}
            name="address"
            value={value}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={`${id}-status ${id}-help`}
            aria-invalid={address.tone === "error"}
            disabled={disabled || busy || working}
            onChange={(event) => address.change(event.target.value)}
            // Disabling the field during Continue blurs it; that submit
            // already runs its own availability check.
            onBlur={() => {
              if (!working) void address.check();
            }}
          />
          <span aria-hidden="true">.hasaweb.site</span>
        </div>
      </div>
      <p
        id={`${id}-status`}
        className="guide-address-status"
        data-tone={address.tone}
        role="status"
        aria-live="polite"
      >
        {address.tone === "success" && <span aria-hidden="true">✓ </span>}
        {busy ? "Reserving your address..." : status}
      </p>
      <p id={`${id}-help`} className="guide-help">
        3–30 lowercase letters, numbers or hyphens. No hyphen at either end.
      </p>
      {registry && registry.name !== value && (
        <p className="guide-help">
          Current reservation: {registry.name}.hasaweb.site
        </p>
      )}
      <div className="guide-note">
        <p>Reserved when you continue</p>
        <p>
          Continuing holds this address for your portfolio. Nothing is public
          until you publish, and the address becomes permanent on your first
          publication. You can change it until then.
        </p>
      </div>
    </form>
  );
}
