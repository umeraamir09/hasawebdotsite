"use client";

import { useEffect, useRef, useState } from "react";
import {
  type ConsentReturn,
  connectSignInGraph,
  detectGraphUsername,
  type GraphPrivateState,
  GraphSetupError,
  type GraphSetupFailure,
  type GraphSetupStatus,
  readGraphStatus,
  retryGraph,
  setupGraph,
  startPrivateConsent,
} from "../lib/editor/github-graph";
import { graphConnected } from "../lib/guide/github";
import { connectSignInMethod } from "../lib/sign-in-methods";

// The graph flow shared by the editor section and the setup guide's GitHub
// step. A graph is the owner's GitHub sign-in account, public and private.
// Connect GitHub links that sign-in when missing, or authorizes it when the
// stored token cannot be used. Another account means disconnect GitHub
// sign-in, then Connect GitHub again.

const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

const failures: Record<GraphSetupFailure, string> = {
  invalid_username:
    "Enter a GitHub username: letters, numbers and single hyphens, up to 39 characters.",
  not_found: "GitHub has no account with that username. Check the spelling.",
  unavailable: "GitHub couldn't be reached. Your draft is unchanged. Retry.",
  misconfigured:
    "GitHub returned a response we can't use right now. Try again later.",
  too_soon: "Wait a few seconds, then try again.",
  conflict: "Your graph changed in another tab. Reload and retry.",
  no_graph: "Connect a GitHub account first.",
  no_portfolio: "Open your portfolio before connecting GitHub.",
  invalid_input: "Enter a GitHub username.",
  already_authorized: "This account is already connected.",
  consent_busy:
    "Earlier access to this GitHub account is still being removed. Try again in a minute.",
  private_unavailable: "GitHub activity isn't available right now.",
  reauthorize: "GitHub needs you to authorize again.",
};
export const graphFailure = (cause: unknown) =>
  failures[cause instanceof GraphSetupError ? cause.code : "unavailable"];

const consentFailures: Record<
  Extract<GraphPrivateState, { state: "consent_failed" }>["reason"],
  string
> = {
  cancelled: "Authorization was cancelled.",
  wrong_account:
    "GitHub authorized a different account, so nothing changed. Sign in to GitHub as this account first.",
  scope: "GitHub didn't grant the requested permission.",
  failed: "Authorization didn't finish.",
  expired: "The authorization link expired.",
  interrupted: "Authorization didn't finish.",
};

const count = (total: number) =>
  `${total.toLocaleString("en")} ${total === 1 ? "contribution" : "contributions"}`;

/** The graph's status line. `ok` is a graph that can publish as it is. */
export function describeGraph(status: GraphSetupStatus | null): {
  text: string;
  ok: boolean;
} {
  if (!status) return { text: "Checking your graph...", ok: false };
  if (!status.connection) return { text: "Not connected.", ok: false };
  const state = status.private;
  const blocked = " Publishing is blocked until then.";
  switch (state.state) {
    case "ready":
      return {
        text: state.lastError
          ? `Couldn't refresh GitHub. Showing ${count(state.total)} from ${state.fetchedAt.slice(0, 10)}. Retry.`
          : `Connected. ${count(state.total)} in the last year.`,
        ok: true,
      };
    case "pending":
      return {
        text: "Connected. The first fetch hasn't finished. Retry.",
        ok: false,
      };
    case "error":
      return {
        text:
          state.kind === "retry"
            ? "GitHub couldn't be reached. Retry."
            : "GitHub returned activity we can't use right now. Try again later.",
        ok: false,
      };
    case "authorizing":
      return {
        text: `Waiting for GitHub. If you closed that page, authorize again.${blocked}`,
        ok: false,
      };
    case "consent_failed":
      return {
        text: `${consentFailures[state.reason]} Authorize again.${blocked}`,
        ok: false,
      };
    case "reconnect":
      return {
        text: `GitHub no longer allows access to this account's activity. Authorize again.${blocked}`,
        ok: false,
      };
    case "cleanup":
      return {
        text: `Earlier access to this account is still being removed at GitHub. Try again in a minute.${blocked}`,
        ok: false,
      };
    default:
      return {
        text: `Authorize this account on GitHub to show its activity.${blocked}`,
        ok: false,
      };
  }
}

export function useGitHubGraph({
  draftUsername,
  autoConnect,
  returnTo,
  beforeConsent,
  onSelected,
  onConnected,
}: {
  // The account the draft names, or "" before one is chosen.
  draftUsername: string;
  // Connect the owner's GitHub sign-in on open when no account is chosen.
  autoConnect: boolean;
  returnTo: ConsentReturn;
  // Saves the draft before leaving for GitHub. False keeps the owner here.
  beforeConsent(): Promise<boolean>;
  // The server selected this account, before the owner leaves to authorize.
  onSelected(username: string): void;
  // The server connected this account from the owner's GitHub sign-in.
  onConnected(username: string): void;
}) {
  const [status, setStatus] = useState<GraphSetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // The sign-in couldn't connect on its own; the owner chooses what next.
  const [signInNeedsGitHub, setSignInNeedsGitHub] = useState(false);
  const alive = useRef(true);
  const callbacks = useRef({ beforeConsent, onSelected, onConnected });
  callbacks.current = { beforeConsent, onSelected, onConnected };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function authorize() {
    if (!(await callbacks.current.beforeConsent())) {
      setProblem(
        "Your draft couldn't be saved, so authorization didn't start. Retry.",
      );
      return;
    }
    const url = await startPrivateConsent(undefined, returnTo);
    // Same tab: GitHub returns to the editor or this guide step.
    location.assign(url);
    // Stay busy while the browser leaves.
    await new Promise(() => {});
  }
  async function authorizeSignInAccount() {
    const login = await detectGraphUsername();
    if (!login || !LOGIN.test(login)) throw new GraphSetupError("unavailable");
    const next = await setupGraph(login);
    if (!alive.current) return;
    setStatus(next);
    if (!next.connection) return;
    callbacks.current.onSelected(next.connection.username);
    if (!graphConnected(next, next.connection.username)) await authorize();
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setProblem("");
    try {
      await action();
    } catch (cause) {
      if (alive.current) setProblem(graphFailure(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function connectSignIn() {
    try {
      const next = await connectSignInGraph();
      if (!alive.current) return true;
      setStatus(next);
      setSignInNeedsGitHub(false);
      if (next.connection)
        callbacks.current.onConnected(next.connection.username);
      return true;
    } catch (cause) {
      if (!(cause instanceof GraphSetupError) || cause.code !== "reauthorize")
        throw cause;
      return false;
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: connects once per open.
  useEffect(() => {
    let current = true;
    readGraphStatus()
      .then(async (next) => {
        if (!current) return;
        setStatus(next);
        // A remount (or a connect that finished after the previous effect
        // was cleaned up) can already be connected on the server. Still
        // write the account into the draft when it does not name one.
        if (
          autoConnect &&
          !draftUsername &&
          next.connection &&
          graphConnected(next)
        ) {
          callbacks.current.onConnected(next.connection.username);
          return;
        }
        if (
          !autoConnect ||
          draftUsername ||
          !next.githubSignIn ||
          !next.privateAvailable ||
          graphConnected(next)
        )
          return;
        setBusy(true);
        try {
          if (!(await connectSignIn()) && current) setSignInNeedsGitHub(true);
        } catch (cause) {
          if (current) {
            setSignInNeedsGitHub(true);
            setProblem(graphFailure(cause));
          }
        } finally {
          if (current) setBusy(false);
        }
      })
      .catch(() => {
        if (current)
          setProblem("Your graph status is unavailable. Reload to try again.");
      });
    return () => {
      current = false;
    };
  }, []);

  // Revocation at GitHub runs in the background after a removal. Re-read
  // the status until it settles so the owner can connect again.
  const cleaning = status?.private.state === "cleanup";
  useEffect(() => {
    if (!cleaning) return;
    let current = true;
    const timer = setInterval(() => {
      readGraphStatus()
        .then((next) => {
          if (current) setStatus(next);
        })
        .catch(() => {
          // A missed poll is retried on the next tick.
        });
    }, 2000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [cleaning]);

  // Before the draft names an account, only a connected graph is shown: a
  // selection left by a removed graph starts over.
  const connection = status?.connection ?? null;
  const matches =
    !!connection &&
    !!status &&
    (draftUsername
      ? connection.username.toLowerCase() === draftUsername.toLowerCase()
      : graphConnected(status));
  return {
    status,
    busy,
    problem,
    setProblem,
    // The account this graph shows, once the server selected it.
    account: matches ? connection : null,
    connected: !!status && matches && graphConnected(status),
    signInNeedsGitHub,
    summary: describeGraph(
      matches ? status : status && { ...status, connection: null },
    ),
    /**
     * Connects the GitHub sign-in as the graph. Without a GitHub sign-in,
     * starts linking one. A sign-in token that cannot be used authorizes
     * that same account on GitHub.
     */
    connectGitHub: () =>
      run(async () => {
        if (!status?.githubSignIn) {
          // Save first: an interrupted save would greet the return with
          // the recovery panel.
          if (!(await callbacks.current.beforeConsent())) {
            setProblem(
              "Your draft couldn't be saved, so connecting didn't start. Retry.",
            );
            return;
          }
          await connectSignInMethod("github");
          await new Promise(() => {});
          return;
        }
        if (await connectSignIn()) return;
        await authorizeSignInAccount();
      }),
    /** Authorizes the selected account on GitHub again. */
    authorize: () => run(authorize),
    retry: () =>
      run(async () => {
        const next = await retryGraph();
        if (alive.current) setStatus(next);
      }),
    /** Re-reads the status, for example after access was withdrawn. */
    reload: () =>
      run(async () => {
        const next = await readGraphStatus();
        if (alive.current) setStatus(next);
      }),
  };
}
