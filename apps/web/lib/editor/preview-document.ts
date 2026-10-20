const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  Vary: "Cookie",
};

// Deliberately unregistered until the complete owner-entry flow is activated.
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
    if (!response.ok)
      return new Response(null, {
        status: response.status === 401 ? 401 : 503,
        headers: privateHeaders,
      });
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
