import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyAppearance, clearAppearance } from "./appearance";
import {
  modelAssetUrls,
  type PortfolioModel,
  parsePortfolioModel,
  profileAssetUrls,
} from "./model";
import { Portfolio } from "./portfolio";
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
export function mountPreview(
  element: HTMLElement,
  model: PortfolioModel,
  options: PreviewOptions,
) {
  const validated = trustedModel(model, options);
  if (!validated) throw new Error("Invalid display model");
  const root = createRoot(element);
  const documentElement = element.ownerDocument.documentElement;
  let disposed = false;
  let cleanup = () => {};
  // The preview shows the owner's saved initial mode. A toggle inside the
  // preview lasts until that saved mode changes and is never stored.
  let explicit: VisitorMode | undefined;
  let savedMode: string | undefined;
  const store: ModeStore = {
    read: () => explicit,
    write: (mode) => {
      explicit = mode;
    },
  };
  const update = (input: unknown): boolean => {
    if (disposed) return false;
    const next = trustedModel(input, options);
    if (!next) return false;
    cleanup();
    const mode = next.appearance?.colorMode ?? "system";
    if (mode !== savedMode) explicit = undefined;
    savedMode = mode;
    applyAppearance(documentElement, next.appearance);
    flushSync(() => root.render(<Portfolio model={next} />));
    cleanup = installSite(element, { store });
    return true;
  };
  update(validated);
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
export type {
  PreviewIdentity,
  PreviewSelection,
  PreviewState,
} from "./preview-transport";
export {
  attachPreviewReceiver as attachPreviewBridge,
  connectPreviewBridge,
} from "./preview-transport";
