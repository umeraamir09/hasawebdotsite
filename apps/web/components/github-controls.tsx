"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import {
  detectGraphUsername,
  GraphSetupError,
  type GraphSetupFailure,
  type GraphSetupStatus,
  readGraphStatus,
  retryGraph,
  setGitHubUsername,
  setupGraph,
} from "../lib/editor/github-graph";

const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const failures: Record<GraphSetupFailure, string> = {
  invalid_username:
    "Enter a GitHub username: letters, numbers and single hyphens, up to 39 characters.",
  not_found: "GitHub has no account with that username. Check the spelling.",
  unavailable: "GitHub couldn't be reached. Your draft is unchanged. Retry.",
  misconfigured:
    "GitHub returned a response we can't use right now. Try again later.",
  too_soon: "Wait a few seconds, then try again.",
  conflict: "Your graph changed in another tab. Reload the editor and retry.",
  no_graph: "Enter a username first.",
  no_portfolio: "Open your portfolio before setting up a graph.",
  invalid_input: "Enter a GitHub username.",
};

export function describeGraph(
  status: GraphSetupStatus | null,
  draftUsername: string,
): { text: string; ok: boolean } {
  if (!status) return { text: "Checking your graph...", ok: false };
  const { connection } = status;
  if (!connection)
    return {
      text: "Not set up. Enter a username and fetch your activity. Publishing needs a successful fetch.",
      ok: false,
    };
  if (
    !draftUsername ||
    connection.username.toLowerCase() !== draftUsername.toLowerCase()
  )
    return {
      text: draftUsername
        ? `Fetch activity for @${draftUsername}. Publishing needs a successful fetch.`
        : "Fetch your activity to finish setup. Publishing needs a successful fetch.",
      ok: false,
    };
  const state = status.public;
  if (state.state === "ready") {
    const date = state.fetchedAt.slice(0, 10);
    const count =
      state.total === 0
        ? "No public contributions in the last year. That is a valid graph."
        : `${state.total} public ${state.total === 1 ? "contribution" : "contributions"} in the last year.`;
    return {
      text: state.lastError
        ? `Couldn't refresh GitHub. Showing the graph from ${date}. ${count} Retry.`
        : `Connected. Fetched ${date}. ${count}`,
      ok: true,
    };
  }
  if (state.state === "restricted")
    return {
      text: "Your GitHub profile shows private contributions, so a public graph can't be built from public data. In GitHub, turn off “Include private contributions on my profile”, then Retry. Publishing is blocked until a fetch succeeds.",
      ok: false,
    };
  if (state.state === "error")
    return {
      text:
        state.kind === "retry"
          ? "GitHub couldn't be reached. Your draft is unchanged. Retry. Publishing is blocked until a fetch succeeds."
          : "GitHub returned a response we can't use right now. Try again later. Publishing is blocked until a fetch succeeds.",
      ok: false,
    };
  return {
    text: "The first fetch hasn't finished. Retry. Publishing is blocked until a fetch succeeds.",
    ok: false,
  };
}

// Public graph setup, independent of where it is shown. The editor and the
// Phase 42D onboarding step both render this panel. A username (detected or
// typed) is fetched through the owner-only public setup route, and
// `onAccepted` receives the canonical username only after the server accepted
// it, so a failed fetch never leaves a draft naming an unknown account.
export function GitHubSetupPanel({
  savedUsername: saved,
  inactive,
  onAccepted,
}: {
  savedUsername: string;
  inactive: boolean;
  onAccepted(username: string): void;
}) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const [status, setStatus] = useState<GraphSetupStatus | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const alive = useRef(true);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
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
  const value = typed ?? (saved || status?.connection?.username || "");
  const candidate = value.trim();
  const profile = LOGIN.test(candidate)
    ? `https://github.com/${candidate}`
    : null;
  const summary = describeGraph(status, saved);

  async function run(action: () => Promise<GraphSetupStatus>) {
    setBusy(true);
    setProblem("");
    try {
      const next = await action();
      if (!alive.current) return;
      setStatus(next);
      // Even a failed first fetch keeps the selection, so Retry needs no retyping.
      if (next.connection) {
        onAccepted(next.connection.username);
        setTyped(null);
        setSuggestion(null);
      }
    } catch (cause) {
      if (alive.current)
        setProblem(
          failures[
            cause instanceof GraphSetupError ? cause.code : "unavailable"
          ],
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const needsFetch =
    !status?.connection ||
    status.connection.username.toLowerCase() !== saved.toLowerCase() ||
    candidate.toLowerCase() !== status.connection.username.toLowerCase();
  const healthy = summary.ok && !needsFetch;
  return (
    <section
      aria-label="GitHub activity controls"
      className="github-controls"
      data-github-controls=""
    >
      <h2>GitHub activity</h2>
      <p className="editor-muted">
        Shows your public GitHub contribution graph on your portfolio. It uses
        public activity only.
      </p>
      <div className="editor-field" data-publication-field="username">
        <label htmlFor={id}>GitHub username</label>
        <input
          id={id}
          ref={field}
          value={value}
          disabled={inactive || busy}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={39}
          aria-describedby={`${id}-status`}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
      {suggestion &&
        !saved &&
        candidate.toLowerCase() !== suggestion.toLowerCase() && (
          <p className="editor-muted">
            We detected <strong>@{suggestion}</strong> from your GitHub sign-in.{" "}
            <button
              type="button"
              disabled={inactive || busy}
              onClick={() => {
                setTyped(suggestion);
                field.current?.focus();
              }}
            >
              Use @{suggestion}
            </button>
          </p>
        )}
      {profile && (
        <p>
          <a href={profile} target="_blank" rel="noopener noreferrer">
            View @{candidate} on GitHub
          </a>
        </p>
      )}
      <p
        className="editor-muted"
        id={`${id}-status`}
        role="status"
        data-github-status={status?.public.state ?? "loading"}
      >
        {summary.text}
      </p>
      {problem && (
        <p className="editor-input-note" role="alert">
          {problem}
        </p>
      )}
      <button
        type="button"
        data-github-action={
          needsFetch ? "fetch" : healthy ? "refresh" : "retry"
        }
        disabled={inactive || busy || !LOGIN.test(candidate)}
        onClick={() =>
          run(() => (needsFetch ? setupGraph(candidate) : retryGraph()))
        }
      >
        {busy
          ? "Fetching..."
          : needsFetch
            ? "Fetch activity"
            : healthy
              ? "Refresh activity"
              : "Retry"}
      </button>
      <p className="editor-muted">
        Changes go live when you publish. Private activity can't be added yet.
      </p>
    </section>
  );
}

// The editor section: records the accepted account in the draft component.
export function GitHubControls({
  controller,
  componentId,
  disabled,
}: {
  controller: DraftController;
  componentId: string;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const component = state.working?.components.find(
    (item) => item.id === componentId,
  );
  if (component?.type !== "github") return null;
  return (
    <GitHubSetupPanel
      savedUsername={component.data.username}
      inactive={disabled || state.suspended || state.error === "owner_changed"}
      onAccepted={(username) =>
        setGitHubUsername(controller, componentId, username)
      }
    />
  );
}
