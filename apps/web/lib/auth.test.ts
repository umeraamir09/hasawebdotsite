import { describe, expect, it } from "vitest";
import { type AuthEnvironment, appAuthRequest, authSettings } from "./auth";
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
    expect(
      authErrorMessage("<script>secret-provider-detail</script>"),
    ).not.toContain("script");
  });
});
