"use client";

import { useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { removeEditorComponent } from "../lib/editor/components";
import {
  type GraphSetupStatus,
  setGitHubPrivate,
  withdrawGraphAccess,
} from "../lib/editor/github-graph";
import { acceptGraph, findGraph } from "../lib/guide/github";
import { GitHubSetupPanel } from "./github-controls";
import { ComponentRemovalDialog } from "./section-removal-dialog";

// The optional GitHub screen. Nothing is added until the owner chooses Add
// graph and the server accepts a username; the editor's setup panel then does
// the rest (public fetch, Retry, private consent, Public only, Remove private
// access). Consent returns to this saved step. Remove graph withdraws private
// access first, exactly as in the editor.
export function GuideGitHub({
  controller,
  disabled,
  adding,
  onAdding,
  onStatus,
  beforeConsent,
}: {
  controller: DraftController;
  disabled: boolean;
  // Add graph was chosen, but no account has been accepted yet.
  adding: boolean;
  onAdding(adding: boolean): void;
  onStatus(status: GraphSetupStatus | null): void;
  beforeConsent(): Promise<boolean>;
}) {
  const state = useStore(controller.store);
  const graph = findGraph(state.working);
  const [removing, setRemoving] = useState(false);
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  if (!graph && !adding)
    return (
      <div className="guide-github" data-guide-github="none">
        <div className="guide-note">
          <p>Optional</p>
          <p>
            Add a contribution graph from any public GitHub account. You don't
            need to sign in with GitHub. You can also show private contributions
            as anonymized counts after you authorize them.
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          disabled={inactive}
          onClick={() => onAdding(true)}
        >
          Add graph
        </button>
      </div>
    );
  return (
    <div
      className="guide-github"
      data-guide-github={graph ? "added" : "adding"}
    >
      <GitHubSetupPanel
        savedUsername={graph?.data.username ?? ""}
        includePrivate={graph?.data.includePrivate ?? false}
        inactive={inactive}
        returnTo="setup"
        onStatus={onStatus}
        onAccepted={(username) => acceptGraph(controller, username)}
        onPrivateChange={(value) => {
          const current = findGraph(controller.store.getState().working);
          if (current) setGitHubPrivate(controller, current.id, value);
        }}
        beforeConsent={beforeConsent}
      />
      {graph ? (
        <button
          type="button"
          className="ghost-button"
          disabled={inactive}
          onClick={() => setRemoving(true)}
        >
          Remove graph
        </button>
      ) : (
        <button
          type="button"
          className="ghost-button"
          disabled={inactive}
          onClick={() => {
            onAdding(false);
            onStatus(null);
          }}
        >
          Don't add a graph
        </button>
      )}
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
            onAdding(false);
            onStatus(null);
          }}
        />
      )}
    </div>
  );
}
