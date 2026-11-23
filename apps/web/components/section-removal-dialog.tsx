"use client";

import { useEffect, useId, useRef, useState } from "react";

// Confirms removing a section from the page. The canvas actions, the mobile
// dock and Delete on an outline row all open it.
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
