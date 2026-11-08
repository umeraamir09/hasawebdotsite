"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import {
  choosePublicOnly,
  detectGraphUsername,
  type GraphPrivateState,
  GraphSetupError,
  type GraphSetupFailure,
  type GraphSetupStatus,
  readGraphStatus,
  retryGraph,
  setGitHubPrivate,
  setGitHubUsername,
  setupGraph,
  startPrivateConsent,
  withdrawGraphAccess,
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
  already_authorized: "Private activity is already authorized.",
  consent_busy:
    "Earlier private access for this GitHub account is still being removed. Try again in a minute. Public activity works meanwhile.",
  private_unavailable:
    "Private activity isn't available right now. Your public graph still works.",
};

const consentFailures: Record<
  Extract<GraphPrivateState, { state: "consent_failed" }>["reason"],
  string
> = {
  cancelled: "Authorization was cancelled.",
  wrong_account:
    "GitHub authorized a different account, so nothing changed. Sign in to GitHub as the account above, then authorize again.",
  scope: "GitHub didn't grant the requested permission.",
  failed: "Authorization didn't finish.",
  expired: "The authorization link expired.",
  interrupted: "Authorization didn't finish.",
};

/**
 * The private-activity status line. `includePrivate` is the draft's choice;
 * the state is the server's. Publication needs both to agree.
 */
export function describePrivate(
  state: GraphPrivateState,
  includePrivate: boolean,
): { text: string; ok: boolean } {
  const blocked = includePrivate
    ? " Publishing is blocked until you authorize or use public activity only."
    : "";
  switch (state.state) {
    case "ready": {
      const date = state.fetchedAt.slice(0, 10);
      const count = `${state.total} ${state.total === 1 ? "contribution" : "contributions"} in the last year, including private ones.`;
      if (!includePrivate)
        return {
          text: "Private access is authorized but not shown. Turn it on to include private counts, or remove access.",
          ok: true,
        };
      return {
        text: state.lastError
          ? `Couldn't refresh private activity. Showing counts from ${date}. ${count} Retry.`
          : `Private activity authorized. Fetched ${date}. ${count}`,
        ok: true,
      };
    }
    case "pending":
      return {
        text: "Private access is authorized. The first private fetch hasn't finished. Retry.",
        ok: false,
      };
    case "error":
      return {
        text:
          state.kind === "retry"
            ? "Private access is authorized, but GitHub couldn't be reached. Retry."
            : "GitHub returned private activity we can't use right now. Try again later.",
        ok: false,
      };
    case "authorizing":
      return {
        text: `Waiting for GitHub authorization. If you closed that page, authorize again.${blocked}`,
        ok: false,
      };
    case "consent_failed":
      return {
        text: `${consentFailures[state.reason]} Your public graph is unchanged. Authorize again, or use public activity only.${includePrivate ? " Publishing is blocked until then." : ""}`,
        ok: false,
      };
    case "reconnect":
      return {
        text: `GitHub no longer allows private access, so private counts were removed. Authorize again, or use public activity only.${includePrivate ? " Publishing is blocked until then." : ""}`,
        ok: false,
      };
    case "cleanup":
      return {
        text: `Earlier private access is still being removed at GitHub. You can authorize again after that. Public activity works meanwhile.${blocked}`,
        ok: false,
      };
    default:
      return {
        text: includePrivate
          ? `Authorize the username above to show private counts.${blocked}`
          : "Off. Only public contributions are shown.",
        ok: false,
      };
  }
}

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

// Graph setup, independent of where it is shown. The editor and the Phase 42D
// onboarding step both render this panel. A username (detected or typed) is
// fetched through the owner-only setup route, and `onAccepted` receives the
// canonical username only after the server accepted it, so a failed fetch
// never leaves a draft naming an unknown account. Private activity uses the
// separate activity app: the draft's `includePrivate` choice goes live with
// Publish, while authorization and removal of access act at once.
export function GitHubSetupPanel({
  savedUsername: saved,
  includePrivate,
  inactive,
  onAccepted,
  onPrivateChange,
  beforeConsent,
}: {
  savedUsername: string;
  includePrivate: boolean;
  inactive: boolean;
  onAccepted(username: string): void;
  onPrivateChange(includePrivate: boolean): void;
  // Saves the draft before leaving for GitHub. False keeps the owner here.
  beforeConsent(): Promise<boolean>;
}) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const [status, setStatus] = useState<GraphSetupStatus | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [confirmRemoval, setConfirmRemoval] = useState(false);
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
  // Private actions report through the refreshed status.
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setProblem("");
    try {
      await action();
      const next = await readGraphStatus();
      if (alive.current) setStatus(next);
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
  async function authorize() {
    setBusy(true);
    setProblem("");
    try {
      if (!includePrivate) onPrivateChange(true);
      if (!(await beforeConsent())) {
        if (alive.current) {
          setProblem(
            "Your draft couldn't be saved, so authorization didn't start. Retry.",
          );
          setBusy(false);
        }
        return;
      }
      const url = await startPrivateConsent();
      // Same tab: GitHub returns to the editor, which reopens this section.
      location.assign(url);
    } catch (cause) {
      if (alive.current) {
        setProblem(
          failures[
            cause instanceof GraphSetupError ? cause.code : "unavailable"
          ],
        );
        setBusy(false);
      }
    }
  }
  const needsFetch =
    !status?.connection ||
    status.connection.username.toLowerCase() !== saved.toLowerCase() ||
    candidate.toLowerCase() !== status.connection.username.toLowerCase();
  const healthy = summary.ok && !needsFetch;
  const privateState = status?.private ?? { state: "off" as const };
  const authorized = ["ready", "pending", "error"].includes(privateState.state);
  const privateSummary = describePrivate(privateState, includePrivate);
  const canAuthorize =
    !!status?.privateAvailable &&
    !needsFetch &&
    !authorized &&
    privateState.state !== "cleanup";
  const failed = ["consent_failed", "reconnect", "authorizing"].includes(
    privateState.state,
  );
  return (
    <section
      aria-label="GitHub activity controls"
      className="github-controls"
      data-github-controls=""
    >
      <h2>GitHub activity</h2>
      <p className="editor-muted">
        Shows your GitHub contribution graph on your portfolio.
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
          ? "Working..."
          : needsFetch
            ? "Fetch activity"
            : healthy
              ? "Refresh activity"
              : "Retry"}
      </button>
      <fieldset
        className="github-private"
        data-publication-field="includePrivate"
        data-github-private={privateState.state}
      >
        <legend>Private activity</legend>
        <label className="appearance-choice">
          <input
            type="checkbox"
            role="switch"
            aria-checked={includePrivate}
            checked={includePrivate}
            disabled={inactive || busy || !status?.connection}
            aria-describedby={`${id}-private-note ${id}-private-status`}
            onChange={(event) => onPrivateChange(event.target.checked)}
          />
          Include private activity{" "}
          <span className="editor-muted">Optional</span>
        </label>
        <p className="editor-muted" id={`${id}-private-note`}>
          Visitors will see anonymized contribution counts, including private
          ones. Repository names, code and contribution details stay private.
        </p>
        <p
          className="editor-muted"
          id={`${id}-private-status`}
          role="status"
          data-github-private-status={privateState.state}
        >
          {status && !status.privateAvailable && !authorized
            ? "Private activity isn't available right now. Your public graph still works."
            : privateSummary.text}
        </p>
        {(includePrivate || failed) && canAuthorize && (
          <button
            type="button"
            data-github-action="authorize"
            disabled={inactive || busy}
            onClick={authorize}
          >
            {failed ? "Authorize again" : "Authorize private activity"}
          </button>
        )}
        {(failed || (includePrivate && !authorized)) && (
          <button
            type="button"
            data-github-action="public-only"
            disabled={inactive || busy}
            onClick={() =>
              act(async () => {
                await choosePublicOnly();
                onPrivateChange(false);
              })
            }
          >
            Use public activity only
          </button>
        )}
        {authorized &&
          (confirmRemoval ? (
            <fieldset aria-label="Confirm removing private access">
              <p>
                Private counts disappear from your live portfolio now, without
                publishing, and access is revoked at GitHub. Your public graph
                and GitHub sign-in stay.
              </p>
              <button
                type="button"
                data-github-action="withdraw"
                disabled={inactive || busy}
                onClick={() =>
                  act(async () => {
                    await withdrawGraphAccess();
                    onPrivateChange(false);
                    setConfirmRemoval(false);
                  })
                }
              >
                Remove private access now
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmRemoval(false)}
              >
                Cancel
              </button>
            </fieldset>
          ) : (
            <button
              type="button"
              data-github-action="remove-access"
              disabled={inactive || busy}
              onClick={() => setConfirmRemoval(true)}
            >
              Remove private access
            </button>
          ))}
        <p className="editor-muted">
          Authorize the username above. Changing it turns private activity off
          until you authorize the new account.
        </p>
      </fieldset>
      <p className="editor-muted">
        Changes go live when you publish. Removing private access takes effect
        at once.
      </p>
    </section>
  );
}

// The editor section: records the accepted account and the private choice in
// the draft component.
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
      includePrivate={component.data.includePrivate}
      inactive={disabled || state.suspended || state.error === "owner_changed"}
      onAccepted={(username) =>
        setGitHubUsername(controller, componentId, username)
      }
      onPrivateChange={(value) =>
        setGitHubPrivate(controller, componentId, value)
      }
      beforeConsent={async () => {
        try {
          await controller.flushValid();
          return true;
        } catch {
          return false;
        }
      }}
    />
  );
}
