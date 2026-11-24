"use client";

import {
  AssetImage,
  appearanceAttributes,
  type DisplayAsset,
  displayAppearance,
  displayDecoration,
  PortfolioAvatar,
} from "@hasaweb/components";
import type { DraftDoc, ImageReference } from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { privateImageUrl } from "../lib/assets/browser";
import { decorationChoices, galleryTools } from "../lib/editor/decorations";
import { EDITOR_PREVIEW_STYLE } from "../lib/editor/preview-document";
import { Dialog, Field, FilterChip, Icon } from "./workbench";

// The decoration gallery (Figma 431:15145; with search and chips 431:15358;
// mobile sheet 433:17711). Each tile is the owner's banner and avatar wearing
// one decoration, drawn as a still by the renderer's avatar markup. Choosing
// a tile saves it at once, so the preview behind the dialog follows.
export function DecorationGallery({
  open,
  draft,
  disabled,
  onChoose,
  onClose,
}: {
  open: boolean;
  draft: DraftDoc;
  disabled: boolean;
  onChoose(id: string | null): void;
  onClose(): void;
}) {
  const entries = appearanceCatalog.decorations;
  const tools = galleryTools(entries);
  return (
    <Dialog
      open={open}
      title="Decoration"
      width={tools.search ? 632 : 578}
      onClose={onClose}
    >
      <Choices
        draft={draft}
        disabled={disabled}
        tools={tools}
        onChoose={onChoose}
      />
    </Dialog>
  );
}

function Choices({
  draft,
  disabled,
  tools,
  onChoose,
}: {
  draft: DraftDoc;
  disabled: boolean;
  tools: ReturnType<typeof galleryTools>;
  onChoose(id: string | null): void;
}) {
  const name = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const choices = decorationChoices(appearanceCatalog.decorations, {
    query,
    category,
  });
  const selected = draft.profile.decorationId ?? null;
  return (
    <>
      {tools.search && (
        <div className="decoration-gallery-tools">
          <Field
            label="Search decorations"
            lead="search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {tools.categories.length > 0 && (
            <div className="decoration-gallery-chips">
              <FilterChip
                selected={category === null}
                onClick={() => setCategory(null)}
              >
                All
              </FilterChip>
              {tools.categories.map((item) => (
                <FilterChip
                  key={item}
                  selected={category === item}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </FilterChip>
              ))}
            </div>
          )}
        </div>
      )}
      <fieldset
        className="decoration-gallery"
        data-columns={tools.search ? 4 : 3}
      >
        <legend className="wb-visually-hidden">Avatar decoration</legend>
        {choices.map((choice) => {
          const checked = choice.id === selected;
          return (
            <label className="decoration-tile" key={choice.id ?? ""}>
              <input
                type="radio"
                className="decoration-tile-input"
                name={name}
                value={choice.id ?? ""}
                checked={checked}
                disabled={disabled}
                onChange={() => onChoose(choice.id)}
              />
              <DecorationThumbnail
                draft={draft}
                decorationId={choice.id ?? undefined}
              />
              <span className="decoration-tile-name">{choice.name}</span>
              {checked && (
                <span className="decoration-tile-check">
                  <Icon name="check" size={14} />
                </span>
              )}
            </label>
          );
        })}
      </fieldset>
      {choices.length === 0 && (
        <p className="decoration-gallery-empty">No matches</p>
      )}
    </>
  );
}

function ownerImage(
  image: ImageReference | undefined,
  purpose: "avatar" | "banner",
): DisplayAsset {
  return image
    ? {
        state: "ready",
        url: new URL(privateImageUrl(image.assetId, purpose), location.origin)
          .href,
        alt: "",
      }
    : { state: "missing" };
}

// The frame holds the portfolio stylesheet and the owner's theme; the
// renderer's markup is portalled into it, and the avatar is moved to the
// tile's centre once laid out. It runs no script.
function DecorationThumbnail({
  draft,
  decorationId,
}: {
  draft: DraftDoc;
  decorationId: string | undefined;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const { appearance, profile } = draft;
  const attributes = Object.entries({
    ...appearanceAttributes(displayAppearance(appearance)),
    "data-color-mode": appearance.colorMode === "dark" ? "dark" : "light",
  })
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
  const shell = `<!doctype html><html lang="en" ${attributes}><head><meta charset="utf-8"><link rel="stylesheet" href="${EDITOR_PREVIEW_STYLE}"></head><body><div class="pf-portfolio"></div></body></html>`;
  const decoration = displayDecoration(decorationId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-centre when the portrait or decoration changes.
  useLayoutEffect(() => {
    const element = stage.current;
    const frame = element?.querySelector<HTMLElement>(".pf-avatar-frame");
    const view = element?.ownerDocument.defaultView;
    if (!element || !frame || !view) return;
    element.style.translate = "";
    const box = frame.getBoundingClientRect();
    const dx = view.innerWidth / 2 - (box.left + box.width / 2);
    const dy = view.innerHeight * 0.56 - (box.top + box.height / 2);
    element.style.translate = `${dx}px ${dy}px`;
  }, [target, decoration, profile.avatar?.assetId]);
  return (
    <span className="decoration-tile-thumb" aria-hidden="true">
      <iframe
        title="Decoration preview"
        tabIndex={-1}
        srcDoc={shell}
        sandbox="allow-same-origin"
        onLoad={(event) =>
          setTarget(
            event.currentTarget.contentDocument?.querySelector(
              ".pf-portfolio",
            ) ?? null,
          )
        }
      />
      {target?.isConnected &&
        createPortal(
          <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                inset: "0 0 auto",
                height: "40%",
                overflow: "hidden",
              }}
            >
              <AssetImage
                asset={ownerImage(profile.banner, "banner")}
                kind="banner"
              />
            </div>
            <div ref={stage} style={{ position: "absolute", top: 0, left: 0 }}>
              <PortfolioAvatar
                asset={ownerImage(profile.avatar, "avatar")}
                decoration={decoration}
                still
              />
            </div>
          </div>,
          target,
        )}
    </span>
  );
}
