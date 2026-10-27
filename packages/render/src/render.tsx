import {
  AssetImage,
  PortfolioAvatar,
  PortfolioLayout,
  PortfolioProfile,
  PortfolioProject,
  PortfolioSection,
} from "@hasaweb/components";
import {
  assetSchema,
  componentModelSchema,
  normalizeDisplayStrings,
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
export { portfolioHeaders, unavailableResponse } from "./response-policy";

const imagePartSchema = z.strictObject({
  kind: z.literal("asset"),
  asset: assetSchema,
  usage: z.enum(["avatar", "banner", "image"]),
  decoration: z.enum(["none", "cat", "hands"]).default("none"),
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
    const { asset, usage, decoration } = image.data;
    if (
      asset.state === "ready" &&
      !assetOrigins.includes(new URL(asset.url).origin)
    )
      return { status: "invalid" };
    const html = renderToStaticMarkup(
      usage === "avatar" ? (
        <PortfolioAvatar asset={asset} decoration={decoration} />
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
  const images =
    fragment.kind === "profile"
      ? [fragment.profile.avatar, fragment.profile.banner]
      : fragment.kind === "project"
        ? [fragment.entry.image]
        : components.flatMap((component) =>
            component.type === "projects"
              ? component.data.entries.map((entry) => entry.image)
              : [],
          );
  if (
    images.some(
      (image) =>
        image.state === "ready" &&
        !assetOrigins.includes(new URL(image.url).origin),
    )
  )
    return { status: "invalid" };
  const html = renderToStaticMarkup(
    fragment.kind === "profile" ? (
      <PortfolioProfile profile={normalizeDisplayStrings(fragment.profile)} />
    ) : fragment.kind === "project" ? (
      <PortfolioProject entry={normalizeDisplayStrings(fragment.entry)} />
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
export function documentShell({
  markup,
  title,
  context,
  assets,
}: {
  markup: string;
  title: string;
  context: RenderContext;
  assets: PlatformAssets;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${context === "preview" ? '<meta name="robots" content="noindex,nofollow,noarchive">' : ""}<title>${escapeText(title)}</title><link rel="stylesheet" href="${platformUrl(assets.cssUrl, assets.origin)}"><script src="${platformUrl(assets.scriptUrl, assets.origin)}" defer></script></head><body>${markup}</body></html>`;
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
