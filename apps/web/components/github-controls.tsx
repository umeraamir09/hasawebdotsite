"use client";

import { useId } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { setGitHubAccount } from "../lib/editor/github-graph";
import { useGitHubGraph } from "./use-github-graph";

// The editor's graph section. The owner's GitHub sign-in connects on its
// own, with public and private activity. Connect GitHub links that sign-in
// when missing, or authorizes it when the stored token cannot be used. The
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
  // Offer Connect whenever the graph is not live: link GitHub if missing,
  // connect the sign-in token, or replace a stale selected account after
  // the owner switches GitHub sign-in.
  const canConnect = !graph.connected && !!status && status.privateAvailable;
  const canAuthorize =
    !!account &&
    !graph.connected &&
    ["off", "consent_failed", "reconnect", "authorizing"].includes(
      privateState,
    );
  const canRetry =
    !!account && ["ready", "pending", "error"].includes(privateState);
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
        {canConnect && (
          <button
            type="button"
            data-github-action="connect"
            disabled={off}
            onClick={() => void graph.connectGitHub()}
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
      </div>
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
