import { authSettings } from "@hasaweb/auth";
import {
  choosePublicOnly,
  type GraphFailure,
  ownerGraphSetup,
  ownerPrivateActivity,
  type PrivateEnvironment,
  privateJson,
  runGitHubCleanups,
  SaveError,
  withdrawPrivateActivity,
} from "@hasaweb/db";
import type { GitHubTransport } from "@hasaweb/github";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { readBody } from "./draft-routes";
import type { OwnerBindings } from "./owner-api";

export type GitHubBindings = {
  // The separate zero-scope platform credential. Never an owner token.
  GITHUB_SERVICE_TOKEN: string;
  // Fixtures only. Ignored unless APP_ENV is local or test. It also stands in
  // for github.com (authorize page and token exchange).
  GITHUB_API_ORIGIN: string;
  // The separate private-activity OAuth app (never the sign-in app).
  GITHUB_ACTIVITY_CLIENT_ID: string;
  GITHUB_ACTIVITY_CLIENT_SECRET: string;
  // Base64 of 32 random bytes: the AES-GCM key for stored activity tokens.
  GITHUB_ACTIVITY_KEY: string;
};

/** The activity app's registered callback, relative to APP_ORIGIN. */
export const CONSENT_CALLBACK_PATH = "/api/owner/github/consent/callback";
const RETURN_PATHS = { editor: "/editor?github=consent" } as const;

/**
 * The controlled return after a consent callback. The URL carries no outcome:
 * the editor reads the persisted private state from the status route.
 */
export function consentReturn(returnTo: keyof typeof RETURN_PATHS = "editor") {
  return new Response(null, {
    status: 303,
    headers: {
      Location: RETURN_PATHS[returnTo],
      "Cache-Control": "private, no-store",
      // The callback URL held the code and state. Never send it onward.
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}

type ActivityBindings = Partial<GitHubBindings> & { APP_ENV: string };
const keys = new Map<string, Promise<CryptoKey>>();
function activityKey(encoded: string) {
  let key = keys.get(encoded);
  if (!key) {
    key = (async () => {
      const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      if (raw.byteLength !== 32) throw new Error("Invalid activity key");
      return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]);
    })();
    keys.set(encoded, key);
    key.catch(() => keys.delete(encoded));
  }
  return key;
}

const fixtureOrigin = (env: ActivityBindings) =>
  ["local", "test"].includes(env.APP_ENV) ? env.GITHUB_API_ORIGIN : undefined;

/** The activity app, or null when this deployment has none configured. */
export async function activityEnvironment(
  env: ActivityBindings,
  appOrigin: string,
): Promise<PrivateEnvironment | null> {
  if (
    !env.GITHUB_ACTIVITY_CLIENT_ID ||
    !env.GITHUB_ACTIVITY_CLIENT_SECRET ||
    !env.GITHUB_ACTIVITY_KEY
  )
    return null;
  return {
    transport: transport(env),
    app: {
      id: env.GITHUB_ACTIVITY_CLIENT_ID,
      secret: env.GITHUB_ACTIVITY_CLIENT_SECRET,
    },
    key: await activityKey(env.GITHUB_ACTIVITY_KEY),
    oauthOrigin: fixtureOrigin(env) ?? "https://github.com",
    callbackUrl: `${appOrigin}${CONSENT_CALLBACK_PATH}`,
  };
}

// A present but unusable activity secret (for example a key that is not 32
// bytes). Revocation cannot run without it: queued tokens are encrypted with
// that key and GitHub's delete needs the token. Rows stay queued until it is
// repaired, so this must be visible in the logs, never mistaken for "unset".
function reportMisconfigured(error: unknown) {
  console.error(
    "github activity app misconfigured; private consent and grant revocation are paused",
    error instanceof Error ? error.message : typeof error,
  );
}

/** Runs due grant revocations. The scheduled sweep retries what remains. */
export async function sweepGitHubCleanups(
  env: ActivityBindings & { DB: D1Database },
  appOrigin = "",
) {
  let activity: PrivateEnvironment | null;
  try {
    activity = await activityEnvironment(env, appOrigin);
  } catch (error) {
    reportMisconfigured(error);
    throw error;
  }
  if (!activity) return [];
  return runGitHubCleanups(env.DB, activity);
}

const setupSchema = z.strictObject({ username: z.string().min(1).max(64) });
const consentSchema = z.strictObject({ returnTo: z.literal("editor") });
const emptySchema = z.strictObject({});
const failureStatus = {
  invalid_username: 422,
  not_found: 422,
  unavailable: 503,
  misconfigured: 503,
  too_soon: 429,
  conflict: 409,
  no_graph: 409,
} as const satisfies Record<GraphFailure, number>;
const consentStatus = {
  no_graph: 409,
  already_authorized: 409,
  consent_busy: 409,
} as const;

function transport(env: ActivityBindings): GitHubTransport {
  const fixture = fixtureOrigin(env);
  return (url: string, init: RequestInit) => {
    if (!fixture) return fetch(url, init);
    const target = new URL(url);
    return fetch(new URL(`${target.pathname}${target.search}`, fixture), init);
  };
}

type Service = ReturnType<typeof ownerGraphSetup>;
type Result =
  | { ok: true; status: unknown }
  | { ok: false; error: GraphFailure };
const outcome = (result: Result) => {
  if (result.ok) return privateJson(result.status);
  return privateJson({ error: result.error }, failureStatus[result.error]);
};

// Revocation after a withdrawal or a rejected token starts at once and the
// scheduled sweep retries it. It never delays or changes the response.
function startCleanup(c: Context<OwnerBindings>) {
  const work = sweepGitHubCleanups(c.env, authSettings(c.env).origin).catch(
    () => [],
  );
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context (unit tests): the sweep still runs to completion.
    return work;
  }
}

const closed = (error: unknown) => {
  if (error instanceof z.ZodError || error instanceof SaveError)
    return privateJson({ error: "invalid_input" }, 422);
  if (
    error instanceof Error &&
    error.message === "An active owner portfolio is required"
  )
    return privateJson({ error: "no_portfolio" }, 409);
  // Server log only: the browser gets the closed error below.
  console.error(
    "github graph route failed",
    error instanceof Error ? error.name : typeof error,
  );
  return privateJson({ error: "unavailable" }, 503);
};

export function addGitHubRoutes(app: Hono<OwnerBindings>) {
  // Every handler maps an owner without a portfolio and any storage failure to
  // a closed error. Provider detail never reaches the browser.
  const route = (
    method: "get" | "post",
    path: string,
    handler: (service: Service, c: Context<OwnerBindings>) => Promise<Response>,
  ) =>
    app[method](`/api/owner/github${path}`, async (c) => {
      const token = c.env.GITHUB_SERVICE_TOKEN;
      if (!token) return privateJson({ error: "unavailable" }, 503);
      try {
        // Status, preview, setup, detect and retry need only the platform
        // credential. A broken activity secret disables private activity
        // (reported as unavailable) without taking the public graph down.
        const activity = await activityEnvironment(
          c.env,
          authSettings(c.env).origin,
        ).catch((error: unknown) => {
          reportMisconfigured(error);
          return null;
        });
        return await handler(
          ownerGraphSetup(c.env.DB, c.get("identity"), {
            transport: transport(c.env),
            platformToken: token,
            ...(activity ? { activity } : {}),
          }),
          c,
        );
      } catch (error) {
        return closed(error);
      }
    });

  route("get", "", async (service) => privateJson(await service.status()));
  // The owner's own draft choice. Only `private=1` is meaningful.
  route("get", "/preview", async (service, c) =>
    privateJson({
      graph: await service.preview(c.req.query("private") === "1"),
    }),
  );
  route("post", "/detect", async (service, c) => {
    emptySchema.parse(await readBody(c.req.raw, 256));
    const result = await service.detect();
    return result.ok ? privateJson({ login: result.login }) : outcome(result);
  });
  route("post", "/setup", async (service, c) => {
    const command = setupSchema.parse(await readBody(c.req.raw, 512));
    return outcome(await service.setup(command.username));
  });
  route("post", "/retry", async (service, c) => {
    emptySchema.parse(await readBody(c.req.raw, 256));
    const result = await service.retry();
    // A refresh that GitHub refused queues the grant for revocation.
    await startCleanup(c);
    return outcome(result);
  });

  // Private activity consent. The browser navigates to the returned URL.
  app.post("/api/owner/github/consent", async (c) => {
    try {
      const command = consentSchema.parse(await readBody(c.req.raw, 256));
      const activity = await activityEnvironment(
        c.env,
        authSettings(c.env).origin,
      );
      if (!activity) return privateJson({ error: "private_unavailable" }, 503);
      const result = await ownerPrivateActivity(
        c.env.DB,
        c.get("identity"),
        activity,
      ).start(command.returnTo);
      return result.ok
        ? privateJson({ url: result.url })
        : privateJson({ error: result.error }, consentStatus[result.error]);
    } catch (error) {
      return closed(error);
    }
  });
  // GitHub's redirect. Signed-out visits never reach here: the owner router
  // answers them with the same controlled return before authentication.
  app.get(CONSENT_CALLBACK_PATH, async (c) => {
    let returnTo: "editor" = "editor";
    try {
      const activity = await activityEnvironment(
        c.env,
        authSettings(c.env).origin,
      );
      if (activity) {
        const result = await ownerPrivateActivity(
          c.env.DB,
          c.get("identity"),
          activity,
        ).callback({
          state: c.req.query("state") ?? null,
          code: c.req.query("code") ?? null,
          error: c.req.query("error") ?? null,
        });
        returnTo = result.returnTo;
        if (result.outcome !== "connected" && result.outcome !== "invalid")
          await startCleanup(c);
      }
    } catch (error) {
      console.error(
        "github consent callback failed",
        error instanceof Error ? error.name : typeof error,
      );
      // A failed callback may have queued an issued token. Revoke it now.
      await startCleanup(c);
    }
    return consentReturn(returnTo);
  });
  // Public only and withdrawal need no platform token or activity app, so a
  // misconfigured provider never blocks public setup or graph removal.
  app.post("/api/owner/github/public-only", async (c) => {
    try {
      emptySchema.parse(await readBody(c.req.raw, 256));
      await choosePublicOnly(c.env.DB, c.get("identity"));
      return privateJson({ ok: true });
    } catch (error) {
      return closed(error);
    }
  });
  app.post("/api/owner/github/withdraw", async (c) => {
    try {
      emptySchema.parse(await readBody(c.req.raw, 256));
      const withdrawn = await withdrawPrivateActivity(
        c.env.DB,
        c.get("identity"),
      );
      if (!withdrawn) return privateJson({ error: "conflict" }, 409);
      await startCleanup(c);
      return privateJson({ ok: true });
    } catch (error) {
      return closed(error);
    }
  });
  for (const action of [
    "",
    "/preview",
    "/detect",
    "/setup",
    "/retry",
    "/consent",
    "/consent/callback",
    "/public-only",
    "/withdraw",
  ])
    app.all(`/api/owner/github${action}`, () =>
      privateJson({ error: "invalid_input" }, 405),
    );
}
