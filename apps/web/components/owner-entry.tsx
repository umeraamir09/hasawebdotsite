"use client";

import { useEffect, useState } from "react";
import { resumeAccountDeletion } from "../lib/account-deletion";
import { resolveAccountEntry, signOutOwner } from "../lib/auth-client";
import type { RecoveryCoordinator } from "../lib/draft/recovery-coordinator";
import { Brand } from "./brand";
import { EditorSession } from "./editor-session";
import { SetupGuide } from "./setup-guide";

type Scope = { ownerId: string; portfolioId: string };
type Resolved = { kind: "setup" | "editor"; scope: Scope };

// The editor's iframe preview document, registered by the web Worker.
const editorPreview = "/editor/preview";

// The controlled post-auth resolver, mounted at `/auth/entry` and `/editor`
// once the Phase 42E gate is open. The persisted entry service decides:
// owners without the permanent milestone get the guide at `/auth/entry`
// (resuming saved progress, clamped by the server's required facts), and
// entered owners always get the editor at `/editor`. Neither a URL nor
// client state can choose the other side.
export function OwnerEntry({
  route,
  send,
  previewDocument = editorPreview,
  onSignOut = signOutOwner,
  onGuideReady,
  onEditorReady,
  navigate = (path) => window.location.replace(path),
}: {
  route: "entry" | "editor";
  send?: typeof fetch;
  previewDocument?: string;
  onSignOut?: () => Promise<void>;
  onGuideReady?(recovery: RecoveryCoordinator, scope: Scope): void;
  onEditorReady?(recovery: RecoveryCoordinator, scope: Scope): void;
  navigate?(path: string): void;
}) {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter explicitly restarts the entry request.
  useEffect(() => {
    const controller = new AbortController();
    // Phase 49: finish a local cleanup an earlier deletion left unfinished
    // before any owner's recovery records open.
    resumeAccountDeletion()
      .catch(() => {})
      .then(() => resolveAccountEntry(controller.signal))
      .then((current) => {
        if (controller.signal.aborted) return;
        if (!current?.portfolio) {
          navigate("/sign-in?reason=session_expired");
          return;
        }
        const kind = current.entry.kind;
        if (kind === "setup" && route === "editor") {
          // Setup consent returns are resolved from saved progress, so no
          // marker needs to travel; the guide shows the saved step.
          navigate("/auth/entry");
          return;
        }
        if (kind === "editor" && route === "entry") {
          // Keep the GitHub consent marker so the editor reopens the graph
          // section after a consent that started in setup.
          const consent =
            new URLSearchParams(location.search).get("github") === "consent";
          navigate(consent ? "/editor?github=consent" : "/editor");
          return;
        }
        setResolved({
          kind,
          scope: {
            ownerId: current.user.id,
            portfolioId: current.portfolio.id,
          },
        });
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [route, attempt]);

  if (resolved?.kind === "setup")
    return (
      <SetupGuide
        owner={resolved.scope}
        {...(send ? { send } : {})}
        previewDocument={previewDocument}
        onSignOut={onSignOut}
        onReady={(recovery) => onGuideReady?.(recovery, resolved.scope)}
        onEntered={() => navigate("/editor")}
      />
    );
  if (resolved?.kind === "editor")
    return (
      <EditorSession
        owner={resolved.scope}
        previewDocument={previewDocument}
        onSignOut={onSignOut}
        onReady={(recovery) => onEditorReady?.(recovery, resolved.scope)}
      />
    );
  return (
    <main className="editor-entry">
      <header>
        <Brand />
      </header>
      {error ? (
        <div className="auth-error" role="alert">
          <p>We couldn't open your account. Check your connection and retry.</p>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setError(false);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <p role="status">Opening your account...</p>
      )}
    </main>
  );
}
