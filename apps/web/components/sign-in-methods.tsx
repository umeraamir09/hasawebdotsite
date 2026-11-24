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
import { Button, Icon, IconButton } from "./workbench";

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

// The account menu's sign-in list (Figma 414:9669).
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
    <section aria-label="Connected sign-in methods" className="account-methods">
      <h3 className="account-label">Sign-in</h3>
      {notice && (
        <p
          className="account-notice"
          data-kind={notice.kind}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      {loadFailed && (
        <p className="account-notice" data-kind="error" role="alert">
          We couldn't load your sign-in methods.{" "}
          <Button size="s" kind="ghost" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      )}
      {methods && (
        <ul className="account-method-list">
          {methods.map(({ provider, connected }) => (
            <li key={provider} data-sign-in-method={provider}>
              <div className="account-method">
                <span className="account-method-icon" aria-hidden="true">
                  {provider === "github" ? (
                    <Icon name="github" size={16} />
                  ) : (
                    "G"
                  )}
                </span>
                <span className="account-method-text">
                  <span className="account-method-name">
                    {providerNames[provider]}
                  </span>
                  {connected && (
                    <span className="account-method-state">Connected</span>
                  )}
                </span>
                {connected ? (
                  connectedCount > 1 &&
                  confirming !== provider && (
                    <IconButton
                      icon="more"
                      label={`Disconnect ${providerNames[provider]}`}
                      disabled={disabled || busy}
                      onClick={() => setConfirming(provider)}
                    />
                  )
                ) : (
                  <Button
                    size="s"
                    aria-label={`Connect ${providerNames[provider]}`}
                    disabled={disabled || busy}
                    onClick={() => void connect(provider)}
                  >
                    Connect
                  </Button>
                )}
              </div>
              {confirming === provider && (
                <fieldset
                  className="account-confirm"
                  aria-label={`Confirm disconnecting ${providerNames[provider]}`}
                >
                  <p>{disconnectNotes[provider]}</p>
                  <div className="account-confirm-actions">
                    <Button
                      size="s"
                      disabled={busy}
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="s"
                      kind="danger"
                      disabled={disabled || busy}
                      onClick={() => void disconnect(provider)}
                    >
                      {busy
                        ? "Disconnecting..."
                        : `Disconnect ${providerNames[provider]} now`}
                    </Button>
                  </div>
                </fieldset>
              )}
            </li>
          ))}
        </ul>
      )}
      {methods && connectedCount === 1 && (
        <p className="account-method-state">
          Keep at least one sign-in method connected.
        </p>
      )}
    </section>
  );
}
