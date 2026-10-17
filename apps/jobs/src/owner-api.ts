import {
  type AuthEnvironment,
  authSettings,
  currentOwner,
} from "@hasaweb/auth";
import { OwnerAccessError, privateJson } from "@hasaweb/db";
import { Hono } from "hono";

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
  Bindings: AuthEnvironment;
  Variables: { owner: Owner };
};

export function createOwnerRouter() {
  const app = new Hono<OwnerBindings>();
  app.onError((error) =>
    privateJson(null, error instanceof OwnerAccessError ? 401 : 503),
  );
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
    const owner = await currentOwner(c.env, request.headers);
    if (!owner) return privateJson(null, 401);
    c.set("owner", owner);
    await next();
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex");
    c.header("Vary", "Cookie");
  });
  app.get("/api/owner", async (c) => {
    const owner = c.get("owner");
    const portfolio = await owner.repositories.portfolio.summary();
    return privateJson({
      user: { id: owner.identity.user.id, name: owner.identity.user.name },
      portfolio: portfolio ? { id: portfolio.id } : null,
    });
  });
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
  return app;
}

export const ownerRouter = createOwnerRouter();
