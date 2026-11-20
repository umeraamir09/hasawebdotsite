import {
  account,
  OwnerAccessError,
  ownerRepositories,
  ownerSignInProviders,
  privateJson,
  SIGN_IN_PROVIDERS,
  type SignInProvider,
  session,
  user,
  verification,
} from "@hasaweb/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getOAuthState, getSessionFromCtx } from "better-auth/api";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { providerPhotoUrl } from "./provider-photo";

export { providerPhotoUrl } from "./provider-photo";

/**
 * Fixed returns for connecting another sign-in provider from the editor
 * (Phase 47). Better Auth appends `error` to the second one.
 */
export const LINK_RETURNS = {
  connected: "/editor?account=connected",
  failed: "/editor?account=not-connected",
} as const;

export type AuthEnvironment = {
  APP_ENV: string;
  APP_ORIGIN?: string;
  BETTER_AUTH_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DB: D1Database;
};

export function authSettings(env: AuthEnvironment) {
  const origin = env.APP_ORIGIN;
  if (!origin || new URL(origin).origin !== origin)
    throw new Error("Configure APP_ORIGIN as an exact origin");
  const url = new URL(origin);
  const local =
    env.APP_ENV === "local" &&
    ["127.0.0.1", "localhost"].includes(url.hostname);
  if (!local && origin !== "https://hasaweb.site")
    throw new Error("Authentication requires the HTTPS application apex");
  if (local && !["http:", "https:"].includes(url.protocol))
    throw new Error("Invalid local protocol");
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Configure a signing secret of at least 32 characters");
  const github = {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };
  const google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
  if (
    !github.clientId ||
    !github.clientSecret ||
    !google.clientId ||
    !google.clientSecret
  )
    throw new Error("Configure both OAuth providers");
  return {
    origin,
    secret,
    secure: url.protocol === "https:",
    github: { clientId: github.clientId, clientSecret: github.clientSecret },
    google: { clientId: google.clientId, clientSecret: google.clientSecret },
  };
}

// Next reconstructs local URLs with localhost. Validate the original authority
// before restoring the configured origin; never trust forwarded host headers.
export function appAuthRequest(request: Request, env: AuthEnvironment) {
  const { origin } = authSettings(env);
  if (request.headers.get("host") !== new URL(origin).host) return null;
  const url = new URL(request.url);
  return new Request(`${origin}${url.pathname}${url.search}`, request);
}

export function createProductAuth(env: AuthEnvironment) {
  const settings = authSettings(env);
  const db = drizzle(env.DB);
  return betterAuth({
    secret: settings.secret,
    baseURL: settings.origin,
    trustedOrigins: [settings.origin],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        ...settings.github,
        disableDefaultScope: true,
        scope: ["user:email"],
      },
      google: { ...settings.google },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        requireLocalEmailVerified: true,
        // Consulted only by explicit linking from the editor, where the owner
        // is signed in and completes the provider's OAuth flow (proof of
        // ownership). Sign-in still links automatically only on a matching
        // provider-verified email; the linked provider's email must still be
        // verified.
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
      },
    },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
    databaseHooks: {
      account: {
        create: {
          // One account per provider per owner, and none for an owner being
          // deleted. A link callback that would add a second GitHub or
          // Google account fails without changing anything.
          async before(value, context) {
            // Better Auth binds a link flow to the browser and the user who
            // started it. Also require that user's live session at the
            // callback, so a flow abandoned before sign-out cannot be
            // finished by whoever signs in next on that browser.
            const link = (await getOAuthState())?.link;
            if (link) {
              const current = context
                ? await getSessionFromCtx(context, {
                    disableCookieCache: true,
                  }).catch(() => null)
                : null;
              if (
                link.userId !== value.userId ||
                current?.user.id !== link.userId
              )
                return false;
            }
            const row = await env.DB.prepare(
              `SELECT EXISTS(SELECT 1 FROM user WHERE id=? AND deleting_at IS NOT NULL)
                OR EXISTS(SELECT 1 FROM account WHERE user_id=? AND provider_id=?) AS blocked`,
            )
              .bind(value.userId, value.userId, value.providerId)
              .first<{ blocked: number }>();
            return !row?.blocked;
          },
        },
      },
      session: {
        create: {
          async before(value) {
            const owner = await db
              .select({ deletingAt: user.deletingAt })
              .from(user)
              .where(eq(user.id, value.userId))
              .get();
            return !!owner && owner.deletingAt === null;
          },
        },
      },
    },
    advanced: {
      // Secure is explicit. This avoids prepending __Secure- to __Host-.
      useSecureCookies: false,
      cookiePrefix: settings.secure ? "__Host-hasaweb" : "hasaweb-local",
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: {
        secure: settings.secure,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    },
    onAPIError: { errorURL: `${settings.origin}/sign-in` },
    telemetry: { enabled: false },
    logger: { disabled: true },
  });
}
export type ProductAuth = ReturnType<typeof createProductAuth>;

// Configuration only is cached per binding environment, never an owner/session.
const instances = new WeakMap<AuthEnvironment, ProductAuth>();
export function productAuth(env: AuthEnvironment) {
  let auth = instances.get(env);
  if (!auth) {
    auth = createProductAuth(env);
    instances.set(env, auth);
  }
  return auth;
}

// Callers must check persisted access in their own database operation. This
// resolves only the library-verified identity, with cookie caching disabled.
export async function currentSessionIdentity(
  env: AuthEnvironment,
  headers: Headers,
  {
    auth = productAuth(env),
    refresh = true,
  }: { auth?: ProductAuth; refresh?: boolean } = {},
) {
  return auth.api.getSession({
    headers,
    query: {
      disableCookieCache: true,
      ...(!refresh ? { disableRefresh: true } : {}),
    },
  });
}

export async function currentOwner(
  env: AuthEnvironment,
  headers: Headers,
  auth = productAuth(env),
) {
  const identity = await currentSessionIdentity(env, headers, { auth });
  if (!identity) return null;
  // Independently checks persisted session expiry, revocation and deletion.
  const repositories = await ownerRepositories(env.DB, identity);
  return { identity, repositories };
}

export async function ownerResponse(
  request: Request,
  env: AuthEnvironment,
  auth = productAuth(env),
) {
  if (new URL(request.url).origin !== authSettings(env).origin)
    return privateJson(null, 404);
  try {
    const owner = await currentOwner(env, request.headers, auth);
    if (!owner) return privateJson(null, 401);
    return await ownerSummaryResponse(request, owner);
  } catch (error) {
    return privateJson(null, error instanceof OwnerAccessError ? 401 : 503);
  }
}

export async function ownerSummaryResponse(
  request: Request,
  owner: NonNullable<Awaited<ReturnType<typeof currentOwner>>>,
) {
  const include = new URL(request.url).searchParams.get("include");
  const suggestEmail = include === "email-suggestion";
  const suggestProfile = include === "profile-suggestions";
  if (suggestEmail || suggestProfile) {
    const expected = request.headers.get("X-Expected-Owner-Id");
    if (!expected)
      return privateJson({ error: "expected_owner_required" }, 400);
    if (expected !== owner.identity.user.id)
      return privateJson({ error: "owner_changed" }, 409);
  }
  const portfolio = await owner.repositories.portfolio.summary();
  return privateJson({
    user: { id: owner.identity.user.id, name: owner.identity.user.name },
    portfolio: portfolio ? { id: portfolio.id } : null,
    ...(suggestEmail ? { emailSuggestion: owner.identity.user.email } : {}),
    ...(suggestProfile
      ? {
          profileSuggestions: {
            name: owner.identity.user.name,
            photoAvailable:
              providerPhotoUrl(owner.identity.user.image) !== null,
          },
        }
      : {}),
  });
}

// Exactly a provider and the two fixed returns: no ID tokens, scopes, login
// hints or extra data, so linking can only start the normal OAuth flow.
async function linkBody(request: Request) {
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const provider = SIGN_IN_PROVIDERS.find((item) => item === value.provider);
  if (
    !provider ||
    Object.keys(value).some(
      (key) => !["provider", "callbackURL", "errorCallbackURL"].includes(key),
    )
  )
    return null;
  return {
    provider,
    callbackURL: value.callbackURL,
    errorCallbackURL: value.errorCallbackURL,
  };
}

export async function authResponse(
  request: Request,
  env: AuthEnvironment,
  auth = productAuth(env),
) {
  const { origin } = authSettings(env);
  const url = new URL(request.url);
  if (url.origin !== origin) return privateJson(null, 404);
  const path = url.pathname.replace(/\/$/, "");
  const read = request.method === "GET";
  if (!read && request.method !== "POST") return privateJson(null, 405);
  if (!read) {
    if (request.headers.get("Origin") !== origin) return privateJson(null, 403);
    if (
      request.headers
        .get("Content-Type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return privateJson(null, 415);
  }
  // Listing and disconnecting providers are owner routes in jobs, so
  // disconnecting GitHub can withdraw private activity first. Only linking,
  // which needs the OAuth state, runs here.
  const allowed = read
    ? [
        "/api/auth/get-session",
        "/api/auth/callback/github",
        "/api/auth/callback/google",
        "/api/auth/error",
      ]
    : [
        "/api/auth/sign-in/social",
        "/api/auth/link-social",
        "/api/auth/sign-out",
      ];
  if (!allowed.includes(path)) return privateJson(null, 404);
  if (path === "/api/auth/get-session")
    return ownerResponse(request, env, auth);
  if (path === "/api/auth/sign-in/social") {
    let body: Record<string, unknown>;
    try {
      body = await request.clone().json();
    } catch {
      return privateJson(null, 400);
    }
    if (
      !body ||
      !["github", "google"].includes(String(body.provider)) ||
      Object.keys(body).some(
        (key) => !["provider", "callbackURL", "errorCallbackURL"].includes(key),
      )
    )
      return privateJson(null, 400);
    const errorURL = `${origin}/sign-in?provider=${body.provider}`;
    const normal =
      body.callbackURL === `${origin}/auth/entry` &&
      body.errorCallbackURL === errorURL;
    const recovery =
      body.callbackURL === `${origin}/auth/recovery` &&
      body.errorCallbackURL === `${origin}/auth/recovery/error`;
    if (!normal && !recovery) return privateJson(null, 403);
  }
  if (path === "/api/auth/link-social") {
    const body = await linkBody(request);
    if (!body) return privateJson(null, 400);
    if (
      body.callbackURL !== `${origin}${LINK_RETURNS.connected}` ||
      body.errorCallbackURL !== `${origin}${LINK_RETURNS.failed}`
    )
      return privateJson(null, 403);
    let connected: SignInProvider[];
    try {
      const owner = await currentOwner(env, request.headers, auth);
      if (!owner) return privateJson(null, 401);
      connected = await ownerSignInProviders(
        env.DB,
        owner.identity,
      ).connected();
    } catch (error) {
      return privateJson(null, error instanceof OwnerAccessError ? 401 : 503);
    }
    if (connected.includes(body.provider))
      return privateJson({ error: "already_connected" }, 409);
  }
  const response = await auth.handler(request);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex");
  headers.append("Vary", "Cookie");
  return new Response(response.body, { status: response.status, headers });
}
