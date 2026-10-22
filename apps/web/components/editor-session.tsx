"use client";

import type {
  PreviewIdentity,
  PreviewSelection,
} from "@hasaweb/components/browser";
import { componentRegistry } from "@hasaweb/schema";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createDraftController } from "../lib/draft/controller";
import {
  createRecoveryCoordinator,
  type RecoveryCoordinator,
} from "../lib/draft/recovery-coordinator";
import { AddressControl } from "./address-control";
import { Brand } from "./brand";
import { DraftRecovery } from "./draft-recovery";
import { EditorFields } from "./editor-fields";
import { EditorPreview } from "./editor-preview";
import "./editor.css";

export function EditorSession(props: {
  owner: PreviewIdentity;
  previewDocument: string;
  onReady?(recovery: RecoveryCoordinator): void;
}) {
  return <Session key={JSON.stringify(props.owner)} {...props} />;
}
function Session({
  owner,
  previewDocument,
  onReady,
}: Parameters<typeof EditorSession>[0]) {
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const [scope] = useState(owner);
  const [recovery, setRecovery] = useState<RecoveryCoordinator | null>(null);
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
    return () => {
      active = false;
      coordinator.dispose();
    };
  }, [scope]);
  if (!recovery)
    return <main className="editor-entry">Opening your editor...</main>;
  return (
    <Workspace
      recovery={recovery}
      owner={scope}
      previewDocument={previewDocument}
    />
  );
}
function Workspace({
  recovery,
  owner,
  previewDocument,
}: {
  recovery: RecoveryCoordinator;
  owner: PreviewIdentity;
  previewDocument: string;
}) {
  const recoveryState = useStore(recovery.store);
  return (
    <Scope
      key={recoveryState.controller.scopeKey}
      recovery={recovery}
      owner={owner}
      previewDocument={previewDocument}
    />
  );
}
function Scope({
  recovery,
  owner,
  previewDocument,
}: {
  recovery: RecoveryCoordinator;
  owner: PreviewIdentity;
  previewDocument: string;
}) {
  const recoveryState = useStore(recovery.store);
  const controller = recoveryState.controller;
  const state = useStore(controller.store);
  const [selection, setSelection] = useState<PreviewSelection>({
    kind: "profile",
  });
  const [panel, setPanel] = useState<"content" | "customization">("content");
  const [view, setView] = useState<"edit" | "preview">("edit");
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
      !draft?.components.some((component) => component.id === value.id)
    )
      return;
    setSelection(value);
    setPanel("content");
    setView("edit");
  };
  return (
    <main
      className={`owner-editor editor-view-${view}`}
      data-editor-scope={controller.scopeKey}
    >
      <header className="editor-header">
        <Brand />
        <span>Your editor</span>
        <span className="editor-private">Private draft</span>
      </header>
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
          </fieldset>
          {panel === "content" ? (
            <>
              <nav
                className="editor-components"
                aria-label="Portfolio sections"
              >
                <button
                  type="button"
                  aria-current={active.kind === "profile" ? "true" : undefined}
                  onClick={() => choose({ kind: "profile" })}
                >
                  Profile
                </button>
                {draft?.components.map((component) => (
                  <button
                    key={component.id}
                    type="button"
                    aria-current={
                      active.kind === "component" && active.id === component.id
                        ? "true"
                        : undefined
                    }
                    onClick={() =>
                      choose({ kind: "component", id: component.id })
                    }
                  >
                    {componentRegistry[component.type].picker.title}
                  </button>
                ))}
              </nav>
              <AddressControl controller={controller} disabled={disabled} />
              <EditorFields
                controller={controller}
                selection={active}
                disabled={disabled}
              />
            </>
          ) : (
            <section aria-label="Customization">
              <h2>Make it yours</h2>
              <p>Your preview uses the approved Leaf palette and DM Sans.</p>
              <p className="editor-muted">
                Theme, font, custom color and decoration controls will be
                available with the appearance tools.
              </p>
            </section>
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
