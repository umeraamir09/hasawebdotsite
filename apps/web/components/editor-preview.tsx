"use client";

import {
  connectPreviewBridge,
  type PreviewAction,
  type PreviewIdentity,
  type PreviewScheme,
  type PreviewSelection,
  type PreviewState,
} from "@hasaweb/components/browser";
import { projectPortfolioCancellable } from "@hasaweb/components/model";
import type { DraftDoc } from "@hasaweb/schema";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { resolvePreviewImages } from "../lib/assets/browser";
import {
  graphRevision,
  subscribeGraphRevision,
} from "../lib/editor/github-graph";

export type PreviewDevice = "desktop" | "mobile";
const FRAME_WIDTH = { desktop: 1120, mobile: 390 } as const;

export function EditorPreview({
  owner,
  draft,
  documentUrl,
  selection = null,
  onSelect,
  label = "Private live preview",
  device,
  scheme,
  onScheme,
  onAction,
  canvasActions = true,
}: {
  owner: PreviewIdentity;
  draft: DraftDoc;
  documentUrl: string;
  // Setup Review shows the draft without selecting or editing sections.
  selection?: PreviewSelection | null;
  onSelect?(selection: PreviewSelection): void;
  label?: string;
  // The editor shell owns the device and scheme controls in its top bar and
  // fits the frame to the canvas. Without `device`, the preview shows its
  // own toolbar, as setup Review does.
  device?: PreviewDevice | undefined;
  scheme?: PreviewScheme | null | undefined;
  onScheme?(mode: PreviewScheme): void;
  onAction?(action: PreviewAction, id: string): void;
  // False while the mobile dock holds the section actions.
  canvasActions?: boolean;
}) {
  const [channel] = useState(() => crypto.randomUUID());
  const [ownWidth, setWidth] = useState<PreviewDevice>("desktop");
  const width = device ?? ownWidth;
  const shell = device !== undefined;
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
  // Setup and Retry change the fetched calendar without changing the draft.
  const graph = useSyncExternalStore(
    subscribeGraphRevision,
    graphRevision,
    () => 0,
  );
  const currentSelection = useRef(selection);
  currentSelection.current = selection;
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const select = useRef(onSelect);
  select.current = onSelect;
  const events = useRef({ onScheme, onAction });
  events.current = { onScheme, onAction };
  const showActions = useRef(canvasActions);
  showActions.current = canvasActions;
  const reported = useRef<PreviewScheme | null>(null);
  useEffect(() => {
    if (!frame.current) return;
    const bridge = connectPreviewBridge({
      iframe: frame.current,
      channel,
      identity: { ownerId, portfolioId },
      origin: location.origin,
      onState: (next) => {
        setState(next);
        if (next.kind === "displayed" && currentSelection.current)
          connection.current?.select(
            currentSelection.current,
            showActions.current,
          );
      },
      onSelect: (value) => select.current?.(value),
      onAction: (action, id) => events.current.onAction?.(action, id),
      onScheme: (mode) => {
        reported.current = mode;
        events.current.onScheme?.(mode);
      },
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new graph revision re-projects the unchanged draft with the freshly fetched calendar.
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
  }, [draft, ownerId, images, graph]);
  useEffect(() => {
    if (selection) connection.current?.select(selection, canvasActions);
  }, [selection, canvasActions]);
  useEffect(() => {
    if (scheme && scheme !== reported.current)
      connection.current?.scheme(scheme);
  }, [scheme]);
  // The shell fits the real 1120 px or 390 px viewport to the canvas.
  const stage = useRef<HTMLElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });
  useLayoutEffect(() => {
    const element = stage.current;
    if (!shell || !element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const inner =
        element.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      const height =
        element.clientHeight -
        Number.parseFloat(style.paddingTop) -
        Number.parseFloat(style.paddingBottom);
      const scale = Math.min(1, inner / FRAME_WIDTH[width]);
      setFit({ scale, height: Math.max(0, height / scale) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shell, width]);
  const status = (
    <span
      role="status"
      className={shell ? "wb-visually-hidden" : undefined}
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
  );
  if (shell)
    return (
      <section
        className="editor-canvas"
        aria-label={label}
        data-device={width}
        ref={stage}
      >
        {status}
        <div
          className="editor-canvas-fit"
          style={{
            width: FRAME_WIDTH[width] * fit.scale,
            height: fit.height * fit.scale || undefined,
          }}
        >
          <iframe
            ref={frame}
            title="Your private portfolio preview"
            src={`${documentUrl}#channel=${encodeURIComponent(channel)}`}
            className="editor-canvas-frame"
            style={{
              width: FRAME_WIDTH[width],
              height: fit.height || undefined,
              transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined,
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </section>
    );
  return (
    <section className="editor-preview" aria-label={label}>
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
        {status}
      </div>
      {/* The stage scrolls a child wider or taller than the space, so it is
          keyboard reachable for scrolling. */}
      <section
        className="editor-preview-stage"
        aria-label="Preview area"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable for keyboard scrolling.
        tabIndex={0}
      >
        <iframe
          ref={frame}
          title="Your private portfolio preview"
          src={`${documentUrl}#channel=${encodeURIComponent(channel)}`}
          className={`editor-preview-frame editor-preview-${width}`}
          sandbox="allow-scripts allow-same-origin"
        />
      </section>
    </section>
  );
}
