import {
  OwnerAccessError,
  type OwnerRepositories,
  ownerRepositories,
  type SessionIdentity,
} from "./repositories";

export type SessionReader = (
  headers: Headers,
) => Promise<SessionIdentity | null>;
export function privateJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      Vary: "Cookie",
    },
  });
}

// Pass Better Auth's api.getSession as readSession. No session IDs or owner IDs
// supplied by a caller are accepted as authorization.
export function ownerApi(
  options: {
    db: D1Database;
    origin: string;
    readSession: SessionReader;
  },
  handle: (
    request: Request,
    repositories: OwnerRepositories,
  ) => Promise<Response>,
) {
  const origin = new URL(options.origin).origin;
  if (origin !== options.origin)
    throw new Error("Configure an exact application origin");
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).origin !== origin) return privateJson(null, 404);
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (mutation && request.headers.get("Origin") !== origin)
      return privateJson(null, 403);
    if (
      mutation &&
      request.headers
        .get("Content-Type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return privateJson(null, 415);
    try {
      const identity = await options.readSession(request.headers);
      if (!identity) return privateJson(null, 401);
      const repositories = await ownerRepositories(options.db, identity);
      const response = await handle(request, repositories);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Robots-Tag", "noindex");
      const vary = headers.get("Vary");
      headers.set("Vary", vary ? `${vary}, Cookie` : "Cookie");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      if (error instanceof OwnerAccessError) return privateJson(null, 401);
      return privateJson(null, 503);
    }
  };
}
