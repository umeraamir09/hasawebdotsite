import {
  AssetImage,
  PortfolioAvatar,
  PortfolioProfile,
  PortfolioSection,
} from "@hasaweb/components";
import {
  assetSchema,
  componentModelSchema,
  normalizeDisplayStrings,
  profileModelSchema,
  withinBounds,
} from "@hasaweb/components/model";
import { isWebUrl } from "@hasaweb/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { partSchema, type RenderPart, renderPart } from "./parts";

const imagePartSchema = z.strictObject({
  kind: z.literal("asset"),
  asset: assetSchema,
  usage: z.enum(["avatar", "banner", "image"]),
  decoration: z.enum(["none", "cat", "hands"]).default("none"),
});
export type RenderContext = "preview" | "public";
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
  const images =
    fragment.kind === "profile"
      ? [fragment.profile.avatar, fragment.profile.banner]
      : fragment.component.type === "projects"
        ? fragment.component.data.entries.map((entry) => entry.image)
        : [];
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
    ) : (
      <PortfolioSection
        component={normalizeDisplayStrings(fragment.component)}
      />
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
export function portfolioHeaders(
  context: RenderContext,
  {
    assetOrigins = [],
    parentOrigin,
  }: { assetOrigins?: readonly string[]; parentOrigin?: string } = {},
): Headers {
  const origins = assetOrigins.map((origin) => {
    if (!isWebUrl(origin) || new URL(origin).origin !== origin)
      throw new Error("Expected an asset origin");
    return origin;
  });
  if (
    parentOrigin &&
    (!isWebUrl(parentOrigin) || new URL(parentOrigin).origin !== parentOrigin)
  )
    throw new Error("Expected a preview parent origin");
  return new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control":
      context === "preview"
        ? "private, no-store"
        : "public, max-age=0, must-revalidate",
    "Content-Security-Policy": `default-src 'none'; script-src 'self' ${origins.join(" ")}; style-src 'self' ${origins.join(" ")}; img-src 'self' ${origins.join(" ")}; font-src 'self' ${origins.join(" ")}; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${context === "preview" && parentOrigin ? parentOrigin : "'none'"}`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    ...(context === "preview"
      ? { "X-Robots-Tag": "noindex, nofollow, noarchive" }
      : {}),
  });
}
export function unavailableResponse(): Response {
  const headers = portfolioHeaders("public");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portfolio unavailable</title><main><h1>Portfolio unavailable</h1><p>This portfolio is not available.</p></main></html>',
    { status: 404, headers },
  );
}
