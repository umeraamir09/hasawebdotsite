// biome-ignore-all lint/performance/noImgElement: Static Figma assets use intrinsic SVG geometry; Cloudflare image optimization is disabled.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  authErrorMessage,
  type Provider,
  providerNames,
  readOwner,
  startSignIn,
} from "../lib/auth-client";
import { Brand } from "./brand";

function ProviderIcon({ provider }: { provider: Provider }) {
  if (provider === "github")
    return <img src="/auth/github.svg" alt="" width="24" height="24" />;
  return (
    <span className="google-icon" aria-hidden="true">
      <img className="google-blue" src="/auth/google-blue.svg" alt="" />
      <img className="google-red" src="/auth/google-red.svg" alt="" />
      <img className="google-yellow" src="/auth/google-yellow.svg" alt="" />
      <img className="google-green" src="/auth/google-green.svg" alt="" />
    </span>
  );
}

export function SignIn() {
  const router = useRouter();
  const [pending, setPending] = useState<Provider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setMessage(authErrorMessage(params.get("error")));
    setReturning(params.get("reason") === "session_expired");
    const controller = new AbortController();
    readOwner(controller.signal)
      .then((owner) => {
        if (owner) router.replace("/auth/entry");
      })
      .catch(() => {});
    // A browser Back action from provider consent must allow a fresh attempt.
    const reset = () => {
      busy.current = false;
      setPending(null);
    };
    window.addEventListener("pageshow", reset);
    return () => {
      controller.abort();
      window.removeEventListener("pageshow", reset);
    };
  }, [router]);

  async function connect(provider: Provider) {
    if (busy.current) return;
    busy.current = true;
    setPending(provider);
    setMessage(null);
    try {
      await startSignIn(provider);
    } catch {
      setMessage(
        "We couldn't reach sign-in. Check your connection and choose a provider to retry.",
      );
      busy.current = false;
      setPending(null);
    }
  }

  return (
    <main className="auth-layout">
      <aside className="auth-visual" aria-label="Make room for your work">
        <img
          className="assembly-desktop"
          src="/auth/assembly-desktop.png"
          alt=""
          width="512"
          height="496"
        />
        <h2>
          Make room
          <br />
          for your work.
        </h2>
        <p>
          Your profile, projects, and personality.
          <br />
          All at one address.
        </p>
      </aside>
      <section className="auth-panel" aria-labelledby="sign-in-title">
        <Brand />
        <img
          className="assembly-mobile"
          src="/auth/assembly-mobile.png"
          alt=""
          width="312"
          height="180"
        />
        <div className="auth-intro">
          <h1 id="sign-in-title">
            {returning ? (
              "Welcome back."
            ) : (
              <>
                Your website
                <br />
                starts here.
              </>
            )}
          </h1>
          <p>
            {returning
              ? "Sign in to reopen your saved portfolio."
              : "Sign up or sign in to build your portfolio."}
          </p>
        </div>
        {message && (
          <div className="auth-error" role="alert">
            <p>Sign-in didn't finish.</p>
            <p>{message}</p>
          </div>
        )}
        <div className="providers" aria-busy={!!pending}>
          {(["github", "google"] as const).map((provider) => (
            <button
              className="provider-button"
              type="button"
              key={provider}
              disabled={!!pending}
              onClick={() => connect(provider)}
            >
              <ProviderIcon provider={provider} />
              <span>
                {pending === provider
                  ? `Connecting to ${providerNames[provider]}...`
                  : `Continue with ${providerNames[provider]}`}
              </span>
            </button>
          ))}
        </div>
        <p className="sr-only" role="status">
          {pending
            ? `Connecting to ${providerNames[pending]}. Please wait.`
            : ""}
        </p>
        <p className="caption">
          No password to remember. Use the same provider when you return.
        </p>
        <Link className="ghost-button" href="/">
          Back to home
        </Link>
      </section>
    </main>
  );
}
