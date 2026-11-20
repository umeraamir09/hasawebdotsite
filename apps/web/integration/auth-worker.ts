// Standalone local integration entry. Never imported by a product route.
import "../spike/auth-provider-fixtures";
import { ownerRepositories, privateJson } from "@hasaweb/db";
import { createEmptyDraft } from "@hasaweb/schema";
import { measureDb } from "../../jobs/integration/measure-db";
import { createOwnerRouter } from "../../jobs/src/owner-api";
import {
  type AuthEnvironment,
  authResponse,
  createProductAuth,
  currentOwner,
} from "../lib/auth";

const origin = "https://hasaweb.site";
const ownerRouter = createOwnerRouter();
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
        [
          "user",
          "account",
          "session",
          "portfolio",
          "disconnected_provider",
        ].map(async (table) => [
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
    if (url.pathname === "/__fixture/portfolio-state") {
      const owner = await currentOwner(settings, request.headers, auth);
      if (!owner) return privateJson(null, 401);
      return privateJson({
        portfolio: await env.DB.prepare(
          "SELECT * FROM portfolio WHERE user_id=?",
        )
          .bind(owner.identity.user.id)
          .first(),
        user: {
          name: owner.identity.user.name,
          email: owner.identity.user.email,
          image: owner.identity.user.image,
        },
        related: await env.DB.prepare(`SELECT
          (SELECT count(*) FROM asset) assets,
          (SELECT count(*) FROM subdomain_claim) claims,
          (SELECT count(*) FROM publish_version) publications,
          (SELECT count(*) FROM github_connection) github`).first(),
      });
    }
    if (url.pathname === "/__fixture/legacy-portfolio") {
      const owner = await currentOwner(settings, request.headers, auth);
      if (!owner) return privateJson(null, 401);
      if (url.searchParams.has("kind")) {
        const draft = createEmptyDraft({
          themeId: "fixture-theme",
          fontId: "fixture-font",
          colorMode: "system",
        });
        const email = url.searchParams.get("kind") === "email";
        draft.links = [
          {
            id: "legacy-link",
            label: "Legacy destination",
            kind: email ? "email" : "website",
            value: email
              ? `${"x".repeat(250)}@example.test`
              : `https://example.test/${"x".repeat(2048)}`,
            showInProfile: true,
            showInSocialComponent: false,
          },
        ];
        await env.DB.prepare(
          "UPDATE portfolio SET draft=?,draft_validation_version=0 WHERE user_id=?",
        )
          .bind(
            JSON.stringify({ ...draft, schemaVersion: 1 }),
            owner.identity.user.id,
          )
          .run();
      }
      return privateJson(
        await env.DB.prepare(
          "SELECT draft,draft_validation_version FROM portfolio WHERE user_id=?",
        )
          .bind(owner.identity.user.id)
          .first(),
      );
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
    if (
      url.pathname === "/__fixture/editor-entry" &&
      request.method === "POST"
    ) {
      const owner = await currentOwner(settings, request.headers, auth);
      if (!owner) return privateJson(null, 401);
      const setup = await owner.repositories.setup.get();
      if (!setup) return privateJson(null, 404);
      return privateJson(
        await owner.repositories.setup.recordFirstEditorEntry(setup.revision),
      );
    }
    url.protocol = "https:";
    url.port = "";
    url.host = request.headers.get("X-Fixture-Host") ?? "hasaweb.site";
    const virtual = new Request(url, request);
    try {
      const measured = measureDb(env.DB);
      const measuredSettings = { ...settings, DB: measured.db };
      const response =
        url.pathname === "/api/owner" || url.pathname.startsWith("/api/owner/")
          ? await ownerRouter.fetch(virtual, measuredSettings)
          : await authResponse(
              virtual,
              measuredSettings,
              createProductAuth(measuredSettings),
            );
      response.headers.set(
        "X-Fixture-Rows-Read",
        String(measured.counts.reads),
      );
      response.headers.set(
        "X-Fixture-Rows-Written",
        String(measured.counts.writes),
      );
      response.headers.set(
        "X-Fixture-Queries",
        String(measured.counts.queries),
      );
      return response;
    } catch {
      return privateJson(null, 503);
    }
  },
};
