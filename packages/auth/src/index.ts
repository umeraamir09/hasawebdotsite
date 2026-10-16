import {
  account,
  OwnerAccessError,
  ownerRepositories,
  privateJson,
  session,
  user,
  verification,
} from "@hasaweb/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

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
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
    },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
    databaseHooks: {
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

export async function currentOwner(
  env: AuthEnvironment,
  headers: Headers,
  auth = productAuth(env),
) {
  const identity = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
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
    const portfolio = await owner.repositories.portfolio.get();
    return privateJson({
      user: { id: owner.identity.user.id, name: owner.identity.user.name },
      portfolio: portfolio ? { id: portfolio.id } : null,
    });
  } catch (error) {
    return privateJson(null, error instanceof OwnerAccessError ? 401 : 503);
  }
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
  // Connected-provider/account-management endpoints belong to Phase 47.
  const allowed = read
    ? [
        "/api/auth/get-session",
        "/api/auth/callback/github",
        "/api/auth/callback/google",
        "/api/auth/error",
      ]
    : ["/api/auth/sign-in/social", "/api/auth/sign-out"];
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
    if (
      body.callbackURL !== `${origin}/editor` ||
      body.errorCallbackURL !== errorURL
    )
      return privateJson(null, 403);
  }
  const response = await auth.handler(request);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex");
  headers.append("Vary", "Cookie");
  return new Response(response.body, { status: response.status, headers });
}
