"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { editEditorField } from "../lib/editor/fields";
import { missingProfileFields } from "../lib/editor/profile";
import { profileSuggestions } from "../lib/editor/provider-suggestions";
import { DraftTextField } from "./draft-text-field";
import { ProfileImages } from "./profile-images";
import "./profile-controls.css";

type Props = {
  controller: DraftController;
  disabled: boolean;
  showLocation?: boolean;
};
type Suggestion =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; name: string; photoAvailable: boolean }
  | { kind: "unavailable" };

export function ProfileControls(props: Props) {
  return <Controls key={props.controller.scopeKey} {...props} />;
}

function Controls({ controller, disabled, showLocation = true }: Props) {
  const state = useStore(controller.store);
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const [suggestion, setSuggestion] = useState<Suggestion>({ kind: "idle" });
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (inactive) {
      request.current?.abort();
      setSuggestion({ kind: "idle" });
    }
  }, [inactive]);
  async function suggest() {
    request.current?.abort();
    const pending = new AbortController();
    request.current = pending;
    setMessage("");
    setSuggestion({ kind: "loading" });
    try {
      const result = await profileSuggestions({
        ...controller.identity,
        signal: pending.signal,
      });
      if (!pending.signal.aborted) setSuggestion({ kind: "ready", ...result });
    } catch {
      if (!pending.signal.aborted) setSuggestion({ kind: "unavailable" });
    }
  }
  if (!state.working) return null;
  const missing = missingProfileFields(state.working);
  return (
    <section className="profile-controls" aria-label="Profile controls">
      <h2>Your profile</h2>
      <p className="editor-muted">
        Name, bio, avatar and banner are required. Your edits stay private until
        you publish.
      </p>
      <DraftTextField
        controller={controller}
        disabled={inactive}
        label="Name"
        path={["profile", "name"]}
      />
      <div className="provider-suggestions">
        <button
          type="button"
          disabled={inactive || suggestion.kind === "loading"}
          onClick={() => void suggest()}
        >
          {suggestion.kind === "loading"
            ? "Checking account suggestions..."
            : "Check my account suggestions"}
        </button>
        {suggestion.kind === "ready" && (
          <div>
            {suggestion.name.trim() && (
              <>
                <p className="editor-muted">
                  Your sign-in account suggests{" "}
                  <strong>{suggestion.name}</strong>. Accept it only if you want
                  visitors to see this name.
                </p>
                <button
                  type="button"
                  className="profile-accept"
                  disabled={inactive}
                  onClick={() => {
                    if (
                      editEditorField(
                        controller,
                        ["profile", "name"],
                        suggestion.name,
                      )
                    ) {
                      setSuggestion({ ...suggestion, name: "" });
                      setMessage(
                        "Account name accepted in your private draft.",
                      );
                    } else
                      setMessage(
                        "The name could not fit in your draft. Shorten other content and try again, or edit the name field.",
                      );
                  }}
                >
                  Use this name
                </button>
              </>
            )}
            <p className="editor-muted">
              {suggestion.photoAvailable
                ? "Your account photo is available below. Review its crop before accepting it."
                : "Your account has no supported photo. Upload an avatar below."}
            </p>
            <button
              type="button"
              disabled={inactive}
              onClick={() => setSuggestion({ kind: "idle" })}
            >
              Dismiss account suggestions
            </button>
          </div>
        )}
        {suggestion.kind === "unavailable" && (
          <p role="alert">
            Account suggestions are unavailable. Enter your name and upload an
            avatar, or try again.
          </p>
        )}
        <p role="status">{message}</p>
      </div>
      <DraftTextField
        controller={controller}
        disabled={inactive}
        label="Bio"
        path={["profile", "bio"]}
        multiline
      />
      {showLocation && (
        <DraftTextField
          controller={controller}
          disabled={inactive}
          label="Location"
          path={["profile", "location"]}
        />
      )}
      <ProfileImages
        controller={controller}
        disabled={inactive}
        providerPhotoAvailable={
          suggestion.kind === "ready" && suggestion.photoAvailable
        }
      />
      {missing.length > 0 && (
        <p className="editor-muted">
          Still needed in your profile: {missing.join(", ")}. Sample content
          does not count.
        </p>
      )}
    </section>
  );
}
