"use client";

import { useEffect, useRef, useState } from "react";
import { resumeAccountDeletion } from "../lib/account-deletion";
import {
  authErrorMessage,
  type Provider,
  startSignIn,
} from "../lib/auth-client";
import {
  loadRecoveryEntry,
  type RecoveryEntry,
} from "../lib/draft/auth-recovery";
import {
  createRecoveryCoordinator,
  type RecoveryCoordinator,
} from "../lib/draft/recovery-coordinator";
import { Brand } from "./brand";
import { DraftRecovery } from "./draft-recovery";

export function AuthRecovery() {
  const [entry, setEntry] = useState<RecoveryEntry | null>(null);
  const [recovery, setRecovery] = useState<RecoveryCoordinator | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let disposed = false;
    let current: RecoveryCoordinator | null = null;
    async function load() {
      try {
        // A deleted owner's records and continuation are gone before lookup.
        await resumeAccountDeletion().catch(() => {});
        const result = await loadRecoveryEntry();
        if (disposed) return;
        setEntry(result);
        setMessage(
          authErrorMessage(new URLSearchParams(location.search).get("error")),
        );
        if (result.kind === "ready") {
          current = createRecoveryCoordinator({
            ownerId: result.continuation.ownerId,
            portfolioId: result.continuation.portfolioId,
            context: result.continuation.context,
          });
          await current.store
            .getState()
            .controller.initialize()
            .catch(() => {});
          if (!disposed) setRecovery(current);
          else current.dispose();
        }
      } catch {
        if (!disposed)
          setMessage(
            "Your session or browser recovery could not be read. Reload this page to try again.",
          );
      }
    }
    void load();
    const reset = () => {
      busy.current = false;
      setPending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => {
      disposed = true;
      current?.dispose();
      window.removeEventListener("pageshow", reset);
    };
  }, []);
  async function connect(provider: Provider) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await startSignIn(provider, "draft-recovery");
    } catch {
      busy.current = false;
      setPending(false);
      setMessage("Sign-in could not start. Choose a provider to try again.");
    }
  }
  return (
    <main className="editor-entry">
      <Brand />
      <h1>Recover your draft</h1>
      {message && <p role="alert">{message}</p>}
      {!entry && !message && <p role="status">Checking your session...</p>}
      {entry?.kind === "missing" && (
        <>
          <p>No recovery continuation is available in this tab.</p>
          <a className="ghost-button" href="/sign-in">
            Continue to account entry
          </a>
        </>
      )}
      {entry?.kind === "stale" && (
        <>
          <p>
            This recovery record is no longer available. Other browser recovery
            copies remain untouched.
          </p>
          <a className="ghost-button" href="/auth/entry">
            Open your account
          </a>
        </>
      )}
      {entry?.kind === "mismatch" && (
        <p role="alert">
          This is a different account or portfolio. Sign in with the original
          account to recover these edits. Your original recovery is untouched.
        </p>
      )}
      {entry?.kind === "signed-out" && (
        <p>
          Sign in again in this tab. Your preserved input will be offered before
          any save.
        </p>
      )}
      {entry && ["signed-out", "mismatch"].includes(entry.kind) && (
        <div className="providers" aria-busy={pending}>
          {(["github", "google"] as const).map((provider) => (
            <button
              className="ghost-button"
              key={provider}
              type="button"
              disabled={pending}
              onClick={() => void connect(provider)}
            >
              Sign in with {provider === "github" ? "GitHub" : "Google"}
            </button>
          ))}
        </div>
      )}
      {entry?.kind === "ready" && (
        <>
          <p>
            Your account matches. Continue preserved edits explicitly, verify an
            interrupted save, or review against the newer saved draft.
          </p>
          <a className="ghost-button" href="/auth/entry">
            Open your account
          </a>
        </>
      )}
      {recovery && <DraftRecovery recovery={recovery} />}
    </main>
  );
}
