import { describe, expect, it } from "vitest";
// @ts-expect-error The isolated Node harness is JavaScript, outside app builds.
import {
  acceptsMutation,
  consumePending,
  createPending,
  exchangeFailure,
} from "./github-live-oauth.mjs";

describe("S-6 local OAuth callback boundary", () => {
  it("separates provider exchange errors from granted scope mismatches without exposing payloads", () => {
    for (const error of [
      "incorrect_client_credentials",
      "redirect_uri_mismatch",
      "bad_verification_code",
      "unverified_user_email",
    ])
      expect(
        exchangeFailure(
          true,
          { error, error_description: "SECRET", access_token: "SECRET" },
          "read:user",
        ),
      ).toBe(`oauth_${error}`);
    expect(exchangeFailure(true, { error: "SECRET" }, "read:user")).toBe(
      "oauth_provider_error",
    );
    expect(exchangeFailure(false, {}, "read:user")).toBe("oauth_http_error");
    expect(exchangeFailure(true, {}, "read:user")).toBe(
      "oauth_missing_access_token",
    );
    expect(exchangeFailure(true, null, "read:user")).toBe(
      "oauth_invalid_response",
    );
    expect(
      exchangeFailure(
        true,
        { access_token: "SECRET", scope: "repo,read:user" },
        "read:user",
      ),
    ).toBe("oauth_scope_mismatch");
    expect(
      exchangeFailure(
        true,
        { access_token: "SECRET", scope: "read:user" },
        "read:user",
      ),
    ).toBeNull();
  });
  it("binds S256 challenges and consumes callback state once", () => {
    const pending = createPending("signin", null, 1000);
    expect(pending.challenge).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(pending.verifier).not.toEqual(pending.challenge);
    const session = { pending };
    expect(consumePending(session, "signin", pending.state, 1001)).toBe(
      pending,
    );
    expect(() =>
      consumePending(session, "signin", pending.state, 1002),
    ).toThrow();
  });
  it("rejects wrong state, provider, owner, missing browser session, and expired state", () => {
    const pending = createPending("activity", "owner", 1000);
    for (const [session, kind, state, now] of [
      [
        { pending, signin: { identity: { id: "owner" } } },
        "activity",
        "wrong",
        1001,
      ],
      [
        { pending, signin: { identity: { id: "owner" } } },
        "signin",
        pending.state,
        1001,
      ],
      [
        { pending, signin: { identity: { id: "another" } } },
        "activity",
        pending.state,
        1001,
      ],
      [{}, "activity", pending.state, 1001],
      [
        { pending, signin: { identity: { id: "owner" } } },
        "activity",
        pending.state,
        601001,
      ],
    ])
      expect(() => consumePending(session, kind, state, now)).toThrow();
  });
  it("requires exact local Origin, form content type, and CSRF token", () => {
    const headers = {
      origin: "http://localhost:3000",
      "content-type": "application/x-www-form-urlencoded",
    };
    expect(acceptsMutation(headers, "secret", "secret")).toBe(true);
    expect(acceptsMutation(headers, "wrong", "secret")).toBe(false);
    expect(acceptsMutation(headers, "é", "x")).toBe(false);
    for (const origin of [
      undefined,
      "null",
      "https://alice.hasaweb.site",
      "http://evil.example",
    ])
      expect(acceptsMutation({ ...headers, origin }, "secret", "secret")).toBe(
        false,
      );
    expect(
      acceptsMutation(
        { ...headers, "content-type": "text/plain" },
        "secret",
        "secret",
      ),
    ).toBe(false);
  });
});
