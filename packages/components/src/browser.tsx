import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { type PortfolioModel, parsePortfolioModel } from "./model";
import { Portfolio } from "./portfolio";
import { installSite } from "./site";

export type PreviewOptions = { assetOrigins: readonly string[] };
function trustedModel(
  input: unknown,
  options: PreviewOptions,
): PortfolioModel | undefined {
  const model = parsePortfolioModel(input);
  if (!model) return undefined;
  const images = [
    model.profile.avatar,
    model.profile.banner,
    ...model.components.flatMap((component) =>
      component.type === "projects"
        ? component.data.entries.map((entry) => entry.image)
        : [],
    ),
  ];
  if (
    images.some(
      (image) =>
        image.state === "ready" &&
        !options.assetOrigins.includes(new URL(image.url).origin),
    )
  )
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
export function attachPreviewBridge({
  target,
  parentWindow,
  parentOrigin,
  channel,
  assetOrigins,
}: {
  target: Pick<ReturnType<typeof mountPreview>, "update">;
  parentWindow: Window;
  parentOrigin: string;
  channel: string;
  assetOrigins: readonly string[];
}): () => void {
  if (
    parentOrigin === "null" ||
    new URL(parentOrigin).origin !== parentOrigin ||
    !/^https?:/.test(parentOrigin) ||
    !channel ||
    channel.length > 128
  )
    throw new Error("Invalid preview bridge configuration");
  let revision = -1;
  const receive = (event: MessageEvent<unknown>) => {
    if (
      event.source !== parentWindow ||
      event.origin !== parentOrigin ||
      !event.data ||
      typeof event.data !== "object" ||
      !("channel" in event.data) ||
      event.data.channel !== channel ||
      !("revision" in event.data) ||
      typeof event.data.revision !== "number" ||
      !Number.isSafeInteger(event.data.revision) ||
      event.data.revision <= revision ||
      !("model" in event.data)
    )
      return;
    const model = trustedModel(event.data.model, { assetOrigins });
    if (model && target.update(model)) revision = event.data.revision;
  };
  window.addEventListener("message", receive);
  return () => window.removeEventListener("message", receive);
}
