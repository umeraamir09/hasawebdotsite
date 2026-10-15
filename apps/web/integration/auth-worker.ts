// Standalone local integration entry. Never imported by a product route.
import "../spike/auth-provider-fixtures";
import { ownerRepositories, privateJson } from "@hasaweb/db";
import { createEmptyDraft } from "@hasaweb/schema";
import {
  type AuthEnvironment,
  authResponse,
  createProductAuth,
  currentOwner,
  ownerResponse,
} from "../lib/auth";

const origin = "https://hasaweb.site";
const instances = new WeakMap<
  D1Database,
  ReturnType<typeof createProductAuth>
>();
export default {
  async fetch(
    request: Request,
    env: { DB: D1Database; FIXTURE_SECRET: string },
  ) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return privateJson(null, 404);
    const settings: AuthEnvironment = {
      DB: env.DB,
      APP_ENV: "test",
      APP_ORIGIN: origin,
      BETTER_AUTH_SECRET: env.FIXTURE_SECRET,
      GITHUB_CLIENT_ID: "fixture-github",
      GITHUB_CLIENT_SECRET: "fixture-secret",
      GOOGLE_CLIENT_ID: "fixture-google",
      GOOGLE_CLIENT_SECRET: "fixture-secret",
    };
    let auth = instances.get(env.DB);
    if (!auth) {
      auth = createProductAuth(settings);
      instances.set(env.DB, auth);
    }
    if (url.pathname === "/__fixture/counts") {
      const counts = await Promise.all(
        ["user", "account", "session", "portfolio"].map(async (table) => [
          table,
          (
            await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
              n: number;
            }>()
          )?.n,
        ]),
      );
      return Response.json(Object.fromEntries(counts));
    }
    if (url.pathname === "/__fixture/portfolio") {
      const identity = await auth.api.getSession({
        headers: request.headers,
        query: { disableCookieCache: true },
      });
      if (!identity) return privateJson(null, 401);
      const repositories = await ownerRepositories(env.DB, identity);
      await repositories.portfolio.create(
        crypto.randomUUID(),
        createEmptyDraft({
          themeId: "fixture-theme",
          fontId: "fixture-font",
          colorMode: "system",
        }),
      );
      return privateJson({ ok: true });
    }
    if (["/__fixture/expire", "/__fixture/delete"].includes(url.pathname)) {
      const owner = await currentOwner(settings, request.headers, auth);
      if (!owner) return privateJson(null, 401);
      if (url.pathname === "/__fixture/expire")
        await env.DB.prepare("UPDATE session SET expires_at = 0 WHERE id = ?")
          .bind(owner.identity.session.id)
          .run();
      else
        await env.DB.prepare("UPDATE user SET deleting_at = ? WHERE id = ?")
          .bind(Date.now(), owner.identity.user.id)
          .run();
      return privateJson({ ok: true });
    }
    url.protocol = "https:";
    url.port = "";
    url.host = request.headers.get("X-Fixture-Host") ?? "hasaweb.site";
    const virtual = new Request(url, request);
    try {
      return url.pathname === "/api/owner"
        ? await ownerResponse(virtual, settings, auth)
        : await authResponse(virtual, settings, auth);
    } catch {
      return privateJson(null, 503);
    }
  },
};
