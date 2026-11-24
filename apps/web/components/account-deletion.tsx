"use client";

import type { PublicationSite } from "@hasaweb/schema";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  type DeletionResult,
  finishAccountDeletion,
  requestAccountDeletion,
} from "../lib/account-deletion";
import type { DraftController } from "../lib/draft/controller";
import { siteRequest } from "../lib/draft/publish";
import { Brand } from "./brand";

const failures: Record<Exclude<DeletionResult, "deleted">, string> = {
  signed_out:
    "Your session ended, so nothing was deleted. Sign in again to delete your account.",
  owner_changed:
    "You signed in to a different account in another tab, so nothing was deleted. Reload to continue.",
  conflict:
    "Your GitHub access changed at the same moment, so nothing was deleted. Try again.",
  failed:
    "We couldn't delete your account. Nothing was deleted. Check your connection and try again.",
};

// The account menu's Delete account opens this confirmation. Keep my account
// is the primary, focused choice; cancelling changes nothing.
export function AccountDeletionDialog({
  controller,
  recovery,
  onCancel,
  onDeleted,
}: {
  controller: DraftController;
  recovery: { dispose(): Promise<void> };
  onCancel(): void;
  onDeleted(): void;
}) {
  return (
    <DeletionDialog
      controller={controller}
      onCancel={onCancel}
      onConfirm={async () => {
        const ownerId = controller.identity.ownerId;
        const result = await requestAccountDeletion(ownerId);
        if (result !== "deleted") return failures[result];
        // The account is gone on the server. A local cleanup that cannot
        // finish here resumes from its marker on the next owner page.
        await finishAccountDeletion(ownerId, recovery).catch(() => {});
        onDeleted();
        return null;
      }}
    />
  );
}

function DeletionDialog({
  controller,
  onCancel,
  onConfirm,
}: {
  controller: DraftController;
  onCancel(): void;
  onConfirm(): Promise<string | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [site, setSite] = useState<PublicationSite | null>(null);
  // The saved address mirror names a held reservation before first Publish.
  const held =
    controller.store.getState().confirmed?.draft.requestedSubdomain ?? null;
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    keep.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    siteRequest(controller, "site")
      .then((value) => {
        if (active) setSite(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [controller]);
  const host = site?.url ? new URL(site.url).host : null;
  const published = site?.status === "published" && host;
  const claimed =
    host && (site?.status === "published" || site?.status === "unpublished");
  return (
    <dialog
      className="component-removal account-deletion-dialog"
      ref={dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 className="account-deletion-title" id={id}>
        Delete this account?
      </h2>
      <p className="account-deletion-copy">
        Permanently deletes your portfolio, draft, files and connected access.
        This cannot be undone.
      </p>
      <ul className="account-deletion-loss">
        {published && (
          <li>
            Your website at {host} goes offline now, with its case studies,
            resume and images. Search engines and other sites may keep old
            copies for a while.
          </li>
        )}
        <li>
          Your draft, uploaded images and resume, and unsaved changes kept in
          this browser are deleted.
        </li>
        <li>
          GitHub and Google sign-in and private GitHub activity access are
          removed.
        </li>
        {claimed ? (
          <li>
            {host} stays permanently unavailable. No one, including you, can use
            it again.
          </li>
        ) : held ? (
          <li>
            Your reserved address {held}.hasaweb.site is released, so someone
            else can choose it.
          </li>
        ) : null}
        <li>Signing in again later starts a new, empty account.</li>
      </ul>
      {failure && (
        <p className="editor-input-note" role="alert">
          {failure}
        </p>
      )}
      <div className="account-deletion-actions">
        <button
          type="button"
          className="account-deletion-keep"
          ref={keep}
          disabled={busy}
          onClick={onCancel}
        >
          Keep my account
        </button>
        <button
          type="button"
          className="account-deletion-confirm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setFailure(null);
            const error = await onConfirm();
            if (error !== null) {
              setFailure(error);
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting..." : "Delete permanently"}
        </button>
      </div>
    </dialog>
  );
}

/** Shown in place of the editor or guide once the account is deleted. */
export function AccountDeleted({ elsewhere }: { elsewhere: boolean }) {
  return (
    <main className="editor-entry account-deleted">
      <Brand />
      <h1 className="account-deleted-title">Your account was deleted</h1>
      <p className="account-deleted-note" role="status">
        {elsewhere
          ? "This account was deleted in another tab. Nothing here was saved."
          : "Your portfolio, draft, files and connected access are being removed. Visitors can no longer open your site."}
      </p>
      <Link href="/">Go to hasaweb.site</Link>
    </main>
  );
}
