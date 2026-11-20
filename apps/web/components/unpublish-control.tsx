"use client";

import type { PublicationSite } from "@hasaweb/schema";
import { useEffect, useId, useRef, useState } from "react";

// Phase 48. Figma "08 / Site settings": an Unpublish block under the live
// address, with a confirmation that explains what stays and what goes.
export function UnpublishControl({
  site,
  disabled,
  onUnpublish,
}: {
  site: PublicationSite;
  disabled: boolean;
  onUnpublish(): Promise<string | null>;
}) {
  const [confirming, setConfirming] = useState(false);
  const host = site.url ? new URL(site.url).host : "your address";
  if (site.status === "unpublished")
    return (
      <div className="publication-unpublished" role="status">
        <p>
          <strong>Unpublished.</strong> Your site is offline. {host} stays
          reserved for you, and your draft is kept. Publish to restore it at the
          same address.
        </p>
        {site.withdrawal && (
          <p>
            {site.withdrawal.retrying
              ? "Removal of public files and cached copies is retrying. Visitors already can't open your site."
              : "Removing public files and cached copies..."}
          </p>
        )}
      </div>
    );
  if (site.status !== "published") return null;
  return (
    <section className="publication-unpublish" aria-labelledby="unpublish">
      <h3 id="unpublish">Unpublish</h3>
      <p>Your site goes offline. Your draft and address are kept.</p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        Unpublish website
      </button>
      {confirming && (
        <UnpublishDialog
          host={host}
          onCancel={() => setConfirming(false)}
          onConfirm={onUnpublish}
          onDone={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

function UnpublishDialog({
  host,
  onCancel,
  onConfirm,
  onDone,
}: {
  host: string;
  onCancel(): void;
  onConfirm(): Promise<string | null>;
  onDone(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
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
        if (!busy) onCancel();
      }}
    >
      <h2 id={id}>Unpublish your website?</h2>
      <p>
        Visitors will no longer be able to open {host}, its case studies, your
        resume or its images, and the contact form stops accepting messages.
        Search engines and other sites may keep old copies for a while.
      </p>
      <p>
        Your draft and your address are kept, and no one else can claim the
        address. Publish again to restore your site at {host}.
      </p>
      {failure && <p role="alert">{failure}</p>}
      <div className="editor-order-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setFailure(null);
            const error = await onConfirm();
            if (error === null) onDone();
            else {
              setFailure(error);
              setBusy(false);
            }
          }}
        >
          {busy ? "Unpublishing..." : "Confirm unpublish"}
        </button>
      </div>
    </dialog>
  );
}
