// Full-page draft preview routes: `/preview`, `/preview/resume` and
// `/preview/projects/{slug}`. They run in the web Worker before OpenNext, so
// the owner check, the headers and the CSP cannot be skipped by a page.
//
// Preview URLs name no draft. The signed-in account can only ever see its own
// saved draft, so there is nothing for a request to guess. Every unsigned,
// expired, portfolio-less, foreign-origin or non-GET request gets the same
// empty 404.

export const PREVIEW_ASSET_SCRIPT = "/preview-assets/app.js";
export const PREVIEW_ASSET_STYLE = "/preview-assets/app.css";

const PREVIEW_PAGE =
  /^\/preview(?:\/(resume|projects\/[a-z0-9]+(?:-[a-z0-9]+)*))?\/?$/;

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};

// The shell holds no draft data. `noindex` repeats the response header for
// clients that archive a saved copy.
export const PREVIEW_SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>Private preview | hasaweb.site</title><link rel="stylesheet" href="${PREVIEW_ASSET_STYLE}"></head><body><div id="preview-root"><noscript>The private preview needs JavaScript.</noscript></div><script type="module" src="${PREVIEW_ASSET_SCRIPT}"></script></body></html>`;

// No inline script or style, no form submission and no frame ancestor. Only
// the resume page may embed an object, and only from this origin.
export function previewPolicy(resume: boolean): string {
  const embed = resume ? "'self'" : "'none'";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    `object-src ${embed}`,
    `frame-src ${embed}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const notFound = () =>
  new Response(null, { status: 404, headers: privateHeaders });

/** The page a path previews, or null when it is not a preview route. */
export function previewRoute(
  pathname: string,
): { path: string; resume: boolean } | "invalid" | null {
  if (pathname !== "/preview" && !pathname.startsWith("/preview/")) return null;
  const match = PREVIEW_PAGE.exec(pathname);
  if (!match) return "invalid";
  return {
    path: match[1] ? `/${match[1]}` : "/",
    resume: match[1] === "resume",
  };
}

export async function previewRequest(
  request: Request,
  env: { APP_ORIGIN?: string; OWNER_API: Pick<Fetcher, "fetch"> },
): Promise<Response | null> {
  const url = new URL(request.url);
  const route = previewRoute(url.pathname);
  if (route === null) return null;
  if (
    route === "invalid" ||
    request.method !== "GET" ||
    !env.APP_ORIGIN ||
    url.origin !== env.APP_ORIGIN
  )
    return notFound();
  try {
    const response = await env.OWNER_API.fetch(
      new Request(new URL("/api/owner", url), {
        headers: { Cookie: request.headers.get("Cookie") ?? "" },
      }),
    );
    // Only the owner service failing says nothing about the caller's account.
    if (response.status >= 500) {
      void response.body?.cancel().catch(() => {});
      return new Response(null, { status: 503, headers: privateHeaders });
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return notFound();
    }
    const identity: unknown = await response.json();
    if (
      !identity ||
      typeof identity !== "object" ||
      !("portfolio" in identity) ||
      !identity.portfolio
    )
      return notFound();
    return new Response(PREVIEW_SHELL, {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": previewPolicy(route.resume),
        "X-Frame-Options": "DENY",
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: privateHeaders });
  }
}
