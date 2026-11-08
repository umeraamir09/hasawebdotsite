"use client";

import type { PreviewSelection } from "@hasaweb/components/browser";
import { componentRegistry } from "@hasaweb/schema";
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import {
  addEditorComponent,
  moveEditorItem,
  removeEditorComponent,
} from "../lib/editor/components";
import { withdrawGraphAccess } from "../lib/editor/github-graph";
import { OrderedItems } from "./ordered-items";

export function ComponentControls({
  controller,
  selection,
  disabled,
  onSelect,
}: {
  controller: DraftController;
  selection: PreviewSelection;
  disabled: boolean;
  onSelect(value: PreviewSelection): void;
}) {
  const state = useStore(controller.store);
  const [picker, setPicker] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const root = useRef<HTMLElement>(null);
  const draft = state.working;
  if (!draft) return null;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const component = draft.components.find((item) => item.id === removing);
  function focusSelection() {
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>('[aria-current="true"]')
        ?.focus(),
    );
  }
  return (
    <section
      className="component-controls"
      aria-label="Portfolio sections"
      ref={root}
    >
      <h2>Your sections</h2>
      <p className="editor-muted">
        Profile stays first. Drag a handle or use Move up and Move down. Changes
        go live when you publish.
      </p>
      <button
        type="button"
        aria-current={selection.kind === "profile" ? "true" : undefined}
        onClick={() => onSelect({ kind: "profile" })}
      >
        Profile
      </button>
      <OrderedItems
        label="Optional sections"
        disabled={inactive}
        items={draft.components.map((item) => {
          const label =
            item.type === "text" && item.data.title
              ? item.data.title
              : componentRegistry[item.type].picker.title;
          return {
            id: item.id,
            label,
            content: (
              <>
                <button
                  type="button"
                  aria-current={
                    selection.kind === "component" && selection.id === item.id
                      ? "true"
                      : undefined
                  }
                  onClick={() => onSelect({ kind: "component", id: item.id })}
                >
                  {label}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  disabled={inactive}
                  onClick={() => setRemoving(item.id)}
                >
                  Remove
                </button>
              </>
            ),
          };
        })}
        onMove={(id, target) => moveEditorItem(controller, id, target)}
      />
      <button
        type="button"
        disabled={inactive}
        aria-expanded={picker}
        onClick={() => setPicker(!picker)}
      >
        Add component
      </button>
      {picker && (
        <section aria-label="Component picker" className="component-picker">
          <h3>Choose a component</h3>
          {Object.values(componentRegistry).map((definition) => {
            const present =
              definition.singleton &&
              draft.components.some((item) => item.type === definition.type);
            return (
              <article key={definition.type}>
                <h3>{definition.picker.title}</h3>
                <p>{definition.picker.description}</p>
                <ul>
                  {definition.picker.requirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
                <p>
                  {definition.singleton
                    ? "One per portfolio."
                    : "Add as many sections as your draft can fit."}
                </p>
                <button
                  type="button"
                  disabled={inactive || present}
                  aria-label={`Add ${definition.picker.title}`}
                  onClick={() => {
                    const id = addEditorComponent(controller, definition.type);
                    if (!id) {
                      setError(
                        "This component cannot be added. Check its instance limit or shorten the draft to make room.",
                      );
                      return;
                    }
                    setError("");
                    setPicker(false);
                    onSelect({ kind: "component", id });
                    focusSelection();
                  }}
                >
                  {present ? "Already added" : `Add ${definition.picker.title}`}
                </button>
              </article>
            );
          })}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {component && (
        <ComponentRemovalDialog
          disabled={inactive}
          withdrawal={component.type === "github"}
          onCancel={() => setRemoving(null)}
          onRemove={async () => {
            // Private access goes first, at once and without Publish. A
            // failure keeps the section so nothing claims a removal.
            if (component.type === "github") await withdrawGraphAccess();
            if (
              !removeEditorComponent(controller, component.id, {
                accessWithdrawn: component.type === "github",
              })
            )
              return;
            if (selection.kind === "component" && selection.id === component.id)
              onSelect({ kind: "profile" });
            setRemoving(null);
            focusSelection();
          }}
          title={componentRegistry[component.type].picker.title}
        />
      )}
    </section>
  );
}
export function ComponentRemovalDialog({
  title,
  disabled,
  withdrawal = false,
  onCancel,
  onRemove,
}: {
  title: string;
  disabled: boolean;
  // A GitHub graph also withdraws private activity access.
  withdrawal?: boolean;
  onCancel(): void;
  onRemove(): void | Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      className="component-removal"
      ref={dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={id}>Remove {title}?</h2>
      <p>
        This removes the section and its entered content from your draft. Your
        public site changes after Publish. Shared links are kept. This does not
        delete uploaded files.
      </p>
      {withdrawal && (
        <p>
          Removing the graph also removes private activity access now, without
          publishing: private counts disappear from your live portfolio and
          access is revoked at GitHub. Your GitHub sign-in stays connected.
        </p>
      )}
      {failed && (
        <p role="alert">
          Private access couldn't be removed, so the section was kept. Retry.
        </p>
      )}
      <div className="editor-order-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              await onRemove();
            } catch {
              setFailed(true);
              setBusy(false);
            }
          }}
        >
          {busy ? "Removing..." : "Remove section"}
        </button>
      </div>
    </dialog>
  );
}
