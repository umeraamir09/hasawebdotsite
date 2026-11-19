"use client";

import {
  type DraftDoc,
  resolveSeo,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
} from "@hasaweb/schema";
import { useId, useState } from "react";
import { useStore } from "zustand";
import { privateImageUrl } from "../lib/assets/browser";
import type { DraftController } from "../lib/draft/controller";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import { ImageUpload } from "./image-upload";

type Seo = DraftDoc["seo"];
type SeoText = "title" | "description";

// Clearing a field removes the override, so the profile default applies.
function clearOverride(controller: DraftController, key: keyof Seo) {
  const draft = controller.store.getState().working;
  if (!draft) return;
  const seo = { ...draft.seo };
  delete seo[key];
  if (key !== "ogImage") controller.clearInput(["seo", key]);
  controller.update({ ...draft, seo });
}

function OverrideField({
  controller,
  disabled,
  field,
  label,
  max,
  placeholder,
  note,
}: {
  controller: DraftController;
  disabled: boolean;
  field: SeoText;
  label: string;
  max: number;
  placeholder: string;
  note: string;
}) {
  const id = useId();
  const state = useStore(controller.store);
  const value = readEditorField(state, ["seo", field]);
  const props = {
    id,
    value,
    placeholder,
    maxLength: max,
    disabled,
    "aria-describedby": `${id}-note ${id}-count`,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      const next = event.target.value;
      if (next === "") clearOverride(controller, field);
      else editEditorField(controller, ["seo", field], next);
    },
  };
  return (
    <div className="editor-field" data-publication-field={`seo-${field}`}>
      <label htmlFor={id}>{label}</label>
      {field === "description" ? (
        <textarea {...props} rows={4} />
      ) : (
        <input {...props} />
      )}
      <span className="sharing-field-meta">
        <span className="editor-muted" id={`${id}-note`}>
          {note}
        </span>
        <span className="editor-muted" id={`${id}-count`}>
          {Array.from(value).length}/{max}
        </span>
      </span>
    </div>
  );
}

export function SharingControls({
  controller,
  disabled,
}: {
  controller: DraftController;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const draft = state.working;
  if (!draft) return null;
  // The card shows the same resolved values that Publish writes into pages.
  const resolved = resolveSeo(draft);
  const address = `${draft.requestedSubdomain ?? "your-address"}.hasaweb.site`;
  const image = resolved.image;
  return (
    <section aria-label="Search and sharing" className="sharing-controls">
      <h2>Search &amp; sharing</h2>
      <p className="editor-muted">
        Choose what people see when your link is shared or appears in search.
        Case studies and your resume page add their own name to this title.
      </p>
      <OverrideField
        controller={controller}
        disabled={disabled}
        field="title"
        label="Page title"
        max={SEO_TITLE_MAX}
        placeholder={draft.profile.name.trim() || "Your name"}
        note="Leave empty to use your name."
      />
      <OverrideField
        controller={controller}
        disabled={disabled}
        field="description"
        label="Description"
        max={SEO_DESCRIPTION_MAX}
        placeholder={
          resolved.overridden.description ? "" : resolved.description
        }
        note="Leave empty to use the start of your bio."
      />
      <figure className="sharing-card" aria-label="Sharing preview">
        <div className="sharing-card-image">
          {image && unavailable !== image.assetId ? (
            // biome-ignore lint/performance/noImgElement: Private owner assets are same-origin, authorized and no-store; image optimization is disabled.
            <img
              src={privateImageUrl(image.assetId, image.purpose)}
              alt=""
              onError={() => setUnavailable(image.assetId)}
            />
          ) : (
            <span>{image ? "Image unavailable" : "No sharing image"}</span>
          )}
        </div>
        <figcaption>
          <span className="sharing-card-address">{address}</span>
          <strong className="sharing-card-title">{resolved.title}</strong>
          {resolved.description && (
            <span className="sharing-card-description">
              {resolved.description}
            </span>
          )}
        </figcaption>
      </figure>
      <div data-publication-field="seo-ogImage">
        <ImageUpload
          key={`${controller.scopeKey}:og`}
          label="Sharing image"
          purpose="og"
          noun="sharing image"
          value={draft.seo.ogImage}
          description="Your sharing image"
          describe={false}
          ownerId={controller.identity.ownerId}
          disabled={disabled}
          onPendingChange={(pending) =>
            controller.store.setState((current) => ({
              pendingImages: { ...current.pendingImages, og: pending },
            }))
          }
          onReady={(assetId) => {
            if (!controller.edit(["seo", "ogImage"], { assetId }))
              throw new Error(
                "The crop is ready but the draft could not accept it. Retry after resolving unfinished input.",
              );
          }}
          onRemove={() => clearOverride(controller, "ogImage")}
          onDescription={() => {}}
        />
        <p className="editor-muted">
          {resolved.overridden.image
            ? "Remove it to use your banner again."
            : "Your banner is used until you add one. Sharing cards show a 1.91:1 image."}
        </p>
      </div>
      <p className="editor-muted">
        Changes go live when you publish. Search engines and apps that already
        fetched your page may show older details for a while.
      </p>
    </section>
  );
}
