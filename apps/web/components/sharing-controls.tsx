"use client";

import {
  SHARING_CARD,
  SHARING_CARD_DECORATIONS,
  SharingCard,
  sharingCardLinks,
  sharingCardPalette,
  sharingCardText,
} from "@hasaweb/components/sharing-card";
import {
  type DraftDoc,
  resolveSeo,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
} from "@hasaweb/schema";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { privateImageUrl } from "../lib/assets/browser";
import type { DraftController } from "../lib/draft/controller";
import {
  catalogFontFamily,
  findCatalogFont,
  loadCatalogFont,
} from "../lib/editor/catalog-fonts";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import type { PublicationSiteState } from "../lib/editor/use-publication-site";
import { AddressControl } from "./address-control";
import { ImageUpload } from "./image-upload";
import { SitePill } from "./publication-checklist";
import { UnpublishControl } from "./unpublish-control";
import { Area, Button, Field, Icon } from "./workbench";
import "./share-panel.css";

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
}: {
  controller: DraftController;
  disabled: boolean;
  field: SeoText;
  label: string;
  max: number;
  placeholder: string;
}) {
  const state = useStore(controller.store);
  const value = readEditorField(state, ["seo", field]);
  const onChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const next = event.target.value;
    if (next === "") clearOverride(controller, field);
    else editEditorField(controller, ["seo", field], next);
  };
  return (
    <div data-publication-field={`seo-${field}`}>
      {field === "description" ? (
        <Area
          label={label}
          value={value}
          placeholder={placeholder}
          maxLength={max}
          rows={2}
          disabled={disabled}
          onChange={onChange}
        />
      ) : (
        <Field
          label={label}
          value={value}
          placeholder={placeholder}
          maxLength={max}
          disabled={disabled}
          onChange={onChange}
        />
      )}
    </div>
  );
}

// The generated card, drawn by the same component Publish renders to PNG,
// from private owner-only image URLs, scaled to the panel's width.
function CardPreview({ draft }: { draft: DraftDoc }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const font = findCatalogFont(draft.appearance.fontId);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setScale((entry?.contentRect.width ?? 0) / SHARING_CARD.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (font) loadCatalogFont(font);
  }, [font]);
  const { profile } = draft;
  const decoration =
    profile.decorationId === "cat" || profile.decorationId === "hands"
      ? profile.decorationId
      : "none";
  return (
    <div className="sharing-card-generated" ref={box}>
      <div style={{ transform: `scale(${scale})` }}>
        <SharingCard
          palette={sharingCardPalette(
            draft.appearance.themeId,
            draft.appearance.colorMode,
            draft.appearance.customColor,
          )}
          fontFamily={font ? catalogFontFamily(font) : "sans-serif"}
          {...sharingCardText({
            name: profile.name,
            bio: profile.bio,
            location: profile.location,
            links: sharingCardLinks(draft.links),
          })}
          banner={
            profile.banner
              ? privateImageUrl(profile.banner.assetId, "banner")
              : null
          }
          avatar={
            profile.avatar
              ? privateImageUrl(profile.avatar.assetId, "avatar")
              : null
          }
          decoration={decoration}
          decorationImage={
            decoration === "none"
              ? null
              : SHARING_CARD_DECORATIONS[decoration].path
          }
        />
      </div>
    </div>
  );
}

/** Share (Figma 413:7431): address, link preview and Unpublish. */
export function SharingControls({
  controller,
  disabled,
  site,
}: {
  controller: DraftController;
  disabled: boolean;
  site: PublicationSiteState;
}) {
  const state = useStore(controller.store);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const draft = state.working;
  if (!draft) return null;
  // The card shows the same resolved values that Publish writes into pages.
  const resolved = resolveSeo(draft);
  const address = `${draft.requestedSubdomain ?? "your-address"}.hasaweb.site`;
  const image = resolved.image;
  const current = site.site;
  const url = current?.url ?? null;
  return (
    <div className="share-panel">
      {url && current ? (
        <div className="share-address">
          <div className="share-address-row">
            <Icon name="globe" size={18} />
            <span className="share-address-host">{new URL(url).host}</span>
            <SitePill status={current.status} />
          </div>
          {current.status === "published" && (
            <div className="share-address-actions">
              <Button
                size="s"
                icon="copy"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(url)
                    .then(() => setCopied(true))
                    .catch(() => {});
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              <a
                className="wb-button"
                data-kind="secondary"
                data-size="s"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="arrow-up-right" size={14} />
                Open
              </a>
            </div>
          )}
        </div>
      ) : (
        <div className="share-address">
          <AddressControl controller={controller} disabled={disabled} />
        </div>
      )}
      <section aria-label="Search and sharing" className="sharing-controls">
        <h3 className="share-label">Link preview</h3>
        <figure className="sharing-card" aria-label="Sharing preview">
          <div className="sharing-card-image">
            {image.kind === "card" ? (
              <CardPreview draft={draft} />
            ) : unavailable !== image.assetId ? (
              // biome-ignore lint/performance/noImgElement: Private owner assets are same-origin, authorized and no-store; image optimization is disabled.
              <img
                src={privateImageUrl(image.assetId, "og")}
                alt=""
                onError={() => setUnavailable(image.assetId)}
              />
            ) : (
              <span>Image unavailable</span>
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
        <OverrideField
          controller={controller}
          disabled={disabled}
          field="title"
          label="Title"
          max={SEO_TITLE_MAX}
          placeholder={draft.profile.name.trim() || "Your name"}
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
        />
        <div className="editor-legacy" data-publication-field="seo-ogImage">
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
        </div>
      </section>
      {current && (
        <UnpublishControl
          site={current}
          disabled={disabled}
          onUnpublish={site.unpublish}
        />
      )}
    </div>
  );
}
