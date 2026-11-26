"use client";

import { useId, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { setGitHubAccount } from "../lib/editor/github-graph";
import { LOGIN, useGitHubGraph } from "./use-github-graph";

// The editor's graph section. The owner's GitHub sign-in connects on its
// own, with public and private activity. Another account is chosen by
// username and authorized on GitHub, where the owner signs in to it. The
// draft records the account; authorization and removal of access act at
// once, while the graph goes live with Publish.
export function GitHubSetupPanel({
  savedUsername,
  inactive,
  onAccount,
  beforeConsent,
}: {
  savedUsername: string;
  inactive: boolean;
  onAccount(username: string): void;
  beforeConsent(): Promise<boolean>;
}) {
  const id = useId();
  const [choosing, setChoosing] = useState(false);
  const [typed, setTyped] = useState("");
  const graph = useGitHubGraph({
    draftUsername: savedUsername,
    autoConnect: true,
    returnTo: "editor",
    beforeConsent,
    onSelected: onAccount,
    onConnected: onAccount,
  });
  const { status, account, busy } = graph;
  const off = inactive || busy;
  const privateState = status?.private.state ?? "off";
  const canAuthorize =
    !!account &&
    !graph.connected &&
    ["off", "consent_failed", "reconnect", "authorizing"].includes(
      privateState,
    );
  const canRetry =
    !!account && ["ready", "pending", "error"].includes(privateState);
  // Without an account, a GitHub sign-in offers itself first.
  const offerSignIn =
    !account && !!status?.githubSignIn && !choosing && status.privateAvailable;
  const askUsername = choosing || (!!status && !account && !offerSignIn);
  const candidate = typed.trim();
  return (
    <section
      aria-label="GitHub activity controls"
      className="github-controls"
      data-github-controls=""
      data-github-state={
        graph.connected ? "connected" : account ? "unfinished" : "none"
      }
    >
      <h2>GitHub activity</h2>
      {account && (
        <p data-publication-field="username">
          <a
            href={account.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{account.username}
          </a>
        </p>
      )}
      <p
        className="editor-muted"
        id={`${id}-status`}
        role="status"
        data-github-status={busy && !account ? "connecting" : privateState}
      >
        {busy && !account ? "Connecting to GitHub..." : graph.summary.text}
      </p>
      {graph.problem && (
        <p className="editor-input-note" role="alert">
          {graph.problem}
        </p>
      )}
      <div className="github-actions">
        {offerSignIn && (
          <button
            type="button"
            data-github-action="connect"
            disabled={off}
            onClick={() => void graph.connectSignIn()}
          >
            Connect GitHub
          </button>
        )}
        {canAuthorize && (
          <button
            type="button"
            data-github-action="authorize"
            disabled={off}
            onClick={() => void graph.authorize()}
          >
            {privateState === "off" ? "Authorize on GitHub" : "Authorize again"}
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            data-github-action={graph.connected ? "refresh" : "retry"}
            disabled={off}
            onClick={() => void graph.retry()}
          >
            {graph.connected ? "Refresh activity" : "Retry"}
          </button>
        )}
        {!askUsername && status && (
          <button
            type="button"
            data-github-action="other-account"
            disabled={off}
            onClick={() => setChoosing(true)}
          >
            Use another account
          </button>
        )}
      </div>
      {askUsername && (
        <form
          className="editor-field"
          onSubmit={(event) => {
            event.preventDefault();
            void graph.connectAccount(candidate);
          }}
        >
          <label htmlFor={id}>GitHub username</label>
          <input
            id={id}
            value={typed}
            disabled={off}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={39}
            aria-describedby={`${id}-status`}
            onChange={(event) => {
              setTyped(event.target.value);
              graph.setProblem("");
            }}
          />
          <div className="github-actions">
            <button
              type="submit"
              data-github-action="continue"
              disabled={off || !LOGIN.test(candidate)}
            >
              {busy ? "Working..." : "Continue on GitHub"}
            </button>
            {status?.githubSignIn && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setChoosing(false);
                  setTyped("");
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

// The editor section: records the selected account in the draft component.
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
      onAccount={(username) =>
        setGitHubAccount(controller, componentId, username)
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
