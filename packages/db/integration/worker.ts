import { createEmptyDraft, readDraft } from "@hasaweb/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { ownerApi, privateJson } from "../src/owner-api";
import { ownerRepositories, type SessionIdentity } from "../src/repositories";
import { RESERVED_SUBDOMAINS } from "../src/reserved-subdomains";
import * as schema from "../src/schema";
import { runAddressChecks } from "./addresses";
import { runGitHubChecks, verifyGitHubRestart } from "./github";
import { runProvisionChecks, verifyProvisionRestart } from "./provision";
import { runPublicationChecks } from "./publication";
import { runSetupChecks } from "./setup";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
}
async function rejects(action: () => PromiseLike<unknown>) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error("Expected operation to fail");
}
const identity = (id: string): SessionIdentity => ({
  user: { id },
  session: { id: `session-${id}` },
});
const draft = () =>
  createEmptyDraft({
    themeId: "default",
    fontId: "default",
    colorMode: "system",
  });
const secret = "local-integration-secret-with-at-least-32-characters";
async function signedCookie(token: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(token),
  );
  return `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`)}`;
}
export default {
  async fetch(request, env) {
    if (
      env.APP_ENV !== "local" ||
      !["127.0.0.1", "localhost"].includes(new URL(request.url).hostname)
    )
      return new Response(null, { status: 404 });
    if (new URL(request.url).pathname === "/health")
      return privateJson({ ready: true });
    const db = drizzle(env.DB);
    if (new URL(request.url).pathname === "/persist") {
      const repositories = await ownerRepositories(env.DB, identity("alice"));
      return privateJson({
        portfolio: (await repositories.portfolio.get())?.id,
        asset: (await repositories.assets.get("asset-a"))?.status,
        counter: (await repositories.counters.get("edits", 0))?.count,
        claim: (await repositories.claims.current())?.name,
        githubCleanup: await verifyGitHubRestart(env.DB),
        provision: await verifyProvisionRestart(env.DB),
      });
    }
    const checks: string[] = [];
    let current = "setup";
    async function check(name: string, action: () => Promise<void>) {
      current = name;
      await action();
      checks.push(name);
    }
    try {
      const now = new Date();
      for (const id of [
        "alice",
        "bob",
        "deleting",
        "expired",
        "revoked",
        "held",
        "cached",
      ]) {
        await db.insert(schema.user).values({
          id,
          name: id,
          email: `${id}@hasaweb.invalid`,
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(schema.session).values({
          id: `session-${id}`,
          token: `token-${id}`,
          userId: id,
          expiresAt: new Date(Date.now() + 3_600_000),
          createdAt: now,
          updatedAt: now,
        });
      }
      const alice = await ownerRepositories(env.DB, identity("alice"));
      const bob = await ownerRepositories(env.DB, identity("bob"));
      await check(
        "local seeds contain valid drafts and no sign-in sessions",
        async () => {
          const rows = await db.select().from(schema.portfolio);
          equal(rows.length, 2);
          for (const row of rows) readDraft(row.draft);
          const legacy = rows.find((row) => row.id === "local-portfolio");
          equal(legacy?.draft.schemaVersion, 1);
          equal(legacy?.draft.profile.name, "Migration content");
          equal(legacy?.draft.samples, { "profile.name": true });
          equal(legacy?.setupProgress, { schemaVersion: 1, step: "address" });
          equal(legacy?.firstEditorEnteredAt, null);
          equal(
            (
              await db
                .select()
                .from(schema.asset)
                .where(eq(schema.asset.id, "migration-asset"))
                .get()
            )?.status,
            "ready",
          );
          equal(
            (
              await db
                .select()
                .from(schema.subdomainClaim)
                .where(eq(schema.subdomainClaim.name, "migration-site"))
                .get()
            )?.portfolioId,
            "local-portfolio",
          );
          equal(
            (
              await db
                .select()
                .from(schema.session)
                .where(eq(schema.session.userId, "local-owner"))
            ).length,
            0,
          );
        },
      );
      await runSetupChecks(env.DB, check);
      await runPublicationChecks(env.DB, check);
      await runAddressChecks(env.DB, check);
      await check("reserved table matches the platform constant", async () => {
        equal(
          (await db.select().from(schema.reservedSubdomain))
            .map((r) => r.name)
            .sort(),
          [...RESERVED_SUBDOMAINS].sort(),
        );
      });
      await check(
        "one portfolio per account and valid draft round trip",
        async () => {
          equal(
            (await alice.portfolio.create("portfolio-a", draft()))?.draft,
            draft(),
          );
          equal(
            (await alice.portfolio.create("second-a", draft()))?.id,
            "portfolio-a",
          );
          await bob.portfolio.create("portfolio-b", draft());
          equal(await bob.portfolio.get("portfolio-a"), undefined);
          await rejects(() =>
            db.insert(schema.portfolio).values({
              id: "duplicate",
              userId: "alice",
              draft: draft(),
              createdAt: now,
              updatedAt: now,
            }),
          );
        },
      );
      await check(
        "portfolio ID collisions across owners return no record",
        async () => {
          const newcomer = await ownerRepositories(env.DB, identity("cached"));
          const original = await alice.portfolio.get();
          equal(
            await newcomer.portfolio.create("portfolio-a", draft()),
            undefined,
          );
          equal(await newcomer.portfolio.get(), undefined);
          equal(await alice.portfolio.get(), original);
          equal(
            (await newcomer.portfolio.create("portfolio-newcomer", draft()))
              ?.id,
            "portfolio-newcomer",
          );
          equal(
            (await newcomer.portfolio.create("portfolio-a", draft()))?.id,
            "portfolio-newcomer",
          );
        },
      );
      await check(
        "repositories retain only their own resolved identity",
        async () => {
          const original = identity("alice");
          const opened = await ownerRepositories(env.DB, original);
          original.user.id = "bob";
          original.session.id = "session-bob";
          equal((await opened.portfolio.get())?.id, "portfolio-a");
        },
      );
      await check(
        "concurrent provisioning retains a single portfolio",
        async () => {
          const held = await ownerRepositories(env.DB, identity("held"));
          const results = await Promise.all([
            held.portfolio.create("held-1", draft()),
            held.portfolio.create("held-2", draft()),
          ]);
          equal(results[0]?.id, results[1]?.id);
          equal(
            (
              await db
                .select()
                .from(schema.portfolio)
                .where(eq(schema.portfolio.userId, "held"))
            ).length,
            1,
          );
        },
      );
      await check(
        "database rejects orphan portfolios and invalid draft JSON",
        async () => {
          await rejects(() =>
            db.insert(schema.portfolio).values({
              id: "orphan",
              userId: "missing",
              draft: draft(),
              createdAt: now,
              updatedAt: now,
            }),
          );
          await rejects(() =>
            env.DB.prepare(
              "UPDATE portfolio SET draft = 'broken' WHERE id = 'portfolio-a'",
            ).run(),
          );
          await rejects(() =>
            env.DB.prepare(
              "UPDATE portfolio SET draft = '[]' WHERE id = 'portfolio-a'",
            ).run(),
          );
        },
      );
      await check(
        "draft byte cap accepts exact limit and rejects an extra UTF-8 byte",
        async () => {
          // Raw JSON exercises SQLite's byte constraint separately from the draft contract.
          const exact = JSON.stringify({ x: "a".repeat(1_048_576 - 8) });
          equal(new TextEncoder().encode(exact).length, 1_048_576);
          await env.DB.prepare(
            "UPDATE portfolio SET draft = ? WHERE id = 'portfolio-a'",
          )
            .bind(exact)
            .run();
          await rejects(() =>
            env.DB.prepare(
              "UPDATE portfolio SET draft = ? WHERE id = 'portfolio-a'",
            )
              .bind(JSON.stringify({ x: "a".repeat(1_048_576 - 7) }))
              .run(),
          );
          await rejects(() =>
            env.DB.prepare(
              "UPDATE portfolio SET draft = ? WHERE id = 'portfolio-a'",
            )
              .bind(JSON.stringify({ x: "é".repeat(524_285) }))
              .run(),
          );
          await db
            .update(schema.portfolio)
            .set({ draft: draft() })
            .where(eq(schema.portfolio.id, "portfolio-a"));
        },
      );
      await check(
        "asset inserts ignore injected ownership and initial status",
        async () => {
          const input = {
            id: "asset-a",
            kind: "avatar" as const,
            contentType: "image/png",
            bytes: 32,
            portfolioId: "portfolio-b",
            status: "ready",
          };
          equal((await alice.assets.create(input))?.portfolioId, "portfolio-a");
          equal((await alice.assets.get("asset-a"))?.status, "pending");
          await bob.assets.create({ ...input, id: "asset-b" });
        },
      );
      await check(
        "another owner cannot read, list, update, delete, or overwrite assets",
        async () => {
          equal(await bob.assets.get("asset-a"), undefined);
          equal(
            (await bob.assets.list()).map((r) => r.id),
            ["asset-b"],
          );
          equal(await bob.assets.setStatus("asset-a", "failed"), undefined);
          equal(await bob.assets.remove("asset-a"), undefined);
          equal(
            await bob.assets.create({
              id: "asset-a",
              kind: "resume",
              contentType: "application/pdf",
              bytes: 10,
            }),
            undefined,
          );
          equal(
            (await alice.assets.setStatus("asset-a", "ready"))?.status,
            "ready",
          );
          equal((await alice.assets.list()).length, 1);
          equal((await bob.assets.remove("asset-b"))?.id, "asset-b");
        },
      );
      await check("invalid asset statuses and orphan assets fail", async () => {
        await rejects(() =>
          env.DB.prepare(
            "UPDATE asset SET status = 'other' WHERE id = 'asset-a'",
          ).run(),
        );
        await rejects(() =>
          db.insert(schema.asset).values({
            id: "orphan",
            portfolioId: "missing",
            kind: "avatar",
            contentType: "image/png",
            bytes: 10,
            createdAt: now,
            updatedAt: now,
          }),
        );
      });
      await check(
        "publication versions are private and numbers are unique per portfolio",
        async () => {
          await alice.versions.create({
            id: "version-a",
            n: 1,
            rendererVersion: "test-1",
          });
          await bob.versions.create({
            id: "version-b",
            n: 1,
            rendererVersion: "test-1",
          });
          equal(await bob.versions.get("version-a"), undefined);
          equal(await bob.versions.fail("version-a", "other owner"), undefined);
          equal(
            await bob.versions.create({
              id: "version-a",
              n: 2,
              rendererVersion: "other",
            }),
            undefined,
          );
          equal(
            await alice.versions.create({
              id: "duplicate-number",
              n: 1,
              rendererVersion: "test",
            }),
            undefined,
          );
          equal(
            (await alice.versions.list()).map((r) => r.id),
            ["version-a"],
          );
          equal(
            (await alice.versions.fail("version-a", "fixture"))?.error,
            "fixture",
          );
        },
      );
      await check(
        "publication state and pointers cannot change through draft provisioning",
        async () => {
          await db
            .update(schema.portfolio)
            .set({ publishedVersion: 1, status: "published" })
            .where(eq(schema.portfolio.id, "portfolio-a"));
          await alice.portfolio.create("unused", draft());
          equal((await alice.portfolio.get())?.publishedVersion, 1);
          equal((await alice.portfolio.get())?.status, "published");
        },
      );
      await db
        .insert(schema.subdomainClaim)
        .values({ name: "alice-site", portfolioId: "portfolio-a" });
      await check(
        "owner claims are private and cannot transfer or disappear",
        async () => {
          equal(
            (await alice.claims.get("alice-site"))?.portfolioId,
            "portfolio-a",
          );
          equal(await bob.claims.get("alice-site"), undefined);
          equal(await bob.claims.current(), undefined);
          await rejects(() =>
            db
              .update(schema.subdomainClaim)
              .set({ portfolioId: "portfolio-b" })
              .where(eq(schema.subdomainClaim.name, "alice-site")),
          );
          await rejects(() =>
            db
              .delete(schema.subdomainClaim)
              .where(eq(schema.subdomainClaim.name, "alice-site")),
          );
          await rejects(() =>
            db
              .update(schema.subdomainClaim)
              .set({ name: "renamed-site" })
              .where(eq(schema.subdomainClaim.name, "alice-site")),
          );
        },
      );
      await check(
        "reserved and invalid subdomains cannot be inserted",
        async () => {
          for (const name of [
            "assets",
            "www",
            "Aaa",
            "ab",
            "a".repeat(31),
            "-abc",
            "abc-",
            "a.b",
            "ab_c",
          ]) {
            await rejects(() =>
              db
                .insert(schema.subdomainClaim)
                .values({ name, portfolioId: "portfolio-b" }),
            );
          }
        },
      );
      await check(
        "GitHub selection and recipient writes ignore injected portfolio IDs",
        async () => {
          await alice.github.select({ id: "1", login: "alice" }, null);
          await alice.recipient.save({
            email: "private@hasaweb.invalid",
            verifiedAt: now,
          });
          equal(await bob.github.getConnection(), undefined);
          equal(await bob.github.getActivity(), undefined);
          equal(await bob.recipient.get(), undefined);
          const selected = {
            id: "2",
            login: "bob",
            portfolioId: "portfolio-a",
          };
          await bob.github.select(selected, null);
          await bob.recipient.save({
            email: "bob@hasaweb.invalid",
            portfolioId: "portfolio-a",
          } as { email: string });
          await bob.github.disconnect(1);
          equal((await alice.github.getConnection())?.identity.login, "alice");
          equal(
            (await alice.recipient.get())?.email,
            "private@hasaweb.invalid",
          );
        },
      );
      await check(
        "GitHub disconnect advances generation and retains public selection",
        async () => {
          await alice.github.disconnect(1);
          equal((await alice.github.getConnection())?.generation, 2);
          equal((await alice.github.getConnection())?.privateEnabled, false);
          equal((await alice.github.getConnection())?.identity.login, "alice");
        },
      );
      await check(
        "outbox payloads and delivery statuses stay within their owner",
        async () => {
          const message = {
            id: "message-a",
            payload: { message: "private message" },
            acceptedAt: now,
            deadlineAt: new Date(now.getTime() + 86_400_000),
            budgetWindowStart: 0,
            portfolioId: "portfolio-b",
            status: "sent",
          };
          equal(
            (await alice.outbox.create(message))?.portfolioId,
            "portfolio-a",
          );
          equal((await alice.outbox.get("message-a"))?.status, "queued");
          equal(await bob.outbox.get("message-a"), undefined);
          equal(await bob.outbox.finalize("message-a", "failed"), undefined);
          equal(await bob.outbox.create(message), undefined);
          equal(await bob.outbox.list(), []);
          equal((await alice.outbox.list())[0]?.status, "queued");
          equal("payload" in ((await alice.outbox.list())[0] ?? {}), false);
          await rejects(() =>
            db
              .update(schema.contactOutbox)
              .set({ status: "sent" })
              .where(eq(schema.contactOutbox.id, "message-a")),
          );
          equal(
            (await alice.outbox.finalize("message-a", "sent"))?.payload,
            null,
          );
          await alice.outbox.create({ ...message, id: "message-failed" });
          equal(
            (
              await alice.outbox.finalize(
                "message-failed",
                "failed",
                "rejected",
              )
            )?.payload,
            null,
          );
        },
      );
      await check(
        "outbox finalization preserves the first terminal result",
        async () => {
          for (const [id, nextStatus] of [
            ["message-a", "failed"],
            ["message-failed", "sent"],
          ] as const) {
            const finalized = await alice.outbox.get(id);
            equal(
              await alice.outbox.finalize(id, nextStatus, "late attempt"),
              undefined,
            );
            equal(
              await alice.outbox.finalize(
                id,
                finalized?.status === "sent" ? "sent" : "failed",
                "duplicate attempt",
              ),
              undefined,
            );
            equal(await alice.outbox.get(id), finalized);
          }
          const competing = await ownerRepositories(env.DB, identity("alice"));
          for (const initialStatus of ["queued", "sending"] as const) {
            const id = `overlapping-${initialStatus}`;
            await alice.outbox.create({
              id,
              payload: { message: "private" },
              acceptedAt: now,
              deadlineAt: new Date(now.getTime() + 86_400_000),
              budgetWindowStart: 0,
            });
            if (initialStatus === "sending")
              await db
                .update(schema.contactOutbox)
                .set({ status: "sending" })
                .where(eq(schema.contactOutbox.id, id));
            const results = await Promise.all([
              alice.outbox.finalize(id, "sent"),
              competing.outbox.finalize(id, "failed", "overlapping failure"),
            ]);
            const winners = results.filter((result) => result !== undefined);
            equal(winners.length, 1);
            equal(await alice.outbox.get(id), winners[0]);
            equal(winners[0]?.payload, null);
          }
        },
      );
      await check(
        "owner counters are atomic and cannot access other owners or global budgets",
        async () => {
          await db
            .insert(schema.counter)
            .values({ key: "email-budget", windowStart: 0, count: 90 });
          await Promise.all(
            Array.from({ length: 8 }, () =>
              alice.counters.increment("edits", 0),
            ),
          );
          equal((await alice.counters.get("edits", 0))?.count, 8);
          equal(await bob.counters.get("edits", 0), undefined);
          equal(
            await bob.counters.get(
              JSON.stringify(["owner", "alice", "edits"]),
              0,
            ),
            undefined,
          );
          equal(await alice.counters.get("email-budget", 0), undefined);
          await bob.counters.increment("email-budget", 0);
          equal(
            (
              await db
                .select()
                .from(schema.counter)
                .where(eq(schema.counter.key, "email-budget"))
                .get()
            )?.count,
            90,
          );
        },
      );
      await check(
        "provider listings omit token fields and other owners",
        async () => {
          await db.insert(schema.account).values({
            id: "github-a",
            accountId: "github-1",
            providerId: "github",
            userId: "alice",
            accessToken: "secret",
            createdAt: now,
            updatedAt: now,
          });
          equal(await alice.providers.list(), [
            { id: "github-a", providerId: "github", accountId: "github-1" },
          ]);
          equal(await bob.providers.list(), []);
        },
      );
      const origin = new URL(request.url).origin;
      const auth = betterAuth({
        secret,
        baseURL: origin,
        database: drizzleAdapter(db, { provider: "sqlite", schema }),
        session: { cookieCache: { enabled: true, maxAge: 300 } },
        telemetry: { enabled: false },
        logger: { level: "error" },
      });
      const readSession = (headers: Headers) =>
        auth.api.getSession({ headers });
      const api = ownerApi(
        { db: env.DB, origin, readSession },
        async (apiRequest, repo) => {
          if (!["GET", "HEAD", "OPTIONS"].includes(apiRequest.method))
            await repo.counters.increment("api-mutations", 0);
          return privateJson(await repo.portfolio.get());
        },
      );
      const cookie = await signedCookie("token-alice");
      function req(
        method = "GET",
        headers: Record<string, string> = {},
        url = origin,
      ) {
        return new Request(url, {
          method,
          headers: { Cookie: cookie, ...headers },
        });
      }
      await check(
        "real Better Auth session resolves an owner through the shared guard",
        async () => {
          const response = await api(req());
          equal(response.status, 200);
          equal(((await response.json()) as { id: string }).id, "portfolio-a");
          equal(response.headers.get("Cache-Control"), "private, no-store");
          equal(response.headers.get("X-Robots-Tag"), "noindex");
        },
      );
      await check("mutations require exact origin and JSON", async () => {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          for (const originHeader of [
            "",
            "null",
            "https://bob.hasaweb.site",
            "https://hasaweb.site.attacker.invalid",
          ]) {
            equal(
              (
                await api(
                  req(method, {
                    Origin: originHeader,
                    "Content-Type": "application/json",
                  }),
                )
              ).status,
              403,
            );
          }
          equal(
            (
              await api(
                req(method, { Origin: origin, "Content-Type": "text/plain" }),
              )
            ).status,
            415,
          );
          equal(
            (
              await api(
                req(method, {
                  Origin: origin,
                  "Content-Type": "application/json; charset=utf-8",
                }),
              )
            ).status,
            200,
          );
        }
        equal(
          (await api(req("GET", {}, "https://bob.hasaweb.site"))).status,
          404,
        );
      });
      await check(
        "rejected mutations never reach the write handler",
        async () => {
          equal((await alice.counters.get("api-mutations", 0))?.count, 4);
          equal(
            (
              await api(
                req("POST", {
                  Origin: origin,
                  "Content-Type": "application/jsonp",
                }),
              )
            ).status,
            415,
          );
          equal((await alice.counters.get("api-mutations", 0))?.count, 4);
        },
      );
      await check(
        "missing or forged session cookies cannot open private records",
        async () => {
          equal((await api(new Request(origin))).status, 401);
          equal(
            (
              await api(
                req("GET", { Cookie: "better-auth.session_token=forged" }),
              )
            ).status,
            401,
          );
          await rejects(() =>
            ownerRepositories(env.DB, {
              user: { id: "alice" },
              session: { id: "session-bob" },
            }),
          );
        },
      );
      await db
        .update(schema.user)
        .set({ deletingAt: now })
        .where(eq(schema.user.id, "deleting"));
      await db
        .update(schema.session)
        .set({ expiresAt: new Date(0) })
        .where(eq(schema.session.id, "session-expired"));
      await db
        .delete(schema.session)
        .where(eq(schema.session.id, "session-revoked"));
      await check(
        "cached identities cannot bypass deletion, expiry, revocation, or a mismatched owner",
        async () => {
          for (const id of ["deleting", "expired", "revoked"]) {
            const cached = ownerApi(
              { db: env.DB, origin, readSession: async () => identity(id) },
              async () => privateJson({ leaked: true }),
            );
            equal((await cached(req())).status, 401);
            await rejects(() => ownerRepositories(env.DB, identity(id)));
          }
        },
      );
      await check(
        "real Better Auth cookie cache cannot bypass a revoked D1 session",
        async () => {
          const cachedToken = await signedCookie("token-cached");
          const sessionResponse = await auth.api.getSession({
            headers: new Headers({ Cookie: cachedToken }),
            asResponse: true,
          });
          equal(sessionResponse.status, 200);
          const cachedCookie = [
            cachedToken,
            ...sessionResponse.headers
              .getSetCookie()
              .map((value) => value.split(";")[0]),
          ].join("; ");
          if (!cachedCookie.includes("session_data="))
            throw new Error("Expected Better Auth's session cache cookie");
          await db
            .delete(schema.session)
            .where(eq(schema.session.id, "session-cached"));
          const cachedIdentity = await auth.api.getSession({
            headers: new Headers({ Cookie: cachedCookie }),
          });
          equal(cachedIdentity?.user.id, "cached");
          equal((await api(req("GET", { Cookie: cachedCookie }))).status, 401);
        },
      );
      await check(
        "session and database dependency errors fail closed",
        async () => {
          const failing = ownerApi(
            {
              db: env.DB,
              origin,
              readSession: async () => {
                throw new Error("unavailable");
              },
            },
            async () => privateJson({ leaked: true }),
          );
          equal((await failing(req())).status, 503);
          const unavailableDatabase = ownerApi(
            { db: env.DB, origin, readSession: async () => identity("alice") },
            async () => privateJson({ leaked: true }),
          );
          await env.DB.prepare(
            "ALTER TABLE session RENAME TO unavailable_session",
          ).run();
          try {
            equal((await unavailableDatabase(req())).status, 503);
          } finally {
            await env.DB.prepare(
              "ALTER TABLE unavailable_session RENAME TO session",
            ).run();
          }
        },
      );
      await check(
        "previously opened repositories lose access immediately on revocation",
        async () => {
          const held = await ownerRepositories(env.DB, identity("held"));
          await held.assets.create({
            id: "held-asset",
            kind: "avatar",
            contentType: "image/png",
            bytes: 1,
          });
          await held.versions.create({
            id: "held-version",
            n: 1,
            rendererVersion: "test",
          });
          await held.counters.increment("edits", 0);
          await db
            .delete(schema.session)
            .where(eq(schema.session.id, "session-held"));
          equal(await held.portfolio.get(), undefined);
          equal(await held.assets.get("held-asset"), undefined);
          equal(await held.assets.setStatus("held-asset", "ready"), undefined);
          equal(await held.assets.remove("held-asset"), undefined);
          equal(await held.versions.fail("held-version", "revoked"), undefined);
          equal(await held.counters.get("edits", 0), undefined);
          await held.counters.increment("edits", 0).catch(() => undefined);
          equal(
            (
              await db
                .select()
                .from(schema.counter)
                .where(
                  eq(
                    schema.counter.key,
                    JSON.stringify(["owner", "held", "edits"]),
                  ),
                )
                .get()
            )?.count,
            1,
          );
          await rejects(() =>
            held.assets.create({
              id: "no-session",
              kind: "avatar",
              contentType: "image/png",
              bytes: 1,
            }),
          );
          await rejects(() =>
            held.github.select({ id: "3", login: "held" }, null),
          );
          await rejects(() =>
            held.recipient.save({ email: "held@hasaweb.invalid" }),
          );
          equal((await held.assets.list()).length, 0);
          equal((await held.versions.list()).length, 0);
        },
      );
      await check(
        "previously opened repositories lose access when account deletion starts",
        async () => {
          await db
            .update(schema.user)
            .set({ deletingAt: now })
            .where(eq(schema.user.id, "bob"));
          equal(await bob.portfolio.get(), undefined);
          equal(await bob.github.getConnection(), undefined);
          equal(await bob.github.getActivity(), undefined);
          equal(await bob.recipient.get(), undefined);
          equal(await bob.versions.get("version-b"), undefined);
          equal(await bob.providers.list(), []);
          await rejects(() => bob.portfolio.create("after-deletion", draft()));
        },
      );
      await check(
        "account deletion cascades private rows, audits, and owner counters but retains only the claim name",
        async () => {
          await db
            .insert(schema.subdomainClaim)
            .values({ name: "bob-site", portfolioId: "portfolio-b" });
          await db.insert(schema.operatorEmailAudit).values({
            id: "audit-b",
            operatorId: "operator",
            accountId: "bob",
            caseReference: "case-1",
            accessedAt: now,
          });
          await db.delete(schema.user).where(eq(schema.user.id, "bob"));
          equal(
            await db
              .select()
              .from(schema.subdomainClaim)
              .where(eq(schema.subdomainClaim.name, "bob-site"))
              .get(),
            {
              state: "claimed",
              heldAt: null,
              claimedAt: null,
              name: "bob-site",
              portfolioId: null,
            },
          );
          await rejects(() =>
            db
              .update(schema.subdomainClaim)
              .set({ portfolioId: "portfolio-a" })
              .where(eq(schema.subdomainClaim.name, "bob-site")),
          );
          equal(
            (
              await db
                .select()
                .from(schema.portfolio)
                .where(eq(schema.portfolio.userId, "bob"))
            ).length,
            0,
          );
          equal((await db.select().from(schema.operatorEmailAudit)).length, 0);
          equal(
            (
              await db
                .select()
                .from(schema.counter)
                .where(eq(schema.counter.userId, "bob"))
            ).length,
            0,
          );
          equal(
            (
              await db
                .select()
                .from(schema.githubConnection)
                .where(eq(schema.githubConnection.portfolioId, "portfolio-b"))
            ).length,
            0,
          );
          equal(
            (
              await db
                .select()
                .from(schema.publishVersion)
                .where(eq(schema.publishVersion.portfolioId, "portfolio-b"))
            ).length,
            0,
          );
        },
      );
      await runGitHubChecks(env.DB, check);
      await runProvisionChecks(env.DB, check);
      return privateJson({ passed: checks.length, checks });
    } catch (error) {
      return privateJson(
        {
          passed: checks.length,
          checks,
          failed: current,
          error: String(error),
          cause: error instanceof Error ? String(error.cause ?? "") : "",
        },
        500,
      );
    }
  },
} satisfies ExportedHandler<{ DB: D1Database; APP_ENV: string }>;
