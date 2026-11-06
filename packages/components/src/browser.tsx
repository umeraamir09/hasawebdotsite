import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  modelAssetUrls,
  type PortfolioModel,
  parsePortfolioModel,
} from "./model";
import { Portfolio } from "./portfolio";
import { installSite } from "./site";

export type PreviewOptions = { assetOrigins: readonly string[] };
function trustedModel(
  input: unknown,
  options: PreviewOptions,
): PortfolioModel | undefined {
  const model = parsePortfolioModel(input);
  if (!model) return undefined;
  const urls = [
    ...[model.profile.avatar, model.profile.banner].flatMap((image) =>
      image.state === "ready" ? [image.url] : [],
    ),
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
  let disposed = false;
  let cleanup = () => {};
  const update = (input: unknown): boolean => {
    if (disposed) return false;
    const next = trustedModel(input, options);
    if (!next) return false;
    cleanup();
    flushSync(() => root.render(<Portfolio model={next} />));
    cleanup = installSite(element);
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
