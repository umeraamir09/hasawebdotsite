import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { account, session, user, verification } from "./auth";

export function authBehavior(
  db: D1Database,
  secret: string,
  origin: string,
  credentials: {
    github: { clientId: string; clientSecret: string };
    google: { clientId: string; clientSecret: string };
  },
) {
  const auth = betterAuth({
    secret,
    baseURL: origin,
    trustedOrigins: [origin],
    database: drizzleAdapter(drizzle(db), {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    socialProviders: {
      github: {
        ...credentials.github,
        disableDefaultScope: true,
        scope: ["user:email"],
      },
      google: { ...credentials.google },
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
    advanced: {
      // Explicit __Host- names cover every cookie, including OAuth state.
      useSecureCookies: false,
      cookiePrefix: "__Host-hasaweb",
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: {
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    },
    telemetry: { enabled: false },
    logger: { level: "error" },
  });
  return {
    ...auth,
    handler(request: Request) {
      if (new URL(request.url).origin !== origin)
        return Promise.resolve(new Response(null, { status: 404 }));
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        if (request.headers.get("Origin") !== origin)
          return Promise.resolve(new Response(null, { status: 403 }));
        if (
          request.headers.get("Content-Type")?.split(";")[0]?.trim() !==
          "application/json"
        )
          return Promise.resolve(new Response(null, { status: 415 }));
      }
      return auth.handler(request);
    },
  };
}
