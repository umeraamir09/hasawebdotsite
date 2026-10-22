"use client";

import { clearSample } from "@hasaweb/schema";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import { ImageUpload } from "./image-upload";

export function ProfileImages({
  controller,
  disabled,
}: {
  controller: DraftController;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  if (!state.working) return null;
  return (
    <div className="profile-images">
      {(["avatar", "banner"] as const).map((purpose) => (
        <ImageUpload
          key={`${controller.scopeKey}:${purpose}`}
          label={purpose === "avatar" ? "Avatar" : "Banner"}
          purpose={purpose}
          value={state.working?.profile[purpose]}
          description={readEditorField(state, ["profile", purpose, "alt"])}
          descriptionInvalid={Boolean(
            state.inputs[JSON.stringify(["profile", purpose, "alt"])],
          )}
          ownerId={controller.identity.ownerId}
          disabled={disabled}
          onReady={(assetId) => {
            const previous =
              controller.store.getState().working?.profile[purpose];
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
            const draft = controller.store.getState().working;
            if (draft?.samples[`profile.${purpose}`])
              controller.update(clearSample(draft, `profile.${purpose}`));
          }}
          onRemove={() => {
            const draft = controller.store.getState().working;
            if (!draft) return;
            const profile = { ...draft.profile };
            delete profile[purpose];
            controller.clearInput(["profile", purpose, "alt"]);
            controller.update(
              clearSample({ ...draft, profile }, `profile.${purpose}`),
            );
          }}
          onDescription={(value) =>
            editEditorField(controller, ["profile", purpose, "alt"], value)
          }
        />
      ))}
    </div>
  );
}
