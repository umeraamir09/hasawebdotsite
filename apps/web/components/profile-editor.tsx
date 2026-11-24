"use client";

import { clearSample, type DraftDoc } from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import {
  faceRevealIncomplete,
  withDecoration,
  withFaceRevealEnabled,
  withoutFaceImage,
} from "../lib/editor/avatar-extras";
import { decorationName } from "../lib/editor/decorations";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import { missingProfileFields } from "../lib/editor/profile";
import { profileSuggestions } from "../lib/editor/provider-suggestions";
import { DecorationGallery } from "./decoration-gallery";
import { DraftField } from "./draft-field";
import { ImageSlot } from "./image-slot";
import { SocialLinksControl } from "./social-links-control";
import { Button, Icon, Toggle } from "./workbench";
import "./profile-editor.css";

type Suggestion =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; name: string; photoAvailable: boolean }
  | { kind: "unavailable" };

// The profile editor in the Build panel (Figma 409:2175, mobile 417:12355):
// the banner and avatar with their camera actions, the Decoration and Face
// Reveal rows, then name, bio, location and links.
export function ProfileEditor(props: {
  controller: DraftController;
  disabled: boolean;
}) {
  return <Editor key={props.controller.scopeKey} {...props} />;
}

function Editor({
  controller,
  disabled,
}: {
  controller: DraftController;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const [suggestion, setSuggestion] = useState<Suggestion>({ kind: "idle" });
  const [message, setMessage] = useState("");
  const [gallery, setGallery] = useState(false);
  const request = useRef<AbortController | null>(null);
  const faceId = useId();
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
  const draft = state.working;
  if (!draft) return null;
  const update = (change: (current: DraftDoc) => DraftDoc) => {
    const current = controller.store.getState().working;
    if (!inactive && current) controller.update(change(current));
  };
  const pendingImage = (key: string) => (pending: boolean) =>
    controller.store.setState((current) => ({
      pendingImages: { ...current.pendingImages, [key]: pending },
    }));
  const image = (purpose: "avatar" | "banner") => {
    const alt = ["profile", purpose, "alt"];
    return {
      purpose,
      noun: purpose,
      label: purpose === "avatar" ? "Avatar" : "Banner",
      value: draft.profile[purpose],
      description: readEditorField(state, alt),
      descriptionInvalid: Boolean(state.inputs[JSON.stringify(alt)]),
      ownerId: controller.identity.ownerId,
      disabled: inactive,
      onPendingChange: pendingImage(purpose),
      onReady(assetId: string) {
        const previous = controller.store.getState().working?.profile[purpose];
        if (
          !controller.edit(["profile", purpose], {
            assetId,
            alt: previous?.alt ?? "",
            ...(purpose === "avatar" ? { accepted: true } : {}),
          })
        )
          throw new Error(
            "The crop is ready but the draft could not accept it. Retry after resolving unfinished input.",
          );
        const edited = controller.store.getState().working;
        if (edited?.samples[`profile.${purpose}`])
          controller.update(clearSample(edited, `profile.${purpose}`));
      },
      onRemove() {
        const current = controller.store.getState().working;
        if (!current) return;
        const profile = { ...current.profile };
        delete profile[purpose];
        controller.clearInput(alt);
        controller.update(
          clearSample({ ...current, profile }, `profile.${purpose}`),
        );
      },
      onDescription: (value: string) => editEditorField(controller, alt, value),
    } as const;
  };
  const faceAlt = ["profile", "faceReveal", "image", "alt"];
  const { enabled: faceEnabled, image: faceImage } = draft.profile.faceReveal;
  const missing = missingProfileFields(draft);
  return (
    <section className="profile-editor" aria-label="Profile controls">
      <div className="profile-editor-card">
        <div data-publication-field="banner">
          <ImageSlot variant="banner" {...image("banner")} />
        </div>
        <div data-publication-field="avatar">
          <ImageSlot
            variant="avatar"
            {...image("avatar")}
            providerPortfolioId={
              suggestion.kind === "ready" && suggestion.photoAvailable
                ? controller.identity.portfolioId
                : undefined
            }
          />
        </div>
      </div>
      <div className="profile-editor-rows">
        <div data-publication-field="decorationId">
          <button
            type="button"
            className="profile-editor-row"
            aria-haspopup="dialog"
            disabled={inactive}
            onClick={() => setGallery(true)}
          >
            <Icon name="cat" size={18} />
            <span className="profile-editor-row-name">Decoration</span>
            <span className="profile-editor-row-value">
              {decorationName(
                appearanceCatalog.decorations,
                draft.profile.decorationId,
              )}
            </span>
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
        <div data-publication-field="faceReveal">
          <div className="profile-editor-row">
            <Icon name="face" size={18} />
            <span className="profile-editor-row-name" id={faceId}>
              Face Reveal
            </span>
            <Toggle
              aria-labelledby={faceId}
              checked={faceEnabled}
              disabled={inactive}
              onCheckedChange={(next) =>
                update((current) => withFaceRevealEnabled(current, next))
              }
            />
          </div>
          {faceEnabled && (
            <div className="profile-editor-face">
              <ImageSlot
                variant="tile"
                label="Face Reveal photo"
                purpose="face"
                noun="Face Reveal photo"
                value={faceImage}
                description={readEditorField(state, faceAlt)}
                descriptionInvalid={Boolean(
                  state.inputs[JSON.stringify(faceAlt)],
                )}
                ownerId={controller.identity.ownerId}
                disabled={inactive}
                onPendingChange={pendingImage("face")}
                onReady={(assetId) => {
                  const current = controller.store.getState().working;
                  if (!current)
                    throw new Error("Open your draft before adding the photo.");
                  const previous = current.profile.faceReveal.image;
                  controller.update({
                    ...current,
                    profile: {
                      ...current.profile,
                      faceReveal: {
                        ...current.profile.faceReveal,
                        image: { assetId, alt: previous?.alt ?? "" },
                      },
                    },
                  });
                }}
                onRemove={() => {
                  const current = controller.store.getState().working;
                  if (!current) return;
                  controller.clearInput(faceAlt);
                  controller.update(withoutFaceImage(current));
                }}
                onDescription={(value) =>
                  editEditorField(controller, faceAlt, value)
                }
              />
              <p className="profile-editor-note">
                Publishing Face Reveal makes this photo publicly accessible,
                even before anyone reveals it.
              </p>
              {faceRevealIncomplete(draft) && (
                <p role="alert" className="profile-editor-issue">
                  Add the second photo or turn Face Reveal off to publish.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <DraftField
        controller={controller}
        disabled={inactive}
        label="Name"
        path={["profile", "name"]}
        publicationField="name"
      />
      <div className="profile-editor-suggestions">
        {suggestion.kind === "ready" ? (
          <>
            {suggestion.name.trim() && (
              <span className="profile-editor-suggested">
                <Icon name="user" size={16} />
                <strong>{suggestion.name}</strong>
                <Button
                  size="s"
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
                </Button>
              </span>
            )}
            {!suggestion.photoAvailable && (
              <p className="profile-editor-note">
                Your account has no supported photo.
              </p>
            )}
            <Button
              size="s"
              kind="ghost"
              disabled={inactive}
              onClick={() => setSuggestion({ kind: "idle" })}
            >
              Dismiss account suggestions
            </Button>
          </>
        ) : (
          <Button
            size="s"
            kind="ghost"
            icon="user"
            disabled={inactive || suggestion.kind === "loading"}
            onClick={() => void suggest()}
          >
            {suggestion.kind === "loading"
              ? "Checking account suggestions..."
              : "Check my account suggestions"}
          </Button>
        )}
        {suggestion.kind === "unavailable" && (
          <p role="alert" className="profile-editor-issue">
            Account suggestions are unavailable. Enter your name and upload an
            avatar, or try again.
          </p>
        )}
        <p role="status" className="profile-editor-note">
          {message}
        </p>
      </div>
      <DraftField
        controller={controller}
        disabled={inactive}
        label="Bio"
        path={["profile", "bio"]}
        multiline
        publicationField="bio"
      />
      <DraftField
        controller={controller}
        disabled={inactive}
        label="Location"
        path={["profile", "location"]}
        lead="pin"
        publicationField="location"
      />
      {missing.length > 0 && (
        <p className="profile-editor-issue">
          Still needed in your profile: {missing.join(", ")}. Sample content
          does not count.
        </p>
      )}
      <div className="editor-legacy">
        <SocialLinksControl controller={controller} disabled={inactive} />
      </div>
      <DecorationGallery
        open={gallery}
        draft={draft}
        disabled={inactive}
        onChoose={(id) => update((current) => withDecoration(current, id))}
        onClose={() => setGallery(false)}
      />
    </section>
  );
}
