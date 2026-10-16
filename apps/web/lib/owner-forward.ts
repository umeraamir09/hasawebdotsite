// Runs at the Worker boundary, before OpenNext converts or buffers the body.
export async function forwardOwnerRequest(
  request: Request,
  env: { APP_ORIGIN?: string; OWNER_API: Fetcher },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/owner" && !url.pathname.startsWith("/api/owner/"))
    return null;
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    Vary: "Cookie",
  };
  if (!env.APP_ORIGIN || url.origin !== env.APP_ORIGIN)
    return new Response(null, { status: 404, headers });
  try {
    // Forward the original cookie and stream. Never forward a claimed owner ID.
    return await env.OWNER_API.fetch(request);
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
