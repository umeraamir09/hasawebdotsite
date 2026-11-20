import { describe, expect, it } from "vitest";
import {
  type AuthEnvironment,
  appAuthRequest,
  authResponse,
  authSettings,
} from "./auth";
import { authErrorMessage } from "./auth-client";

const env: AuthEnvironment = {
  APP_ENV: "production",
  APP_ORIGIN: "https://hasaweb.site",
  BETTER_AUTH_SECRET: "fixture-secret-with-at-least-32-characters",
  GITHUB_CLIENT_ID: "fixture",
  GITHUB_CLIENT_SECRET: "fixture",
  GOOGLE_CLIENT_ID: "fixture",
  GOOGLE_CLIENT_SECRET: "fixture",
  DB: {} as D1Database,
};
describe("authentication configuration", () => {
  it("requires the HTTPS apex outside local loopback development", () => {
    expect(authSettings(env).secure).toBe(true);
    for (const origin of [
      "https://alice.hasaweb.site",
      "https://assets.hasaweb.site",
      "http://hasaweb.site",
      "https://hasaweb.site/",
      "https://hasaweb.site:444",
      "http://127.0.0.1:8787",
      "file:///tmp/app",
      "https://hasaweb.site@evil.test",
    ]) {
      expect(() => authSettings({ ...env, APP_ORIGIN: origin })).toThrow();
    }
    expect(
      authSettings({
        ...env,
        APP_ENV: "local",
        APP_ORIGIN: "http://127.0.0.1:8787",
      }).secure,
    ).toBe(false);
    expect(() =>
      authSettings({
        ...env,
        APP_ENV: "local",
        APP_ORIGIN: "http://192.168.0.1:8787",
      }),
    ).toThrow();
  });
  it("checks the actual Host before normalizing Next's internal URL", () => {
    const request = new Request(
      "http://localhost:3000/api/auth/callback/github?state=fixture",
      { headers: { host: "hasaweb.site" } },
    );
    expect(appAuthRequest(request, env)?.url).toBe(
      "https://hasaweb.site/api/auth/callback/github?state=fixture",
    );
    for (const host of [
      "alice.hasaweb.site",
      "evil.test",
      "hasaweb.site:443",
      "",
    ]) {
      const forged = new Request(request.url, {
        headers: {
          host,
          "x-forwarded-host": "hasaweb.site",
          "x-forwarded-proto": "https",
        },
      });
      expect(appAuthRequest(forged, env)).toBe(null);
    }
  });
  it("fails closed with missing or weak credentials", () => {
    for (const key of [
      "APP_ORIGIN",
      "BETTER_AUTH_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ] as const)
      expect(() => authSettings({ ...env, [key]: "" })).toThrow();
    expect(() =>
      authSettings({ ...env, BETTER_AUTH_SECRET: "short" }),
    ).toThrow();
  });
  it("uses controlled recovery copy without reflecting callback details", () => {
    expect(authErrorMessage(null)).toBe(null);
    expect(authErrorMessage("access_denied")).toContain("cancelled");
    expect(authErrorMessage("account_not_linked")).toContain(
      "original provider",
    );
    expect(authErrorMessage("user_email_not_found")).toContain(
      "email settings",
    );
    expect(authErrorMessage("unable_to_link_account")).toContain(
      "connect it again",
    );
    expect(
      authErrorMessage("<script>secret-provider-detail</script>"),
    ).not.toContain("script");
  });
});

describe("connecting another sign-in provider", () => {
  const link = (body: unknown) =>
    authResponse(
      new Request("https://hasaweb.site/api/auth/link-social", {
        method: "POST",
        headers: {
          Origin: "https://hasaweb.site",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      env,
    );
  const fixed = {
    callbackURL: "https://hasaweb.site/editor?account=connected",
    errorCallbackURL: "https://hasaweb.site/editor?account=not-connected",
  };
  it("accepts only a provider with the fixed editor returns", async () => {
    for (const body of [
      null,
      [],
      { ...fixed },
      { ...fixed, provider: "apple" },
      { ...fixed, provider: "github", idToken: { token: "forged" } },
      { ...fixed, provider: "github", scopes: ["repo"] },
      { ...fixed, provider: "google", additionalData: { userId: "other" } },
      { ...fixed, provider: "google", requestSignUp: true },
    ])
      expect((await link(body)).status).toBe(400);
    for (const returns of [
      {
        callbackURL: "https://evil.test/editor",
        errorCallbackURL: fixed.errorCallbackURL,
      },
      {
        callbackURL: "https://hasaweb.site/auth/entry",
        errorCallbackURL: fixed.errorCallbackURL,
      },
      {
        callbackURL: fixed.callbackURL,
        errorCallbackURL: "https://hasaweb.site/sign-in?provider=github",
      },
      {
        callbackURL: `${fixed.callbackURL}&next=/x`,
        errorCallbackURL: fixed.errorCallbackURL,
      },
      {},
    ])
      expect((await link({ provider: "github", ...returns })).status).toBe(403);
  });
});
