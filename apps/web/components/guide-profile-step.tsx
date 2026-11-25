"use client";

import { BIO_MAX, clearSample } from "@hasaweb/schema";
import { useEffect, useId, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import { profileSuggestions } from "../lib/editor/provider-suggestions";
import { DraftField } from "./draft-field";
import { ImageSlot } from "./image-slot";
import { Button, Icon } from "./workbench";
import "./profile-editor.css";

type Suggestion = { name: string; photoAvailable: boolean } | null;

// The Profile step (Figma 471:11559, provider suggestions 460:10310): the
// profile card is the form. The banner and avatar use the shared image slots
// and crop dialogs; the name sits on the card and the bio below it. The
// sign-in account's name and photo are offered, never applied: Use this name
// and Apply crop are the only ways to accept them.
export function GuideProfile(props: {
  controller: DraftController;
  disabled: boolean;
}) {
  return <Card key={props.controller.scopeKey} {...props} />;
}

function Card({
  controller,
  disabled,
}: {
  controller: DraftController;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const nameId = useId();
  const [suggestion, setSuggestion] = useState<Suggestion>(null);
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  useEffect(() => {
    const request = new AbortController();
    profileSuggestions({ ...controller.identity, signal: request.signal })
      .then(setSuggestion)
      .catch(() => {
        // Without suggestions the owner types a name and uploads a photo.
      });
    return () => request.abort();
  }, [controller]);
  const draft = state.working;
  if (!draft) return null;
  const namePath = ["profile", "name"];
  const name = readEditorField(state, namePath);
  const nameUnfinished = Boolean(state.inputs[JSON.stringify(namePath)]);
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
      variant: purpose,
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
  const suggestedName = suggestion?.name.trim() ?? "";
  return (
    <section className="guide-card guide-profile" aria-label="Profile card">
      <div className="guide-profile-images">
        <div data-publication-field="banner">
          <ImageSlot {...image("banner")} />
        </div>
        <div data-publication-field="avatar">
          <ImageSlot
            {...image("avatar")}
            providerPortfolioId={
              suggestion?.photoAvailable
                ? controller.identity.portfolioId
                : undefined
            }
          />
        </div>
      </div>
      <div className="guide-profile-body">
        <div className="guide-profile-name" data-publication-field="name">
          <label htmlFor={nameId} className="wb-visually-hidden">
            Name
          </label>
          <input
            id={nameId}
            value={name}
            placeholder="Your name"
            autoComplete="name"
            disabled={inactive}
            aria-invalid={nameUnfinished || undefined}
            onChange={(event) =>
              editEditorField(controller, namePath, event.target.value)
            }
          />
          <Icon name="pencil" size={16} />
        </div>
        {suggestedName && suggestedName !== name.trim() && (
          <div className="guide-suggested">
            <Icon name="user" size={16} />
            <strong>{suggestedName}</strong>
            <Button
              size="s"
              disabled={inactive}
              onClick={() => {
                editEditorField(controller, namePath, suggestedName);
              }}
            >
              Use this name
            </Button>
          </div>
        )}
        <DraftField
          controller={controller}
          disabled={inactive}
          label="Bio"
          path={["profile", "bio"]}
          multiline
          maxLength={BIO_MAX}
          publicationField="bio"
        />
      </div>
    </section>
  );
}
