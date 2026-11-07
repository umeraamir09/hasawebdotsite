"use client";

import { appearanceCatalog } from "@hasaweb/theme";
import { useId } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import {
  faceRevealIncomplete,
  withDecoration,
  withFaceRevealEnabled,
  withoutFaceImage,
} from "../lib/editor/avatar-extras";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import { ImageUpload } from "./image-upload";

const FACE_ALT = ["profile", "faceReveal", "image", "alt"] as const;

// Editor-only controls for the optional avatar decoration and Face Reveal's
// second photo. Onboarding does not mount them. The public pause/play control
// and the reveal interaction itself belong to Phase 38.
export function AvatarExtrasControls({
  controller,
  disabled: blocked = false,
}: {
  controller: DraftController;
  disabled?: boolean;
}) {
  const id = useId();
  const state = useStore(controller.store);
  const draft = state.working;
  if (!draft) return null;
  const disabled =
    blocked || state.suspended || state.error === "owner_changed";
  const selected = draft.profile.decorationId;
  const known = appearanceCatalog.decorations.some(
    (decoration) => decoration.id === selected,
  );
  const { enabled, image } = draft.profile.faceReveal;
  const choose = (next: string | null) => {
    const current = controller.store.getState().working;
    if (!disabled && current) controller.update(withDecoration(current, next));
  };
  const setEnabled = (next: boolean) => {
    const current = controller.store.getState().working;
    if (!disabled && current)
      controller.update(withFaceRevealEnabled(current, next));
  };
  return (
    <section
      aria-label="Avatar decoration and Face Reveal"
      className="appearance-controls avatar-extras"
    >
      <h2>Avatar extras</h2>
      <p className="editor-muted">
        Both are optional and off until you choose them. They appear on your
        portfolio, case studies and resume page after you publish.
      </p>
      <fieldset data-publication-field="decorationId">
        <legend>Avatar decoration</legend>
        {selected !== undefined && !known && (
          <p className="editor-input-note">
            Your saved decoration is no longer available. Choose one or remove
            it.
          </p>
        )}
        <label className="appearance-choice">
          <input
            type="radio"
            name={`${id}-decoration`}
            value=""
            checked={selected === undefined}
            disabled={disabled}
            onChange={() => choose(null)}
          />
          No decoration
        </label>
        {appearanceCatalog.decorations.map((decoration) => (
          <label className="appearance-choice" key={decoration.id}>
            <input
              type="radio"
              name={`${id}-decoration`}
              value={decoration.id}
              checked={selected === decoration.id}
              disabled={disabled}
              onChange={() => choose(decoration.id)}
            />
            {decoration.name}
          </label>
        ))}
        <p className="editor-muted">
          Choose, change or remove it at any time. The preview shows the
          animation. Visitors who prefer reduced motion see a still.
        </p>
      </fieldset>
      <fieldset data-publication-field="faceReveal">
        <legend>Face Reveal</legend>
        <label className="appearance-choice">
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            aria-describedby={`${id}-face-note`}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Add a second photo that visitors can reveal
        </label>
        <p className="editor-muted" id={`${id}-face-note`}>
          Visitors switch between your avatar and a second photo, such as a
          real-face photo you choose. Publishing Face Reveal makes that photo
          publicly accessible, even before anyone reveals it. If you turn it off
          and publish again, it is no longer public. Your private draft keeps
          the photo so you can use it again.
        </p>
        {enabled && (
          <>
            <ImageUpload
              key={`${controller.scopeKey}:face`}
              label="Face Reveal photo"
              purpose="face"
              noun="Face Reveal photo"
              value={image}
              description={readEditorField(state, [...FACE_ALT])}
              descriptionInvalid={Boolean(
                state.inputs[JSON.stringify(FACE_ALT)],
              )}
              ownerId={controller.identity.ownerId}
              disabled={disabled}
              onPendingChange={(pending) =>
                controller.store.setState((current) => ({
                  pendingImages: { ...current.pendingImages, face: pending },
                }))
              }
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
                controller.clearInput([...FACE_ALT]);
                controller.update(withoutFaceImage(current));
              }}
              onDescription={(value) =>
                editEditorField(controller, [...FACE_ALT], value)
              }
            />
            {faceRevealIncomplete(draft) && (
              <p role="alert" className="editor-input-note">
                Add the second photo or turn Face Reveal off. Publishing is
                blocked until then.
              </p>
            )}
          </>
        )}
        {!enabled && image && (
          <p className="editor-muted">
            Your second photo is saved privately in this draft. Turn Face Reveal
            back on to use it again.
          </p>
        )}
      </fieldset>
    </section>
  );
}
