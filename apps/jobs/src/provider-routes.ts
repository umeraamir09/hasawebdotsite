import {
  ownerSignInProviders,
  privateJson,
  SaveError,
  SIGN_IN_PROVIDERS,
  withdrawSignInGraph,
} from "@hasaweb/db";
import type { Hono } from "hono";
import { z } from "zod";
import { readBody } from "./draft-routes";
import { startCleanup } from "./github-routes";
import type { OwnerBindings } from "./owner-api";

const disconnectSchema = z.strictObject({
  provider: z.enum(SIGN_IN_PROVIDERS),
});

// Connected sign-in providers (Phase 47). Linking runs through the web auth
// handler, which owns the OAuth state; these routes list and disconnect.
export function addProviderRoutes(app: Hono<OwnerBindings>) {
  app.get("/api/owner/providers", async (c) => {
    const connected = await ownerSignInProviders(
      c.env.DB,
      c.get("identity"),
    ).connected();
    return privateJson({
      providers: SIGN_IN_PROVIDERS.map((provider) => ({
        provider,
        connected: connected.includes(provider),
      })),
    });
  });
  app.post("/api/owner/providers/disconnect", async (c) => {
    // A stale tab must not disconnect another account's provider.
    const expected = c.req.header("X-Expected-Owner-Id");
    if (!expected) return privateJson({ error: "invalid_input" }, 400);
    if (expected !== c.get("identity").user.id)
      return privateJson({ error: "owner_changed" }, 409);
    let provider: (typeof SIGN_IN_PROVIDERS)[number];
    try {
      provider = disconnectSchema.parse(
        await readBody(c.req.raw, 256),
      ).provider;
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SaveError)
        return privateJson({ error: "invalid_input" }, 422);
      throw error;
    }
    const providers = ownerSignInProviders(c.env.DB, c.get("identity"));
    const connected = await providers.connected();
    if (!connected.includes(provider))
      return privateJson({ error: "not_connected" }, 409);
    if (connected.length < 2) return privateJson({ error: "last_method" }, 409);
    if (provider === "github") {
      // The sign-in token is the graph grant only when this portfolio stored
      // it. An activity-app grant for another account stays. A failure leaves
      // sign-in in place so the owner can retry.
      if (
        !(await withdrawSignInGraph(
          c.env.DB,
          c.get("identity"),
          c.env.GITHUB_CLIENT_ID ?? "",
        ))
      )
        return privateJson({ error: "conflict" }, 409);
    }
    const removal = await providers.remove(provider);
    if (provider === "github") await startCleanup(c);
    if (removal !== "removed") return privateJson({ error: removal }, 409);
    return privateJson({ ok: true });
  });
  for (const path of [
    "/api/owner/providers",
    "/api/owner/providers/disconnect",
  ])
    app.all(path, () => privateJson({ error: "invalid_input" }, 405));
}
