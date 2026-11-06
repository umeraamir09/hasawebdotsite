import { isWebUrl } from "@hasaweb/schema";

export type RenderContext = "preview" | "public";

export function portfolioHeaders(
  context: RenderContext,
  {
    assetOrigins = [],
    objectOrigins = [],
    parentOrigin,
  }: {
    assetOrigins?: readonly string[];
    // Embedded documents, used only by the /resume PDF viewer.
    objectOrigins?: readonly string[];
    parentOrigin?: string;
  } = {},
): Headers {
  const checked = (values: readonly string[]) =>
    values.map((origin) => {
      if (!isWebUrl(origin) || new URL(origin).origin !== origin)
        throw new Error("Expected an asset origin");
      return origin;
    });
  const origins = checked(assetOrigins);
  const objects = checked(objectOrigins);
  const embed = objects.length
    ? `object-src ${objects.join(" ")}; frame-src ${objects.join(" ")}`
    : "object-src 'none'";
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
    "Content-Security-Policy": `default-src 'none'; script-src 'self' ${origins.join(" ")}; style-src 'self' ${origins.join(" ")}; img-src 'self' ${origins.join(" ")}; font-src 'self' ${origins.join(" ")}; connect-src 'none'; ${embed}; base-uri 'none'; form-action 'none'; frame-ancestors ${context === "preview" && parentOrigin ? parentOrigin : "'none'"}`,
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

// A published portfolio's missing or withdrawn page. The link returns to the
// portfolio root, which is still published when this page is served.
export const PAGE_UNAVAILABLE_HTML =
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page unavailable</title><main><h1>Page unavailable</h1><p>This page is not available. It may have been removed.</p><p><a href="/">Back to portfolio</a></p></main></html>';
