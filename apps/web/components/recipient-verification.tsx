"use client";

import { useEffect, useState } from "react";
import {
  RecipientError,
  type RecipientStatus,
  readRecipient,
  recipientMessages,
  verificationToken,
  verifyRecipient,
} from "../lib/editor/contact-recipient";

type View =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "signed-out" }
  | { kind: "ready"; ownerId: string; status: RecipientStatus }
  | { kind: "confirming"; ownerId: string; status: RecipientStatus }
  | { kind: "confirmed"; email: string }
  | { kind: "failed"; message: string };

async function currentOwnerId(): Promise<string | null> {
  const response = await fetch("/api/owner", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new RecipientError("unavailable");
  const body = (await response.json()) as { user?: { id?: unknown } };
  if (typeof body.user?.id !== "string")
    throw new RecipientError("unavailable");
  return body.user.id;
}
const message = (error: unknown) =>
  recipientMessages[
    error instanceof RecipientError ? error.code : "unavailable"
  ];

export function RecipientVerification() {
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    const value = verificationToken(window.location.hash);
    setToken(value);
    if (!value) {
      setView({ kind: "missing" });
      return;
    }
    let live = true;
    (async () => {
      const ownerId = await currentOwnerId();
      if (!ownerId) return { kind: "signed-out" } as const;
      return {
        kind: "ready",
        ownerId,
        status: await readRecipient(ownerId),
      } as const;
    })().then(
      (next) => live && setView(next),
      (error: unknown) =>
        live && setView({ kind: "failed", message: message(error) }),
    );
    return () => {
      live = false;
    };
  }, []);

  async function confirm(ownerId: string, status: RecipientStatus) {
    if (!token) return;
    setView({ kind: "confirming", ownerId, status });
    try {
      const next = await verifyRecipient(ownerId, token);
      // The token is spent. Drop it from the address bar and history.
      window.history.replaceState(null, "", window.location.pathname);
      setView({ kind: "confirmed", email: next.recipient?.email ?? "" });
    } catch (error) {
      setView({ kind: "failed", message: message(error) });
    }
  }

  return (
    <main className="recipient-verification">
      <h1>Confirm your contact address</h1>
      {view.kind === "loading" && <p>Checking your link...</p>}
      {view.kind === "missing" && (
        <p role="alert">
          This link is incomplete. Open the full link from the confirmation
          email, or send a new one from the editor.
        </p>
      )}
      {view.kind === "signed-out" && (
        <>
          <p>
            Sign in to the account that requested this link, then open the link
            from the email again.
          </p>
          <a href="/sign-in">Sign in</a>
        </>
      )}
      {(view.kind === "ready" || view.kind === "confirming") && (
        <>
          <p>
            {view.status.recipient?.state === "pending" ? (
              <>
                Confirm <strong>{view.status.recipient.email}</strong> as the
                address that receives your contact form messages. It stays
                private.
              </>
            ) : (
              "Confirm the address that receives your contact form messages. It stays private."
            )}
          </p>
          <button
            type="button"
            disabled={view.kind === "confirming"}
            onClick={() => confirm(view.ownerId, view.status)}
          >
            {view.kind === "confirming" ? "Confirming..." : "Confirm address"}
          </button>
        </>
      )}
      {view.kind === "confirmed" && (
        <>
          <p role="status">
            {view.email ? (
              <>
                <strong>{view.email}</strong> is confirmed.
              </>
            ) : (
              "Your address is confirmed."
            )}{" "}
            Your contact form can be published.
          </p>
          <a href="/editor">Back to the editor</a>
        </>
      )}
      {view.kind === "failed" && (
        <>
          <p role="alert">{view.message}</p>
          <a href="/editor">Back to the editor</a>
        </>
      )}
    </main>
  );
}
