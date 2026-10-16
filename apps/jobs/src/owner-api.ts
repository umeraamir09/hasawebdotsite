import {
  type AuthEnvironment,
  authSettings,
  currentOwner,
} from "@hasaweb/auth";
import { OwnerAccessError, privateJson } from "@hasaweb/db";
import { Hono } from "hono";

type Owner = NonNullable<Awaited<ReturnType<typeof currentOwner>>>;
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
  return app;
}

export const ownerRouter = createOwnerRouter();
