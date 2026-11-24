"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { removeEditorComponent } from "../lib/editor/components";
import {
  choosePublicOnly,
  detectGraphUsername,
  type GraphPreviewData,
  GraphSetupError,
  type GraphSetupStatus,
  loadGraphPreview,
  readGraphStatus,
  retryGraph,
  setGitHubPrivate,
  setupGraph,
  startPrivateConsent,
  withdrawGraphAccess,
} from "../lib/editor/github-graph";
import { acceptGraph, findGraph } from "../lib/guide/github";
import { describeGraph, describePrivate } from "./github-controls";
import { ComponentRemovalDialog } from "./section-removal-dialog";
import {
  Button,
  Dialog,
  Icon,
  SegmentedControl,
  StatusPill,
} from "./workbench";

const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const UNAVAILABLE =
  "GitHub couldn't be reached. Your draft is unchanged. Retry.";
const failures: Record<string, string> = {
  invalid_username:
    "Enter a GitHub username: letters, numbers and single hyphens, up to 39 characters.",
  not_found: "GitHub has no account with that username. Check the spelling.",
  unavailable: UNAVAILABLE,
  misconfigured:
    "GitHub returned a response we can't use right now. Try again later.",
  too_soon: "Wait a few seconds, then try again.",
  conflict: "Your graph changed in another tab. Reload and retry.",
  consent_busy:
    "Earlier private access for this GitHub account is still being removed. Try again in a minute. Public activity works meanwhile.",
  private_unavailable:
    "Private activity isn't available right now. Your public graph still works.",
};
const failure = (cause: unknown) =>
  failures[cause instanceof GraphSetupError ? cause.code : "unavailable"] ??
  UNAVAILABLE;

// The GitHub step (Figma 471:11820, private contributions 463:12863): look
// up a username, see the graph it gives, and choose Public or Public +
// private. Nothing is added until the server accepts a username the owner
// looked up. Public + private asks first, then authorizes the separate
// activity app; GitHub returns to this saved step. Recovery choices (Retry,
// Authorize again, Use public activity only) appear only when needed.
export function GuideGitHub({
  controller,
  disabled,
  onAdding,
  onStatus,
  beforeConsent,
}: {
  controller: DraftController;
  disabled: boolean;
  // A username was typed but no account has been accepted yet.
  onAdding(adding: boolean): void;
  onStatus(status: GraphSetupStatus | null): void;
  beforeConsent(): Promise<boolean>;
}) {
  const state = useStore(controller.store);
  const graph = findGraph(state.working);
  const saved = graph?.data.username ?? "";
  const includePrivate = graph?.data.includePrivate ?? false;
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [typed, setTyped] = useState<string | null>(null);
  const [status, setStatus] = useState<GraphSetupStatus | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [preview, setPreview] = useState<GraphPreviewData>(null);
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const reportStatus = useRef(onStatus);
  reportStatus.current = onStatus;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (status) reportStatus.current(status);
  }, [status]);
  useEffect(() => {
    let current = true;
    readGraphStatus()
      .then(async (next) => {
        if (!current) return;
        setStatus(next);
        // Detection only suggests a name. It selects nothing.
        if (next.canDetect && !next.connection && !saved) {
          const login = await detectGraphUsername().catch(() => null);
          if (current) setSuggestion(login);
        }
      })
      .catch(() => {
        if (current)
          setProblem("Your graph status is unavailable. Reload to try again.");
      });
    return () => {
      current = false;
    };
  }, [saved]);
  // Revocation at GitHub runs in the background after a withdrawal. Re-read
  // the status until it settles.
  const cleaning = status?.private.state === "cleanup";
  useEffect(() => {
    if (!cleaning) return;
    let current = true;
    const timer = setInterval(() => {
      readGraphStatus()
        .then((next) => {
          if (current) setStatus(next);
        })
        .catch(() => {
          // A missed poll is retried on the next tick.
        });
    }, 2000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [cleaning]);

  const value = typed ?? (saved || status?.connection?.username || "");
  const candidate = value.trim();
  const reportAdding = useRef(onAdding);
  reportAdding.current = onAdding;
  const adding = Boolean(candidate) && !graph;
  useEffect(() => {
    reportAdding.current(adding);
  }, [adding]);
  const connection = status?.connection ?? null;
  const needsFetch =
    !connection ||
    connection.username.toLowerCase() !== saved.toLowerCase() ||
    candidate.toLowerCase() !== connection.username.toLowerCase();
  const summary = describeGraph(status, saved);
  const fetched = !needsFetch && status?.public.state === "ready";
  const privateState = status?.private ?? { state: "off" as const };
  const authorized = ["ready", "pending", "error"].includes(privateState.state);
  const failed = ["consent_failed", "reconnect", "authorizing"].includes(
    privateState.state,
  );
  const privateSummary = describePrivate(privateState, includePrivate);
  const showPrivate =
    Boolean(graph) && (includePrivate || failed || cleaning || authorized);
  const statusAt =
    status?.public.state === "ready" ? status.public.fetchedAt : "";

  // The preview reads the selected account's calendar after each fetch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new fetch time re-reads the calendar.
  useEffect(() => {
    if (!fetched) {
      setPreview(null);
      return;
    }
    const request = new AbortController();
    loadGraphPreview(request.signal, includePrivate)
      .then((next) => {
        if (!request.signal.aborted) setPreview(next);
      })
      .catch(() => {
        // An aborted read is replaced by the next one.
      });
    return () => request.abort();
  }, [fetched, includePrivate, statusAt]);

  async function run(action: () => Promise<GraphSetupStatus>) {
    setBusy(true);
    setProblem("");
    try {
      const next = await action();
      if (!alive.current) return;
      setStatus(next);
      // Even a failed first fetch keeps the selection, so Retry needs no
      // retyping.
      if (next.connection) {
        acceptGraph(controller, next.connection.username);
        setTyped(null);
        setSuggestion(null);
      }
    } catch (cause) {
      if (alive.current) setProblem(failure(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setProblem("");
    try {
      await action();
      const next = await readGraphStatus();
      if (alive.current) setStatus(next);
    } catch (cause) {
      if (alive.current) setProblem(failure(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const setPrivate = (next: boolean) => {
    const current = findGraph(controller.store.getState().working);
    if (current) setGitHubPrivate(controller, current.id, next);
  };
  async function authorize() {
    setBusy(true);
    setProblem("");
    try {
      if (!includePrivate) setPrivate(true);
      if (!(await beforeConsent())) {
        if (alive.current) {
          setProblem(
            "Your draft couldn't be saved, so authorization didn't start. Retry.",
          );
          setBusy(false);
        }
        return;
      }
      const url = await startPrivateConsent(undefined, "setup");
      // Same tab: GitHub returns to the guide, which resumes this step.
      location.assign(url);
    } catch (cause) {
      if (alive.current) {
        setProblem(failure(cause));
        setBusy(false);
      }
    }
  }
  function lookUp() {
    if (inactive || busy || !LOGIN.test(candidate)) {
      if (candidate && !LOGIN.test(candidate))
        setProblem(failures.invalid_username ?? "");
      return;
    }
    void run(() => (needsFetch ? setupGraph(candidate) : retryGraph()));
  }
  function choose(next: "public" | "private") {
    if (next === "private") {
      // With access granted, or earlier access still being removed (whose
      // status then shows), the choice needs no new consent yet.
      if (authorized || cleaning) setPrivate(true);
      else if (!status?.privateAvailable)
        setProblem(failures.private_unavailable ?? "");
      else setAsking(true);
      return;
    }
    if (failed || privateState.state === "authorizing")
      void act(async () => {
        await choosePublicOnly();
        setPrivate(false);
      });
    else setPrivate(false);
  }

  const pill = busy
    ? { status: "pending" as const, label: "Checking" }
    : problem && !graph
      ? {
          status: "issue" as const,
          label:
            problem === failures.not_found ? "Not found" : "Couldn't check",
        }
      : graph && !needsFetch
        ? summary.ok
          ? { status: "live" as const, label: "Found" }
          : { status: "issue" as const, label: "Unfinished" }
        : null;
  const total =
    includePrivate && privateState.state === "ready"
      ? privateState.total
      : status?.public.state === "ready"
        ? status.public.total
        : 0;
  return (
    <section
      aria-label="GitHub activity controls"
      className="guide-github"
      data-guide-github={graph ? "added" : candidate ? "adding" : "none"}
    >
      <div className="guide-big-field" data-publication-field="username">
        <Icon name="github" size={20} />
        <label htmlFor={id} className="wb-visually-hidden">
          GitHub username
        </label>
        <input
          ref={field}
          id={id}
          value={value}
          placeholder="Your GitHub username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={39}
          disabled={inactive || busy}
          aria-describedby={`${id}-status`}
          onChange={(event) => {
            setTyped(event.target.value);
            setProblem("");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            lookUp();
          }}
        />
        {pill ? (
          <span className="guide-big-field-status">
            <StatusPill status={pill.status}>{pill.label}</StatusPill>
          </span>
        ) : (
          <button
            type="button"
            className="guide-kbd"
            aria-label="Fetch activity"
            data-github-action="fetch"
            disabled={inactive || busy || !LOGIN.test(candidate)}
            onClick={lookUp}
          >
            ↵
          </button>
        )}
      </div>
      {suggestion &&
        !saved &&
        candidate.toLowerCase() !== suggestion.toLowerCase() && (
          <ul className="guide-pills" aria-label="Detected username">
            <li>
              <button
                type="button"
                className="guide-pill"
                aria-label={`Use @${suggestion}`}
                disabled={inactive || busy}
                onClick={() => {
                  setTyped(suggestion);
                  field.current?.focus();
                }}
              >
                <Icon name="github" size={16} />@{suggestion}
              </button>
            </li>
          </ul>
        )}
      {problem && (
        <p className="guide-field-error" role="alert">
          {problem}
        </p>
      )}
      <p
        id={`${id}-status`}
        role="status"
        className={
          !graph || (summary.ok && !needsFetch)
            ? "wb-visually-hidden"
            : "guide-github-note"
        }
        data-github-status={status?.public.state ?? "loading"}
      >
        {graph ? summary.text : ""}
      </p>
      {graph && !needsFetch && !summary.ok && (
        <div className="guide-github-actions">
          <Button
            size="s"
            data-github-action="retry"
            disabled={inactive || busy}
            onClick={() => void run(retryGraph)}
          >
            Retry
          </Button>
        </div>
      )}
      {fetched && (
        <section
          className="guide-card guide-graph"
          aria-label="Contribution graph"
        >
          <div className="guide-graph-head">
            <span>
              {total.toLocaleString("en")}{" "}
              {total === 1 ? "contribution" : "contributions"}
            </span>
            <span className="guide-graph-range">last 12 months</span>
          </div>
          <Calendar days={preview?.days ?? []} />
        </section>
      )}
      {fetched && (
        <SegmentedControl
          label="GitHub activity shown"
          value={includePrivate ? "private" : "public"}
          onChange={choose}
          options={[
            { value: "public", label: "Public", icon: "globe" },
            { value: "private", label: "Public + private", icon: "lock" },
          ]}
        />
      )}
      {showPrivate && (
        <div
          className="guide-github-private"
          data-publication-field="includePrivate"
          data-github-private={privateState.state}
        >
          <p
            role="status"
            className={
              privateSummary.ok && includePrivate
                ? "wb-visually-hidden"
                : "guide-github-note"
            }
            data-github-private-status={privateState.state}
          >
            {privateSummary.text}
          </p>
          <div className="guide-github-actions">
            {(failed || (includePrivate && !authorized)) &&
              status?.privateAvailable &&
              !cleaning && (
                <Button
                  size="s"
                  data-github-action="authorize"
                  disabled={inactive || busy}
                  onClick={() => void authorize()}
                >
                  {failed ? "Authorize again" : "Authorize private activity"}
                </Button>
              )}
            {(failed || (includePrivate && !authorized)) && (
              <Button
                size="s"
                kind="ghost"
                data-github-action="public-only"
                disabled={inactive || busy}
                onClick={() =>
                  void act(async () => {
                    await choosePublicOnly();
                    setPrivate(false);
                  })
                }
              >
                Use public activity only
              </Button>
            )}
            {authorized &&
              (confirmWithdraw ? (
                <>
                  <Button
                    size="s"
                    kind="danger"
                    data-github-action="withdraw"
                    disabled={inactive || busy}
                    onClick={() =>
                      void act(async () => {
                        await withdrawGraphAccess();
                        setPrivate(false);
                        setConfirmWithdraw(false);
                      })
                    }
                  >
                    Remove private access now
                  </Button>
                  <Button
                    size="s"
                    kind="ghost"
                    disabled={busy}
                    onClick={() => setConfirmWithdraw(false)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="s"
                  kind="ghost"
                  data-github-action="remove-access"
                  disabled={inactive || busy}
                  onClick={() => setConfirmWithdraw(true)}
                >
                  Remove private access
                </Button>
              ))}
          </div>
        </div>
      )}
      {graph && (
        <Button
          size="s"
          kind="ghost"
          icon="trash"
          className="guide-github-remove"
          disabled={inactive || busy}
          onClick={() => setRemoving(true)}
        >
          Remove graph
        </Button>
      )}
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Include private contributions?"
        width={460}
      >
        <ul className="guide-shared" aria-label="What visitors see">
          <li>
            <Icon name="eye" size={18} />
            <span>Daily contribution counts</span>
            <StatusPill status="live">Shown</StatusPill>
          </li>
          <li>
            <Icon name="eye-off" size={18} />
            <span>Repository names and code</span>
            <StatusPill status="draft">Hidden</StatusPill>
          </li>
        </ul>
        <div className="guide-dialog-actions">
          <Button onClick={() => setAsking(false)}>Cancel</Button>
          <Button
            kind="primary"
            icon="github"
            disabled={inactive || busy}
            onClick={() => {
              setAsking(false);
              void authorize();
            }}
          >
            Continue to GitHub
          </Button>
        </div>
      </Dialog>
      {graph && removing && (
        <ComponentRemovalDialog
          title="GitHub activity"
          disabled={inactive}
          withdrawal
          onCancel={() => setRemoving(false)}
          onRemove={async () => {
            // Private access goes first, at once and without Publish. A
            // failure keeps the graph so nothing claims a removal.
            await withdrawGraphAccess();
            if (
              !removeEditorComponent(controller, graph.id, {
                accessWithdrawn: true,
              })
            )
              return;
            setRemoving(false);
            setTyped("");
            onStatus(null);
          }}
        />
      )}
    </section>
  );
}

// The graph preview: one column per week, darker for busier days.
function Calendar({ days }: { days: { date: string; count: number }[] }) {
  const recent = days.slice(-53 * 7);
  const max = Math.max(1, ...recent.map((day) => day.count));
  return (
    <div className="guide-calendar" aria-hidden="true">
      {recent.map((day) => (
        <span
          key={day.date}
          data-level={day.count === 0 ? 0 : Math.ceil((day.count / max) * 4)}
        />
      ))}
    </div>
  );
}
