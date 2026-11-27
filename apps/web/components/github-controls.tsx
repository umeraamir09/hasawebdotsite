"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { removeEditorComponent } from "../lib/editor/components";
import {
  setGitHubAccount,
  withdrawGraphAccess,
} from "../lib/editor/github-graph";
import { ComponentRemovalDialog } from "./section-removal-dialog";
import { useGitHubGraph } from "./use-github-graph";
import { Button, IconButton } from "./workbench";
import "./github-controls.css";

// The editor's graph section. A GitHub sign-in connects on its own. Connect
// GitHub is the one action before that. Once a fetch has succeeded, the
// owner can refresh, switch accounts, or disconnect. Disconnect and every
// empty or failed outcome remove the section. GitHub sign-in stays.
export function GitHubSetupPanel({
  savedUsername,
  inactive,
  onAccount,
  beforeConsent,
  onRemove,
  onDisconnect,
}: {
  savedUsername: string;
  inactive: boolean;
  onAccount(username: string): void;
  beforeConsent(): Promise<boolean>;
  onRemove(): Promise<void>;
  onDisconnect(): void;
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
  // A section with no account yet is the connect screen. A named account
  // that is not a clean successful fetch is empty or failed, including a
  // refresh that kept its last calendar. A ready server graph stays even
  // when the draft still names the previous account.
  const serverReady =
    status?.private.state === "ready" &&
    !status.private.lastError &&
    !!status.connection;
  const starting = !!status && !graph.connected && !savedUsername && !busy;
  const shouldRemove =
    !!status && !busy && !inactive && savedUsername !== "" && !serverReady;
  const removing = useRef(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  useEffect(() => {
    if (!shouldRemove || removing.current || removeFailed) return;
    removing.current = true;
    void onRemove().catch(() => {
      removing.current = false;
      setRemoveFailed(true);
    });
  }, [onRemove, removeFailed, shouldRemove]);
  const showConnect = starting && !!status?.privateAvailable;
  return (
    <section
      aria-label="GitHub activity controls"
      className="github-controls"
      data-github-controls=""
      data-github-state={
        graph.connected ? "connected" : account ? "unfinished" : "none"
      }
    >
      {account && graph.connected && (
        <div className="github-account">
          <a
            href={account.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-publication-field="username"
          >
            @{account.username}
          </a>
          <div className="github-account-actions">
            <IconButton
              icon="refresh"
              label="Refresh activity"
              data-github-action="refresh"
              disabled={off}
              onClick={() => void graph.retry()}
            />
            <IconButton
              icon="log-out"
              label="Disconnect from graph"
              data-github-action="disconnect"
              disabled={off}
              onClick={onDisconnect}
            />
          </div>
        </div>
      )}
      {(graph.connected || starting) && (
        <p
          className="editor-muted"
          id={`${id}-status`}
          role="status"
          data-github-status={busy && !account ? "connecting" : privateState}
        >
          {busy && !account ? "Connecting to GitHub..." : graph.summary.text}
        </p>
      )}
      {graph.connected && graph.problem && (
        <p className="editor-input-note" role="alert">
          {graph.problem}
        </p>
      )}
      {removeFailed && (
        <p className="editor-input-note" role="alert">
          Private access couldn't be removed, so the section was kept.{" "}
          <button type="button" onClick={() => setRemoveFailed(false)}>
            Retry
          </button>
        </p>
      )}
      {showConnect && (
        <Button
          kind="primary"
          className="github-connect"
          icon="github"
          data-github-action="connect"
          disabled={off}
          onClick={() => void graph.connectGitHub()}
        >
          {busy ? "Connecting..." : "Connect GitHub"}
        </Button>
      )}
      {graph.connected && (
        <Button
          kind="secondary"
          size="s"
          data-github-action="switch"
          disabled={off}
          onClick={() => void graph.switchAccount()}
        >
          Use a different account
        </Button>
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
  const [confirming, setConfirming] = useState(false);
  const remove = async () => {
    await withdrawGraphAccess();
    if (
      !removeEditorComponent(controller, componentId, {
        accessWithdrawn: true,
      })
    )
      throw new Error("The section was kept");
  };
  if (component?.type !== "github") return null;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  return (
    <>
      <GitHubSetupPanel
        savedUsername={component.data.username}
        inactive={inactive}
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
        onRemove={remove}
        onDisconnect={() => setConfirming(true)}
      />
      {confirming && (
        <ComponentRemovalDialog
          title="GitHub activity"
          disabled={inactive}
          withdrawal
          onCancel={() => setConfirming(false)}
          onRemove={async () => {
            await remove();
            setConfirming(false);
          }}
        />
      )}
    </>
  );
}
