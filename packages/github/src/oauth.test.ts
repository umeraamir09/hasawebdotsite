import { describe, expect, it } from "vitest";
import {
  activityAuthorizeUrl,
  consentStateHash,
  exchangeActivityCode,
  hasActivityScope,
  isConsentValue,
  pkceChallenge,
  randomConsentValue,
} from "./oauth";

describe("activity consent", () => {
  it("computes the RFC 7636 S256 challenge", async () => {
    // Appendix B of RFC 7636.
    expect(
      await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("creates distinct 256-bit URL-safe values and hashes states", async () => {
    const a = randomConsentValue();
    const b = randomConsentValue();
    expect(a).not.toBe(b);
    expect(isConsentValue(a)).toBe(true);
    expect(isConsentValue(`${a}=`)).toBe(false);
    expect(isConsentValue("short")).toBe(false);
    expect(await consentStateHash(a)).toMatch(/^[a-f\d]{64}$/);
    expect(await consentStateHash(a)).not.toBe(await consentStateHash(b));
  });
  it("accepts read:user, alone or with the sign-in app's user:email", () => {
    expect(hasActivityScope("read:user")).toBe(true);
    expect(hasActivityScope(" read:user ")).toBe(true);
    expect(hasActivityScope("read:user, user:email")).toBe(true);
    expect(hasActivityScope("user:email,read:user")).toBe(true);
    for (const value of [
      "",
      null,
      "user",
      "user:email",
      "read:user,repo",
      "read:user,user:email,repo",
      "repo",
    ])
      expect(hasActivityScope(value)).toBe(false);
  });
  it("builds an authorize URL for the activity app with PKCE and the selected login", () => {
    const url = new URL(
      activityAuthorizeUrl({
        oauthOrigin: "https://github.com",
        clientId: "activity-client",
        redirectUri: "https://hasaweb.site/api/owner/github/consent/callback",
        state: "s".repeat(43),
        challenge: "c".repeat(43),
        login: "Fixture-Owner",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "activity-client",
      redirect_uri: "https://hasaweb.site/api/owner/github/consent/callback",
      scope: "read:user",
      state: "s".repeat(43),
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
      login: "Fixture-Owner",
      allow_signup: "false",
    });
  });
  it("exchanges the code with the verifier and returns any delivered token", async () => {
    const app = { id: "activity-client", secret: "activity-secret" };
    const input = {
      code: "code-1",
      verifier: "v".repeat(43),
      redirectUri: "https://hasaweb.site/api/owner/github/consent/callback",
    };
    let sent: URLSearchParams | null = null;
    const result = await exchangeActivityCode(
      async (url, init) => {
        expect(url).toBe("https://github.com/login/oauth/access_token");
        expect(init.redirect).toBe("manual");
        sent = init.body as URLSearchParams;
        return Response.json({ access_token: "gho_x", scope: "read:user" });
      },
      "https://github.com",
      app,
      input,
    );
    expect(result).toEqual({
      status: "token",
      token: "gho_x",
      scopes: "read:user",
    });
    expect(Object.fromEntries(sent ?? [])).toEqual({
      client_id: "activity-client",
      client_secret: "activity-secret",
      code: "code-1",
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    });
    // A token with the wrong scope is still returned so it can be revoked.
    expect(
      await exchangeActivityCode(
        async () => Response.json({ access_token: "gho_y", scope: "repo" }),
        "https://github.com",
        app,
        input,
      ),
    ).toEqual({ status: "token", token: "gho_y", scopes: "repo" });
  });
  it("classifies exchanges that delivered no token", async () => {
    const run = (transport: () => Promise<Response>) =>
      exchangeActivityCode(
        transport,
        "https://github.com",
        { id: "a", secret: "b" },
        { code: "c", verifier: "v".repeat(43), redirectUri: "https://x/cb" },
      );
    expect(
      await run(async () => Response.json({ error: "bad_verification_code" })),
    ).toEqual({ status: "none", reason: "code" });
    expect(await run(async () => Response.json({ error: "other" }))).toEqual({
      status: "none",
      reason: "provider",
    });
    expect(
      await run(async () => new Response("<html>", { status: 502 })),
    ).toEqual({ status: "none", reason: "provider" });
    expect(await run(async () => new Response(null, { status: 302 }))).toEqual({
      status: "none",
      reason: "provider",
    });
    expect(
      await run(async () => {
        throw new Error("offline");
      }),
    ).toEqual({ status: "none", reason: "network" });
  });
});
