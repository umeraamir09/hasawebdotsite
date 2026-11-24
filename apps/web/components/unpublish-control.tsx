"use client";

import type { PublicationSite } from "@hasaweb/schema";
import { useState } from "react";
import { Button, Dialog } from "./workbench";

// The foot of the Share panel (Figma 413:7431): Unpublish, with a
// confirmation that says what stays and what goes.
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
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const host = site.url ? new URL(site.url).host : "your address";
  if (site.status === "unpublished")
    return (
      <div className="share-unpublished" role="status">
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
  const close = () => {
    if (busy) return;
    setConfirming(false);
    setFailure(null);
  };
  return (
    <div className="share-unpublish">
      <Button
        kind="danger"
        icon="eye-off"
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        Unpublish
      </Button>
      <Dialog
        open={confirming}
        onClose={close}
        title="Unpublish your website?"
        width={440}
      >
        <div className="share-unpublish-dialog">
          <p>
            Visitors will no longer be able to open {host}, its case studies,
            your resume or its images, and the contact form stops accepting
            messages. Search engines and other sites may keep old copies for a
            while.
          </p>
          <p>
            Your draft and your address are kept, and no one else can claim the
            address. Publish again to restore your site at {host}.
          </p>
          {failure && (
            <p className="share-unpublish-failure" role="alert">
              {failure}
            </p>
          )}
          <div className="share-unpublish-actions">
            <Button disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button
              kind="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setFailure(null);
                const error = await onUnpublish();
                setBusy(false);
                if (error === null) setConfirming(false);
                else setFailure(error);
              }}
            >
              {busy ? "Unpublishing..." : "Confirm unpublish"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
