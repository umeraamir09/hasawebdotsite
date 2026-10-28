import {
  type AuthEnvironment,
  authSettings,
  currentOwner,
  currentSessionIdentity,
  ownerSummaryResponse,
} from "@hasaweb/auth";
import {
  assertSaveSession,
  OwnerAccessError,
  ownerDrafts,
  privateJson,
  SaveError,
} from "@hasaweb/db";
import { Hono } from "hono";
import { addDraftRoutes } from "./draft-routes";
import {
  addPublicationRoutes,
  type PublicationBindings,
} from "./publication-routes";

type Owner = NonNullable<Awaited<ReturnType<typeof currentOwner>>>;

// Initialization takes no owner input. Count streamed bytes even if a caller
// supplies a false Content-Length; never buffer a full draft at this endpoint.
async function initializationBody(request: Request): Promise<400 | 413 | null> {
  if (!request.body) return 400;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024) {
        void reader.cancel().catch(() => {});
        return 413;
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    const value: unknown = JSON.parse(body);
    return value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
      ? null
      : 400;
  } catch {
    void reader.cancel().catch(() => {});
    return 400;
  } finally {
    reader.releaseLock();
  }
}
export type OwnerBindings = {
  Bindings: AuthEnvironment & Partial<PublicationBindings>;
  Variables: { owner: Owner; identity: Owner["identity"] };
};

export function createOwnerRouter() {
  const app = new Hono<OwnerBindings>();
  app.onError((error, c) => {
    if (error instanceof SaveError)
      return privateJson({ error: error.code }, error.status);
    const draftApi =
      c.req.path.startsWith("/api/owner/draft") ||
      c.req.path === "/api/owner/progress" ||
      c.req.path.startsWith("/api/owner/publication/");
    const unauthorized = error instanceof OwnerAccessError;
    return privateJson(
      draftApi
        ? { error: unauthorized ? "unauthorized" : "storage_unavailable" }
        : null,
      unauthorized ? 401 : 503,
    );
  });
  app.notFound(() => privateJson(null, 404));
  app.use("*", async (c, next) => {
    try {
      await next();
    } finally {
      // Finish small rejected bodies across the binding, but bound cleanup work.
      if (!c.req.raw.bodyUsed && c.req.raw.body) {
        const reader = c.req.raw.body.getReader();
        const cancel = () => void reader.cancel().catch(() => {});
        const timeout = setTimeout(cancel, 100);
        let done = false;
        try {
          let bytes = 0;
          while (bytes < 8192) {
            const chunk = await reader.read();
            if (chunk.done) {
              done = true;
              break;
            }
            bytes += chunk.value.byteLength;
          }
        } catch {
          // A failed upload must not replace the rejection response.
        } finally {
          clearTimeout(timeout);
          if (!done) cancel();
          reader.releaseLock();
        }
      }
    }
  });
  app.use("*", async (c, next) => {
    const request = c.req.raw;
    const { origin } = authSettings(c.env);
    if (new URL(request.url).origin !== origin) return privateJson(null, 404);
    if (!["GET", "POST", "PUT", "DELETE"].includes(request.method))
      return privateJson(null, 405);
    if (request.method !== "GET") {
      if (request.headers.get("Origin") !== origin)
        return privateJson(null, 403);
      if (
        request.headers
          .get("Content-Type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      )
        return privateJson(null, 415);
    }
    const draftRequest =
      c.req.path === "/api/owner/progress" ||
      c.req.path === "/api/owner/draft" ||
      c.req.path.startsWith("/api/owner/draft/") ||
      c.req.path.startsWith("/api/owner/publication/");
    if (draftRequest) {
      // Draft handlers do not use the general owner repositories. Keep their
      // persisted access precheck without constructing those repositories.
      // Streamed reads already check access in their consistent SQL snapshot.
      // Preserve the existing session refresh policy on every route.
      const streamedRead =
        request.method === "GET" &&
        ["/api/owner/draft", "/api/owner/draft/recovery"].includes(c.req.path);
      const identity = await currentSessionIdentity(c.env, request.headers, {
        refresh: !streamedRead,
      });
      if (!identity) return privateJson(null, 401);
      if (!streamedRead) await assertSaveSession(c.env.DB, identity);
      c.set("identity", identity);
    } else {
      const owner = await currentOwner(c.env, request.headers);
      if (!owner) return privateJson(null, 401);
      c.set("owner", owner);
      c.set("identity", owner.identity);
    }
    if (draftRequest) {
      // This is a stale-account precondition, never an authorization source.
      const expected = request.headers.get("X-Expected-Owner-Id");
      if (!expected) return privateJson({ error: "invalid_input" }, 400);
      if (expected !== c.get("identity").user.id)
        return privateJson({ error: "owner_changed" }, 409);
    }
    await next();
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex");
    c.header("Vary", "Cookie");
  });
  app.get("/api/owner", (c) => ownerSummaryResponse(c.req.raw, c.get("owner")));
  app.all("/api/owner", () => privateJson(null, 405));
  app.post("/api/owner/portfolio", async (c) => {
    const invalid = await initializationBody(c.req.raw);
    if (invalid) return privateJson(null, invalid);
    const owner = c.get("owner");
    const portfolio = await owner.repositories.portfolio.provision();
    return privateJson({
      user: { id: owner.identity.user.id, name: owner.identity.user.name },
      portfolio,
    });
  });
  app.all("/api/owner/portfolio", () => privateJson(null, 405));
  app.post("/api/owner/entry", async (c) => {
    const invalid = await initializationBody(c.req.raw);
    if (invalid) return privateJson(null, invalid);
    const owner = c.get("owner");
    const portfolio = await owner.repositories.portfolio.provision();
    if (!portfolio) return privateJson(null, 401);
    const meta = await ownerDrafts(c.env.DB, owner.identity).metadata();
    return privateJson({
      user: { id: owner.identity.user.id, name: owner.identity.user.name },
      portfolio,
      entry:
        meta.firstEditorEnteredAt === null
          ? { kind: "setup", revision: meta.revision, progress: meta.progress }
          : {
              kind: "editor",
              revision: meta.revision,
              firstEditorEnteredAt: meta.firstEditorEnteredAt,
            },
    });
  });
  app.all("/api/owner/entry", () => privateJson(null, 405));
  addDraftRoutes(app);
  addPublicationRoutes(app);
  return app;
}

export const ownerRouter = createOwnerRouter();
