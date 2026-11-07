"use client";

import {
  connectPreviewBridge,
  type PreviewIdentity,
  type PreviewSelection,
  type PreviewState,
} from "@hasaweb/components/browser";
import { projectPortfolioCancellable } from "@hasaweb/components/model";
import type { DraftDoc } from "@hasaweb/schema";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolvePreviewImages } from "../lib/assets/browser";

export function EditorPreview({
  owner,
  draft,
  documentUrl,
  selection,
  onSelect,
}: {
  owner: PreviewIdentity;
  draft: DraftDoc;
  documentUrl: string;
  selection: PreviewSelection;
  onSelect(selection: PreviewSelection): void;
}) {
  const [channel] = useState(() => crypto.randomUUID());
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const [state, setState] = useState<PreviewState>({
    kind: "connecting",
    requested: 0,
    displayed: null,
  });
  const frame = useRef<HTMLIFrameElement>(null);
  const connection = useRef<ReturnType<typeof connectPreviewBridge> | null>(
    null,
  );
  const { ownerId, portfolioId } = owner;
  const images = useMemo(
    () => ({ ownerId, portfolioId, cache: new Map<string, string>() }),
    [ownerId, portfolioId],
  );
  const currentSelection = useRef(selection);
  currentSelection.current = selection;
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    if (!frame.current) return;
    const bridge = connectPreviewBridge({
      iframe: frame.current,
      channel,
      identity: { ownerId, portfolioId },
      origin: location.origin,
      onState: (next) => {
        setState(next);
        if (next.kind === "displayed")
          connection.current?.select(currentSelection.current);
      },
      onSelect: (value) => select.current(value),
    });
    connection.current = bridge;
    bridge.request(async (signal) => {
      const current = latestDraft.current;
      const assets = await resolvePreviewImages({
        ownerId,
        draft: current,
        signal,
        cache: images.cache,
      });
      return projectPortfolioCancellable(current, assets, signal);
    });
    return () => {
      connection.current = null;
      bridge.dispose();
    };
  }, [channel, ownerId, portfolioId, images]);
  // A layout effect issues the request in the same commit as the edit. The
  // status then never reads "Preview up to date" while an older draft is
  // displayed; React 19 may defer passive effects until after the browser
  // yields, which left that window open.
  useLayoutEffect(() => {
    connection.current?.request(async (signal) => {
      const assets = await resolvePreviewImages({
        ownerId,
        draft,
        signal,
        cache: images.cache,
      });
      return projectPortfolioCancellable(draft, assets, signal);
    });
  }, [draft, ownerId, images]);
  useEffect(() => {
    connection.current?.select(selection);
  }, [selection]);
  return (
    <section className="editor-preview" aria-label="Private live preview">
      <div className="editor-preview-toolbar">
        <fieldset className="editor-width-controls" aria-label="Preview width">
          <button
            type="button"
            aria-pressed={width === "desktop"}
            onClick={() => setWidth("desktop")}
          >
            Desktop
          </button>
          <button
            type="button"
            aria-pressed={width === "mobile"}
            onClick={() => setWidth("mobile")}
          >
            Mobile
          </button>
        </fieldset>
        <a
          className="editor-full-preview-link"
          href="/preview"
          target="_blank"
          rel="noopener"
        >
          Open full-page preview (saved draft)
        </a>
        <span
          role="status"
          data-preview-state={state.kind}
          data-preview-sequence={state.requested}
          data-preview-displayed={state.displayed ?? ""}
        >
          {state.kind === "displayed"
            ? "Preview up to date"
            : state.kind === "rejected"
              ? state.displayed === null
                ? "Preview unavailable. Reopen the editor to try again."
                : "Preview could not refresh. Your last displayed version remains."
              : "Updating preview..."}
        </span>
      </div>
      <div className="editor-preview-stage">
        <iframe
          ref={frame}
          title="Your private portfolio preview"
          src={`${documentUrl}#channel=${encodeURIComponent(channel)}`}
          className={`editor-preview-frame editor-preview-${width}`}
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </section>
  );
}
