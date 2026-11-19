"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import {
  DeliveryError,
  type DeliveryStatus,
  deliveryMessages,
  noticeMessages,
  readDelivery,
  sendTestMessage,
  testOutcomeMessages,
} from "../lib/editor/contact-delivery";
import {
  chooseAccountRecipient,
  RecipientError,
  type RecipientStatus,
  readRecipient,
  recipientMessages,
  requestRecipient,
} from "../lib/editor/contact-recipient";

// Recipient settings for the contact form (Phase 43). The recipient is not
// draft content: it changes immediately and never appears on the portfolio.
export function ContactControls({
  controller,
  disabled,
}: {
  controller: DraftController;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const ownerId = controller.identity.ownerId;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const inputId = useId();
  const [status, setStatus] = useState<RecipientStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const live = useRef(true);
  const [delivery, setDelivery] = useState<DeliveryStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testNotice, setTestNotice] = useState("");
  const [testError, setTestError] = useState("");

  useEffect(() => {
    live.current = true;
    readRecipient(ownerId).then(
      (value) => live.current && setStatus(value),
      () => live.current && setLoadFailed(true),
    );
    // Delivery status is informational; the panel works without it.
    readDelivery(ownerId).then(
      (value) => live.current && setDelivery(value),
      () => undefined,
    );
    return () => {
      live.current = false;
    };
  }, [ownerId]);

  async function run(work: () => Promise<RecipientStatus>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await work();
      if (!live.current) return;
      setStatus(next);
      setNotice(success);
      setEmail("");
    } catch (failure) {
      if (!live.current) return;
      const code = failure instanceof RecipientError ? failure.code : null;
      if (failure instanceof RecipientError && failure.status)
        setStatus(failure.status);
      setError(recipientMessages[code ?? "unavailable"]);
    } finally {
      if (live.current) setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestNotice("");
    setTestError("");
    try {
      const result = await sendTestMessage(ownerId);
      if (!live.current) return;
      setDelivery(result);
      if (result.outcome === "failed") setTestError(testOutcomeMessages.failed);
      else setTestNotice(testOutcomeMessages[result.outcome]);
    } catch (failure) {
      if (!live.current) return;
      if (failure instanceof DeliveryError && failure.status)
        setDelivery(failure.status);
      setTestError(
        deliveryMessages[
          failure instanceof DeliveryError ? failure.code : "unavailable"
        ],
      );
    } finally {
      if (live.current) setTesting(false);
    }
  }

  const recipient = status?.recipient ?? null;
  const account = status?.accountEmail ?? null;
  const usingAccount =
    recipient?.state === "verified" &&
    account !== null &&
    recipient.email.toLowerCase() === account.toLowerCase();
  return (
    <section aria-label="Contact form controls">
      <h2>Contact form</h2>
      <p className="editor-muted">
        Visitors can send you a message. It is delivered to the recipient
        address below, which stays private: it never appears on your portfolio.
        Previews never send messages.
      </p>
      <h3>Recipient</h3>
      {!status && !loadFailed && <p>Loading your recipient...</p>}
      {loadFailed && <p role="alert">{recipientMessages.unavailable}</p>}
      {status && (
        <p data-recipient-state={recipient?.state ?? "none"}>
          {!recipient &&
            "No recipient yet. The form can't be published until you choose and confirm one."}
          {recipient?.state === "verified" && (
            <>
              Messages go to <strong>{recipient.email}</strong>. Confirmed.
            </>
          )}
          {recipient?.state === "pending" && (
            <>
              We sent a confirmation link to <strong>{recipient.email}</strong>.
              Open it to confirm. The form can't be published until then.
            </>
          )}
          {recipient?.state === "unverified" && (
            <>
              <strong>{recipient.email}</strong> isn't confirmed. Send a new
              link to confirm it. The form can't be published until then.
            </>
          )}
        </p>
      )}
      {status && account && !usingAccount && (
        <button
          type="button"
          disabled={inactive || busy}
          onClick={() =>
            run(
              () => chooseAccountRecipient(ownerId),
              "Your account email is now the recipient.",
            )
          }
        >
          Use my account email ({account})
        </button>
      )}
      {status && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = email.trim() || recipient?.email || "";
            void run(
              () => requestRecipient(ownerId, value),
              "Confirmation link sent. Check that inbox.",
            );
          }}
        >
          <label htmlFor={inputId}>
            {recipient ? "Use a different address" : "Recipient address"}
          </label>
          <input
            id={inputId}
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            disabled={inactive || busy}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className="editor-muted">
            Changing the address takes effect now, not on Publish. Until the new
            address is confirmed, the form can't be published.
          </p>
          <button
            type="submit"
            disabled={
              inactive ||
              busy ||
              (!email.trim() &&
                recipient?.state !== "pending" &&
                recipient?.state !== "unverified")
            }
          >
            {email.trim() || !recipient || recipient.state === "verified"
              ? "Send confirmation link"
              : "Send a new link"}
          </button>
        </form>
      )}
      <p role="status" className="editor-muted">
        {busy ? "Working..." : notice}
      </p>
      {error && <p role="alert">{error}</p>}
      <section aria-label="Message delivery">
        <h3>Delivery</h3>
        <p className="editor-muted">
          Send yourself a test message to check delivery before you share your
          portfolio. You can send two a day.
        </p>
        <button
          type="button"
          disabled={inactive || testing || recipient?.state !== "verified"}
          onClick={() => void sendTest()}
        >
          Send test message
        </button>
        <p role="status" className="editor-muted" data-test-message-status="">
          {testing ? "Sending a test message..." : testNotice}
        </p>
        {testError && <p role="alert">{testError}</p>}
        {delivery && delivery.delivering > 0 && (
          <p className="editor-muted">
            {delivery.delivering === 1
              ? "1 message is being delivered."
              : `${delivery.delivering} messages are being delivered.`}
          </p>
        )}
        {delivery && delivery.failures.length > 0 && (
          <>
            <h4>Undelivered messages</h4>
            <ul aria-label="Undelivered messages">
              {delivery.failures.map((failure) => (
                <li
                  key={`${failure.acceptedAt}-${failure.failedAt}`}
                  data-notice={failure.notice}
                >
                  A message sent on{" "}
                  {new Date(failure.acceptedAt).toLocaleString()} couldn't be
                  delivered and is no longer kept.{" "}
                  {noticeMessages[failure.notice]}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </section>
  );
}
