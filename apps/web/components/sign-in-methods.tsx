"use client";

import { useCallback, useEffect, useState } from "react";
import { type Provider, providerNames } from "../lib/auth-client";
import type { DraftController } from "../lib/draft/controller";
import {
  bumpGraphRevision,
  setGitHubPrivate,
} from "../lib/editor/github-graph";
import {
  connectSignInMethod,
  disconnectSignInMethod,
  readSignInMethods,
  type SignInMethod,
} from "../lib/sign-in-methods";

type Notice = { kind: "success" | "error"; text: string };

const disconnectNotes: Record<Provider, string> = {
  github:
    "You won't be able to sign in with GitHub until you connect it again. Private GitHub activity access is removed now, without publishing, and revoked at GitHub. Your graph keeps showing public contributions.",
  google:
    "You won't be able to sign in with Google until you connect it again.",
};
const failures = {
  last_method: "Keep at least one sign-in method connected.",
  not_connected: "That sign-in method was already disconnected.",
  owner_changed:
    "You signed in to a different account in another tab. Reload to continue.",
  signed_out: "Your session ended. Sign in again to change sign-in methods.",
  failed: "We couldn't disconnect it. Check your connection and try again.",
} as const;

// "Connected sign-in methods" in the editor's settings panel (Phase 47).
export function SignInMethods({
  controller,
  disabled,
  initialNotice,
}: {
  controller: DraftController;
  disabled: boolean;
  initialNotice: Notice | null;
}) {
  const [methods, setMethods] = useState<SignInMethod[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirming, setConfirming] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(initialNotice);
  const load = useCallback(async () => {
    try {
      setMethods(await readSignInMethods());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const connectedCount = methods?.filter((item) => item.connected).length ?? 0;

  async function connect(provider: Provider) {
    setBusy(true);
    setNotice(null);
    try {
      await connectSignInMethod(provider);
    } catch {
      setBusy(false);
      setNotice({
        kind: "error",
        text: `We couldn't start connecting ${providerNames[provider]}. Try again.`,
      });
      await load();
    }
  }
  async function disconnect(provider: Provider) {
    setBusy(true);
    setNotice(null);
    const result = await disconnectSignInMethod(
      controller.identity.ownerId,
      provider,
    );
    if (result === "disconnected") {
      if (provider === "github") {
        // The server already withdrew private access. Turn the draft's
        // private choice off too, as Remove private access does.
        for (const component of controller.store.getState().working
          ?.components ?? [])
          if (component.type === "github" && component.data.includePrivate)
            setGitHubPrivate(controller, component.id, false);
        bumpGraphRevision();
      }
      setNotice({
        kind: "success",
        text: `${providerNames[provider]} disconnected.`,
      });
    } else setNotice({ kind: "error", text: failures[result] });
    setConfirming(null);
    setBusy(false);
    await load();
  }

  return (
    <section aria-label="Connected sign-in methods" className="sign-in-methods">
      <h2>Connected sign-in methods</h2>
      {notice && (
        <p
          className={
            notice.kind === "error" ? "editor-input-note" : "editor-muted"
          }
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      {loadFailed && (
        <p className="editor-input-note" role="alert">
          We couldn't load your sign-in methods.{" "}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {methods === null && !loadFailed && (
        <p className="editor-muted">Loading sign-in methods...</p>
      )}
      {methods && (
        <ul>
          {methods.map(({ provider, connected }) => (
            <li key={provider} data-sign-in-method={provider}>
              <div className="sign-in-method-row">
                <span>
                  <strong>{providerNames[provider]}</strong>
                  <span className="editor-muted">
                    {connected
                      ? "Connected"
                      : provider === "google"
                        ? "Add another way to sign in with your account's email"
                        : "Add another way to sign in"}
                  </span>
                </span>
                {connected ? (
                  connectedCount > 1 &&
                  confirming !== provider && (
                    <button
                      type="button"
                      disabled={disabled || busy}
                      onClick={() => setConfirming(provider)}
                    >
                      Disconnect {providerNames[provider]}
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    disabled={disabled || busy}
                    onClick={() => void connect(provider)}
                  >
                    Connect {providerNames[provider]}
                  </button>
                )}
              </div>
              {confirming === provider && (
                <fieldset
                  aria-label={`Confirm disconnecting ${providerNames[provider]}`}
                >
                  <p>{disconnectNotes[provider]}</p>
                  <button
                    type="button"
                    disabled={disabled || busy}
                    onClick={() => void disconnect(provider)}
                  >
                    {busy
                      ? "Disconnecting..."
                      : `Disconnect ${providerNames[provider]} now`}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </button>
                </fieldset>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="editor-muted">
        Keep at least one sign-in method connected.
      </p>
    </section>
  );
}
