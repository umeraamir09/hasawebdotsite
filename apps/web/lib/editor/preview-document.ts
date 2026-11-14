const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  Vary: "Cookie",
};

import { type OwnerEntryGate, ownerEntryActive } from "../owner-entry-gate";

export const EDITOR_PREVIEW_PATH = "/editor/preview";
export const EDITOR_PREVIEW_SCRIPT = "/preview-assets/editor.js";
export const EDITOR_PREVIEW_STYLE = "/preview-assets/editor.css";

// The boot shell holds no draft data. The child checks the owner again and
// receives only the parent editor's display projection.
export const EDITOR_PREVIEW_SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>Private preview | hasaweb.site</title><link rel="stylesheet" href="${EDITOR_PREVIEW_STYLE}"></head><body><div id="preview-root"></div><script type="module" src="${EDITOR_PREVIEW_SCRIPT}"></script></body></html>`;

// The editor and setup Review iframe document. It is registered only while
// the Phase 42E owner-entry gate is open; otherwise the path falls through to
// the application, which has no such page.
export function editorPreviewRequest(
  request: Request,
  env: OwnerEntryGate & {
    APP_ORIGIN?: string | undefined;
    OWNER_API: Pick<Fetcher, "fetch">;
  },
): Promise<Response> | null {
  if (new URL(request.url).pathname !== EDITOR_PREVIEW_PATH) return null;
  if (!ownerEntryActive(env) || !env.APP_ORIGIN) return null;
  return serveEditorPreview(
    request,
    { APP_ORIGIN: env.APP_ORIGIN, OWNER_API: env.OWNER_API },
    EDITOR_PREVIEW_SHELL,
  );
}

// Owner check, private/no-store, noindex and `frame-ancestors 'self'`: only
// this origin's editor or setup Review can frame the document.
export async function serveEditorPreview(
  request: Request,
  env: { APP_ORIGIN: string; OWNER_API: Pick<Fetcher, "fetch"> },
  shell: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== env.APP_ORIGIN || request.method !== "GET")
    return new Response(null, { status: 404, headers: privateHeaders });
  try {
    const response = await env.OWNER_API.fetch(
      new Request(new URL("/api/owner", url), {
        headers: { Cookie: request.headers.get("Cookie") ?? "" },
      }),
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return new Response(null, {
        status: response.status === 401 ? 401 : 503,
        headers: privateHeaders,
      });
    }
    const identity: unknown = await response.json();
    if (
      !identity ||
      typeof identity !== "object" ||
      !("portfolio" in identity) ||
      !identity.portfolio
    )
      return new Response(null, { status: 409, headers: privateHeaders });
    return new Response(shell, {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
        "X-Frame-Options": "SAMEORIGIN",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: privateHeaders });
  }
}
