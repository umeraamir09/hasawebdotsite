import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyAppearance, clearAppearance } from "./appearance";
import { pagePathSchema } from "./frames";
import {
  modelAssetUrls,
  type PortfolioModel,
  type PreviewPageModel,
  parsePortfolioModel,
  parsePreviewPageModel,
  previewPageAssetUrls,
  profileAssetUrls,
} from "./model";
import { Portfolio, PortfolioPage } from "./portfolio";
import { installSite, type ModeStore, type VisitorMode } from "./site";

export type PreviewOptions = { assetOrigins: readonly string[] };
function trustedModel(
  input: unknown,
  options: PreviewOptions,
): PortfolioModel | undefined {
  const model = parsePortfolioModel(input);
  if (!model) return undefined;
  const urls = [
    ...profileAssetUrls(model.profile),
    ...modelAssetUrls(model.components),
  ];
  if (urls.some((url) => !options.assetOrigins.includes(new URL(url).origin)))
    return undefined;
  return model;
}
function trustedPage(
  input: unknown,
  options: PreviewOptions,
): PreviewPageModel | undefined {
  const parsed = parsePreviewPageModel(input);
  if (!parsed) return undefined;
  const urls = [
    ...profileAssetUrls(parsed.model.profile),
    ...modelAssetUrls(parsed.model.components),
    ...previewPageAssetUrls(parsed.page),
  ];
  if (urls.some((url) => !options.assetOrigins.includes(new URL(url).origin)))
    return undefined;
  return parsed;
}
type Mountable = { model: PortfolioModel; node: ReactNode };
// Both mounts share this lifecycle: strict parsing, appearance attributes,
// one React root and the same `installSite` behavior as published pages.
function mountDocument(
  element: HTMLElement,
  initial: unknown,
  parse: (input: unknown) => Mountable | undefined,
  store: (savedMode: () => string | undefined) => ModeStore & { reset(): void },
  afterRender: () => void = () => {},
) {
  const validated = parse(initial);
  if (!validated) throw new Error("Invalid display model");
  const root = createRoot(element);
  const documentElement = element.ownerDocument.documentElement;
  let disposed = false;
  let cleanup = () => {};
  let savedMode: string | undefined;
  const modes = store(() => savedMode);
  const update = (input: unknown): boolean => {
    if (disposed) return false;
    const next = parse(input);
    if (!next) return false;
    cleanup();
    const mode = next.model.appearance?.colorMode ?? "system";
    // A toggle lasts until the owner's saved mode changes.
    if (savedMode !== undefined && mode !== savedMode) modes.reset();
    savedMode = mode;
    applyAppearance(documentElement, next.model.appearance);
    flushSync(() => root.render(next.node));
    afterRender();
    cleanup = installSite(element, { store: modes });
    return true;
  };
  update(initial);
  return {
    update,
    dispose() {
      if (!disposed) {
        disposed = true;
        cleanup();
        root.unmount();
        clearAppearance(documentElement);
        delete documentElement.dataset.colorMode;
      }
    },
  };
}
// The live preview keeps a toggle in memory. It survives content edits and
// is never stored.
function memoryStore(): ModeStore & { reset(): void } {
  let explicit: VisitorMode | undefined;
  return {
    read: () => explicit,
    write: (mode) => {
      explicit = mode;
    },
    reset: () => {
      explicit = undefined;
    },
  };
}
export function mountPreview(
  element: HTMLElement,
  model: PortfolioModel,
  options: PreviewOptions,
) {
  return mountDocument(
    element,
    model,
    (input) => {
      const next = trustedModel(input, options);
      return next && { model: next, node: <Portfolio model={next} /> };
    },
    () => memoryStore(),
  );
}
export type PreviewPageOptions = PreviewOptions & {
  // Where the preview mounts its pages, such as `/preview`. Page links point
  // there instead of at the published site's root-relative paths.
  pageBase: string;
  // Tab-scoped storage for the visitor toggle, so the choice follows the
  // owner across preview pages like the published origin storage does.
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
};
const MODE_KEY = "hasaweb-preview-color-mode";
function sessionStore(
  storage: PreviewPageOptions["storage"],
  savedMode: () => string | undefined,
): ModeStore & { reset(): void } {
  const memory = memoryStore();
  return {
    read() {
      try {
        const stored = storage?.getItem(MODE_KEY);
        if (stored) {
          const [saved, mode] = stored.split(":");
          if (saved === savedMode() && (mode === "light" || mode === "dark"))
            return mode;
        }
      } catch {
        // Fall back to the in-memory choice.
      }
      return memory.read();
    },
    write(mode) {
      memory.write(mode);
      try {
        storage?.setItem(MODE_KEY, `${savedMode()}:${mode}`);
      } catch {
        // The toggle still works for this page.
      }
    },
    reset() {
      memory.reset();
      try {
        storage?.removeItem(MODE_KEY);
      } catch {
        // Nothing stored to reset.
      }
    },
  };
}
/**
 * Mounts one full-page preview document: the published page types, rendered
 * from the saved draft. Page links are rewritten under `pageBase`.
 */
export function mountPreviewPage(
  element: HTMLElement,
  input: PreviewPageModel,
  options: PreviewPageOptions,
) {
  const pageBase = options.pageBase.replace(/\/$/, "");
  return mountDocument(
    element,
    input,
    (value) => {
      const next = trustedPage(value, options);
      return (
        next && {
          model: next.model,
          node: <PortfolioPage model={next.model} page={next.page} />,
        }
      );
    },
    (savedMode) => sessionStore(options.storage, savedMode),
    () => {
      for (const link of element.querySelectorAll<HTMLAnchorElement>(
        "a.pf-page-link",
      )) {
        const path = link.getAttribute("href") ?? "";
        if (pagePathSchema.safeParse(path).success)
          link.setAttribute("href", path === "/" ? pageBase : pageBase + path);
      }
    },
  );
}
export type {
  PreviewIdentity,
  PreviewSelection,
  PreviewState,
} from "./preview-transport";
export {
  attachPreviewReceiver as attachPreviewBridge,
  connectPreviewBridge,
} from "./preview-transport";
