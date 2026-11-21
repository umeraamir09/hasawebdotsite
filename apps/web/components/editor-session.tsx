"use client";

import type {
  PreviewIdentity,
  PreviewSelection,
} from "@hasaweb/components/browser";
import type { PublicationIssue } from "@hasaweb/schema";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { watchAccountDeletion } from "../lib/account-deletion";
import { createDraftController } from "../lib/draft/controller";
import { getAt } from "../lib/draft/planner";
import {
  createRecoveryCoordinator,
  type RecoveryCoordinator,
} from "../lib/draft/recovery-coordinator";
import type { FieldPath } from "../lib/draft/types";
import { LINK_RETURN_PARAM, linkReturnNotice } from "../lib/sign-in-methods";
import { AccountDeleted, AccountDeletion } from "./account-deletion";
import { AddressControl } from "./address-control";
import { AppearanceControls } from "./appearance-controls";
import { Brand } from "./brand";
import { ComponentControls } from "./component-controls";
import { DraftRecovery } from "./draft-recovery";
import { EditorFields } from "./editor-fields";
import { EditorPreview } from "./editor-preview";
import {
  PublicationChecklist,
  PublicationCorrection,
} from "./publication-checklist";
import { SharingControls } from "./sharing-controls";
import { SignInMethods } from "./sign-in-methods";
import "./editor.css";

export function EditorSession(props: {
  owner: PreviewIdentity;
  previewDocument: string;
  onReady?(recovery: RecoveryCoordinator): void;
  // The activated `/editor` route supplies sign-out; fixtures omit it.
  onSignOut?: () => Promise<void>;
}) {
  return <Session key={JSON.stringify(props.owner)} {...props} />;
}
function Session({
  owner,
  previewDocument,
  onReady,
  onSignOut,
}: Parameters<typeof EditorSession>[0]) {
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const [scope] = useState(owner);
  const [recovery, setRecovery] = useState<RecoveryCoordinator | null>(null);
  const [deleted, setDeleted] = useState<"here" | "elsewhere" | null>(null);
  useEffect(() => {
    let active = true;
    const options = { ...scope, context: "content" as const };
    const controller = createDraftController(options);
    const coordinator = createRecoveryCoordinator({ ...options, controller });
    setRecovery(coordinator);
    void controller
      .initialize()
      .catch(() => {})
      .finally(() => {
        if (active) readyCallback.current?.(coordinator);
      });
    // Phase 49: another tab deleted this account. Stop writing at once; the
    // owner tombstone refuses anything still in flight.
    const stopWatching = watchAccountDeletion(scope.ownerId, () => {
      void coordinator.dispose();
      setDeleted((current) => current ?? "elsewhere");
    });
    return () => {
      active = false;
      stopWatching();
      void coordinator.dispose();
    };
  }, [scope]);
  if (deleted) return <AccountDeleted elsewhere={deleted === "elsewhere"} />;
  if (!recovery)
    return <main className="editor-entry">Opening your editor...</main>;
  return (
    <Workspace
      recovery={recovery}
      owner={scope}
      previewDocument={previewDocument}
      onSignOut={onSignOut}
      onDeleted={() => setDeleted("here")}
    />
  );
}
type ScopeProps = {
  recovery: RecoveryCoordinator;
  owner: PreviewIdentity;
  previewDocument: string;
  onSignOut?: (() => Promise<void>) | undefined;
  onDeleted(): void;
};
function Workspace(props: ScopeProps) {
  const recoveryState = useStore(props.recovery.store);
  return <Scope key={recoveryState.controller.scopeKey} {...props} />;
}
function Scope({
  recovery,
  owner,
  previewDocument,
  onSignOut,
  onDeleted,
}: ScopeProps) {
  const recoveryState = useStore(recovery.store);
  const controller = recoveryState.controller;
  const state = useStore(controller.store);
  const [selection, setSelection] = useState<PreviewSelection>({
    kind: "profile",
  });
  // Connecting a sign-in method returns to `/editor?account=…`. Show its
  // outcome in the settings panel and drop the parameters from the URL.
  const [linkNotice] = useState(() =>
    typeof location === "undefined" ? null : linkReturnNotice(location.search),
  );
  useEffect(() => {
    if (!linkNotice) return;
    const url = new URL(location.href);
    url.searchParams.delete(LINK_RETURN_PARAM);
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    history.replaceState(history.state, "", url);
  }, [linkNotice]);
  const [panel, setPanel] = useState<"content" | "customization" | "sharing">(
    linkNotice ? "sharing" : "content",
  );
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [correction, setCorrection] = useState<{
    issue: PublicationIssue;
    componentId: string | null;
    target: FieldPath;
  } | null>(null);
  const [publicationKey, setPublicationKey] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  async function signOut() {
    if (!onSignOut || signingOut) return;
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
  const draft = state.working;
  const active: PreviewSelection =
    selection.kind === "component" &&
    !draft?.components.some((component) => component.id === selection.id)
      ? { kind: "profile" }
      : selection;
  const disabled =
    state.suspended ||
    Boolean(recoveryState.review) ||
    recoveryState.busy ||
    !draft ||
    state.error === "owner_changed";
  const choose = (value: PreviewSelection) => {
    if (
      value.kind === "component" &&
      !controller.store
        .getState()
        .working?.components.some((component) => component.id === value.id)
    )
      return;
    setSelection(value);
    setPanel("content");
    setView("edit");
  };
  // GitHub consent returns to `/editor?github=consent`. Open the graph section
  // once the draft is loaded; its status route reports the persisted outcome.
  const consentReturn = useRef(
    typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("github") === "consent",
  );
  useEffect(() => {
    if (!consentReturn.current || !draft) return;
    consentReturn.current = false;
    const url = new URL(location.href);
    url.searchParams.delete("github");
    history.replaceState(history.state, "", url);
    const graph = draft.components.find((item) => item.type === "github");
    if (graph) {
      setSelection({ kind: "component", id: graph.id });
      setPanel("content");
      setView("edit");
    }
  }, [draft]);
  return (
    <main
      className={`owner-editor editor-view-${view}`}
      data-editor-scope={controller.scopeKey}
    >
      <header className="editor-header">
        <Brand />
        <span>Your editor</span>
        <span className="editor-private">Private draft</span>
        {onSignOut && (
          <button
            type="button"
            className="editor-sign-out"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        )}
      </header>
      {signOutError && (
        <p className="editor-sign-out-error" role="alert">
          {signOutError}
        </p>
      )}
      <nav className="editor-mobile-view" aria-label="Editor view">
        <button
          type="button"
          aria-pressed={view === "edit"}
          onClick={() => setView("edit")}
        >
          Edit content
        </button>
        <button
          type="button"
          aria-pressed={view === "preview"}
          onClick={() => setView("preview")}
        >
          View preview
        </button>
      </nav>
      <div className="editor-workspace">
        <aside className="editor-controls">
          <fieldset className="editor-tabs" aria-label="Editor panels">
            <button
              type="button"
              aria-pressed={panel === "content"}
              onClick={() => setPanel("content")}
            >
              Content
            </button>
            <button
              type="button"
              aria-pressed={panel === "customization"}
              onClick={() => setPanel("customization")}
            >
              Customization
            </button>
            <button
              type="button"
              aria-pressed={panel === "sharing"}
              onClick={() => setPanel("sharing")}
            >
              Sharing
            </button>
          </fieldset>
          <PublicationChecklist
            controller={controller}
            disabled={disabled}
            onPublished={() => setPublicationKey(crypto.randomUUID())}
            onOpen={(issue) => {
              setPanel(issue.path[0] === "seo" ? "sharing" : "content");
              setView("edit");
              const index =
                issue.path[0] === "components" &&
                typeof issue.path[1] === "number"
                  ? issue.path[1]
                  : null;
              const component =
                index === null ? undefined : draft?.components[index];
              setSelection(
                component
                  ? { kind: "component", id: component.id }
                  : { kind: "profile" },
              );
              if (
                issue.code === "catalog" ||
                component ||
                issue.path[1] === "faceReveal" ||
                issue.path[0] === "seo"
              )
                setCorrection({
                  issue,
                  componentId: component?.id ?? null,
                  target: issue.path.map((part, position) => {
                    const value =
                      typeof part === "number"
                        ? getAt(draft, issue.path.slice(0, position + 1))
                        : undefined;
                    return value &&
                      typeof value === "object" &&
                      "id" in value &&
                      typeof value.id === "string"
                      ? { id: value.id }
                      : part;
                  }),
                });
              else {
                setCorrection(null);
                requestAnimationFrame(() => {
                  const key =
                    issue.path[0] === "requestedSubdomain"
                      ? "address"
                      : issue.path[0] === "links"
                        ? "links"
                        : String(issue.path[1]);
                  const control = document.querySelector<HTMLElement>(
                    `[data-publication-field="${key}"]`,
                  );
                  control?.scrollIntoView({ block: "center" });
                  (
                    control?.querySelector<HTMLElement>(
                      "input,textarea,button",
                    ) ?? control
                  )?.focus();
                });
              }
            }}
          />
          {correction && (
            <PublicationCorrection
              controller={controller}
              key={JSON.stringify(correction)}
              issue={correction.issue}
              componentId={correction.componentId}
              target={correction.target}
              disabled={disabled}
              onClose={() => setCorrection(null)}
            />
          )}
          {panel === "content" ? (
            <>
              <ComponentControls
                controller={controller}
                selection={active}
                disabled={disabled}
                onSelect={choose}
              />
              <AddressControl
                controller={controller}
                disabled={disabled}
                key={publicationKey}
              />
              <EditorFields
                controller={controller}
                selection={active}
                disabled={disabled}
                publicationKey={publicationKey}
              />
            </>
          ) : panel === "customization" ? (
            <AppearanceControls controller={controller} disabled={disabled} />
          ) : (
            <>
              <SharingControls controller={controller} disabled={disabled} />
              <SignInMethods
                controller={controller}
                disabled={disabled}
                initialNotice={linkNotice}
              />
              <AccountDeletion
                controller={controller}
                recovery={recovery}
                disabled={disabled}
                onDeleted={onDeleted}
              />
            </>
          )}
          <DraftRecovery recovery={recovery} />
        </aside>
        {draft &&
          !["unauthorized", "owner_changed"].includes(state.error ?? "") && (
            <EditorPreview
              owner={owner}
              draft={draft}
              documentUrl={previewDocument}
              selection={active}
              onSelect={choose}
            />
          )}
      </div>
    </main>
  );
}
