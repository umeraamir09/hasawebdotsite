"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type Owner, resolveAccountEntry } from "../lib/auth-client";
import { Brand } from "./brand";

export function EditorEntry({ entry = false }: { entry?: boolean }) {
  const router = useRouter();
  const [owner, setOwner] = useState<Owner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter explicitly restarts the session request.
  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const current = await resolveAccountEntry(controller.signal);
        if (controller.signal.aborted) return;
        if (!current) {
          setOwner(null);
          router.replace("/sign-in?reason=session_expired");
        } else {
          if (current.entry.kind === "setup" && !entry) {
            router.replace("/auth/entry");
            return;
          }
          if (current.entry.kind === "editor" && entry) {
            router.replace("/editor");
            return;
          }
          setOwner(current);
          setError(null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setOwner(null);
          setError(
            "We couldn't open your account. Check your connection and retry.",
          );
        }
      }
    }
    void check();
    const resume = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      controller.abort();
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [router, attempt, entry]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Sign-out failed");
      setOwner(null);
      window.location.replace("/sign-in");
    } catch {
      setSigningOut(false);
      setError(
        "We couldn't sign you out. Check your connection and retry sign-out.",
      );
    }
  }

  return (
    <main className="editor-entry">
      <header>
        <Brand />
        {owner && (
          <button
            type="button"
            className="ghost-button"
            onClick={signOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        )}
      </header>
      {owner ? (
        <section>
          <p className="caption">Your account</p>
          <h1>Welcome, {owner.user.name}.</h1>
          <p>
            {owner.portfolio
              ? "You're signed in to your portfolio."
              : "You're signed in. Your portfolio will start here."}
          </p>
        </section>
      ) : (
        !error && <p role="status">Opening your account...</p>
      )}
      {error && (
        <div className="auth-error" role="alert">
          <p>{error}</p>
          {!owner && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </main>
  );
}
