import {
  type AppearanceModel,
  AssetImage,
  appearanceAttributes,
  PortfolioAvatar,
  PortfolioLayout,
  PortfolioProfile,
  PortfolioProject,
  PortfolioResume,
  PortfolioSection,
} from "@hasaweb/components";
import {
  assetSchema,
  componentModelSchema,
  fileSchema,
  modelAssetUrls,
  normalizeDisplayStrings,
  profileAssetUrls,
  profileModelSchema,
  projectModelSchema,
  withinBounds,
} from "@hasaweb/components/model";
import { isWebUrl } from "@hasaweb/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { partSchema, type RenderPart, renderPart } from "./parts";
import type { RenderContext } from "./response-policy";

export type { RenderContext } from "./response-policy";
export {
  PAGE_UNAVAILABLE_HTML,
  portfolioHeaders,
  unavailableResponse,
} from "./response-policy";

const imagePartSchema = z.strictObject({
  kind: z.literal("asset"),
  asset: assetSchema,
  usage: z.enum(["avatar", "banner", "image"]),
  decoration: z.enum(["none", "cat", "hands"]).default("none"),
  // Avatar only: the enabled Face Reveal photo.
  faceReveal: assetSchema.optional(),
});
export type PlatformAssets = {
  cssUrl: string;
  scriptUrl: string;
  origin?: string;
};
export const FRAGMENT_BOUNDS = {
  maxNodes: 256,
  maxDepth: 32,
  maxString: 4096,
  maxBytes: 12_288,
  outputBudget: { maxBytes: 262_144, fixedMarkupBytes: 24_576 },
};
export const FRAGMENT_MAX_OUTPUT_BYTES = 262_144;
const fragmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), entry: projectModelSchema }),
  z.strictObject({
    kind: z.literal("components"),
    components: z.array(componentModelSchema),
  }),
  z.strictObject({ kind: z.literal("profile"), profile: profileModelSchema }),
  z.strictObject({
    kind: z.literal("component"),
    component: componentModelSchema,
  }),
  z.strictObject({ kind: z.literal("resume-page"), file: fileSchema }),
]);
export type RenderFragment =
  | z.infer<typeof fragmentSchema>
  | RenderPart
  | z.infer<typeof imagePartSchema>;
export type FragmentResult =
  | { status: "ready"; html: string }
  | { status: "needs_partitioning" }
  | { status: "invalid" };
export function renderFragment(
  input: unknown,
  { assetOrigins = [] }: { assetOrigins?: readonly string[] } = {},
): FragmentResult {
  if (!withinBounds(input, FRAGMENT_BOUNDS))
    return { status: "needs_partitioning" };
  const part = partSchema.safeParse(input);
  if (part.success) return { status: "ready", html: renderPart(part.data) };
  const image = imagePartSchema.safeParse(input);
  if (image.success) {
    const { asset, usage, decoration, faceReveal } = image.data;
    if (faceReveal && usage !== "avatar") return { status: "invalid" };
    if (
      [asset, faceReveal].some(
        (item) =>
          item?.state === "ready" &&
          !assetOrigins.includes(new URL(item.url).origin),
      )
    )
      return { status: "invalid" };
    const html = renderToStaticMarkup(
      usage === "avatar" ? (
        <PortfolioAvatar
          asset={asset}
          decoration={decoration}
          faceReveal={faceReveal}
        />
      ) : (
        <AssetImage asset={asset} kind={usage} />
      ),
    );
    return new TextEncoder().encode(html).byteLength > FRAGMENT_MAX_OUTPUT_BYTES
      ? { status: "needs_partitioning" }
      : { status: "ready", html };
  }
  const parsed = fragmentSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const fragment = parsed.data;
  const components =
    fragment.kind === "components"
      ? fragment.components
      : fragment.kind === "component"
        ? [fragment.component]
        : [];
  const ready = (image: { state: string; url?: string }) =>
    image.state === "ready" && image.url ? [image.url] : [];
  const urls =
    fragment.kind === "profile"
      ? profileAssetUrls(fragment.profile)
      : fragment.kind === "project"
        ? ready(fragment.entry.image)
        : fragment.kind === "resume-page"
          ? fragment.file.state === "ready"
            ? [fragment.file.url, fragment.file.viewUrl]
            : []
          : modelAssetUrls(components);
  if (urls.some((url) => !assetOrigins.includes(new URL(url).origin)))
    return { status: "invalid" };
  const html = renderToStaticMarkup(
    fragment.kind === "profile" ? (
      <PortfolioProfile profile={normalizeDisplayStrings(fragment.profile)} />
    ) : fragment.kind === "project" ? (
      <PortfolioProject entry={normalizeDisplayStrings(fragment.entry)} />
    ) : fragment.kind === "resume-page" ? (
      <PortfolioResume file={fragment.file} />
    ) : (
      components.map((component) => (
        <PortfolioSection
          key={component.id}
          component={normalizeDisplayStrings(component)}
        />
      ))
    ),
  );
  if (new TextEncoder().encode(html).byteLength > FRAGMENT_MAX_OUTPUT_BYTES)
    return { status: "needs_partitioning" };
  return { status: "ready", html };
}
function platformUrl(value: string, origin: string | undefined): string {
  if (!/^\/platform\/[a-f0-9]{16,64}[a-z0-9._-]*\.(?:css|js)$/.test(value))
    throw new Error("Platform assets require immutable content-hashed paths");
  if (origin && (!isWebUrl(origin) || new URL(origin).origin !== origin))
    throw new Error("Expected a platform asset origin");
  return `${origin ?? ""}${value}`;
}
function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
// The stylesheet comes first so the browser fetches both platform files in
// parallel. The script is deliberately render-blocking: its first statement
// applies the visitor's stored light/dark choice before <body> is parsed.
// Appearance attributes are validated against the approved catalog.
export function documentShell({
  markup,
  title,
  context,
  assets,
  appearance,
}: {
  markup: string;
  title: string;
  context: RenderContext;
  assets: PlatformAssets;
  appearance: AppearanceModel;
}): string {
  const attributes = Object.entries(appearanceAttributes(appearance))
    .map(([name, value]) => ` ${name}="${escapeText(value)}"`)
    .join("");
  return `<!doctype html><html lang="en"${attributes}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${context === "preview" ? '<meta name="robots" content="noindex,nofollow,noarchive">' : ""}<title>${escapeText(title)}</title><link rel="stylesheet" href="${platformUrl(assets.cssUrl, assets.origin)}"><script src="${platformUrl(assets.scriptUrl, assets.origin)}"></script></head><body>${markup}</body></html>`;
}
export function portfolioDocumentFrame() {
  const marker = "HASA_CONTROLLED_PAGE_FRAME";
  const html = renderToStaticMarkup(
    <PortfolioLayout>{marker}</PortfolioLayout>,
  );
  const [open, close] = html.split(marker);
  if (!open || !close) throw new Error("Portfolio frame missing");
  return { open, close };
}
