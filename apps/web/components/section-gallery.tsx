"use client";

import {
  appearanceAttributes,
  applyAppearance,
  componentRegistry,
  displayAppearance,
  PortfolioSection,
  projectPortfolio,
} from "@hasaweb/components";
import type { ComponentType, DraftDoc } from "@hasaweb/schema";
import { createComponent, draftSchema } from "@hasaweb/schema";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { addEditorComponent } from "../lib/editor/components";
import { EDITOR_PREVIEW_STYLE } from "../lib/editor/preview-document";
import { sectionTitle } from "../lib/editor/sections";
import { Dialog, Icon } from "./workbench";

// Gallery order from Figma 411:4431.
const ORDER: readonly ComponentType[] = [
  "projects",
  "skills",
  "work-experience",
  "text",
  "github",
  "contact",
  "social-links",
  "resume",
];

// Add section (Figma 411:4431): one tile per component type, each a scaled
// render of that type's sample content in the owner's theme. A single-instance
// type that is already on the page shows as added.
export function SectionGallery({
  open,
  controller,
  disabled,
  onClose,
  onAdded,
}: {
  open: boolean;
  controller: DraftController;
  disabled: boolean;
  onClose(): void;
  onAdded(id: string): void;
}) {
  const state = useStore(controller.store);
  const [error, setError] = useState("");
  const draft = state.working;
  return (
    <Dialog
      open={open && Boolean(draft)}
      title="Add section"
      width={760}
      onClose={() => {
        setError("");
        onClose();
      }}
    >
      {draft && (
        <ul className="section-gallery">
          {ORDER.map((type) => {
            const added =
              componentRegistry[type].singleton &&
              draft.components.some((item) => item.type === type);
            const title = sectionTitle(type);
            return (
              <li key={type}>
                <button
                  type="button"
                  className="section-gallery-tile"
                  aria-label={`Add ${title}`}
                  disabled={disabled || added}
                  data-added={added ? "" : undefined}
                  onClick={() => {
                    const id = addEditorComponent(controller, type);
                    if (!id) {
                      setError(
                        "This section can't be added. Shorten the draft to make room.",
                      );
                      return;
                    }
                    setError("");
                    onAdded(id);
                  }}
                >
                  <SectionThumbnail type={type} draft={draft} />
                  <span className="section-gallery-label">
                    {title}
                    {added && <Icon name="check" size={14} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="section-gallery-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

// A fixed sample calendar, so the GitHub tile shows a graph without a fetch.
const sampleGraph = {
  username: "example",
  fetchedAt: "2026-06-30T00:00:00.000Z",
  days: Array.from({ length: 182 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    count: ((index * 7) % 11) % 5,
  })),
};

function SectionThumbnail({
  type,
  draft,
}: {
  type: ComponentType;
  draft: DraftDoc;
}) {
  const { appearance, links } = draft;
  const [target, setTarget] = useState<HTMLElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a tile depends on the theme and links, not every draft edit.
  const component = useMemo(
    () =>
      projectPortfolio(
        draftSchema.parse({
          ...draft,
          samples: {},
          components: [
            {
              ...createComponent(type, `gallery-${type}`),
              data: componentRegistry[type].sample(),
            },
          ],
        }),
        {
          resolveAsset: () => ({ state: "unavailable" }),
          assetOrigins: [],
          graph: sampleGraph,
        },
      ).components[0],
    [type, links],
  );
  const attributes = Object.entries({
    ...appearanceAttributes(displayAppearance(appearance)),
    "data-color-mode": appearance.colorMode === "dark" ? "dark" : "light",
  })
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");
  // The frame holds the portfolio stylesheet and the theme; the renderer's
  // markup is portalled into it. It runs no script.
  const shell = `<!doctype html><html lang="en" ${attributes}><head><meta charset="utf-8"><link rel="stylesheet" href="${EDITOR_PREVIEW_STYLE}"></head><body><div class="pf-portfolio"><main></main></div></body></html>`;
  return (
    <span className="section-gallery-thumb" aria-hidden="true">
      <iframe
        title={sectionTitle(type)}
        tabIndex={-1}
        srcDoc={shell}
        sandbox="allow-same-origin"
        onLoad={(event) => {
          const frame = event.currentTarget.contentDocument;
          // A custom palette reaches the frame through the CSSOM.
          if (frame)
            applyAppearance(
              frame.documentElement,
              displayAppearance(appearance),
            );
          setTarget(frame?.querySelector("main") ?? null);
        }}
      />
      {target?.isConnected &&
        component &&
        createPortal(<PortfolioSection component={component} />, target)}
    </span>
  );
}
