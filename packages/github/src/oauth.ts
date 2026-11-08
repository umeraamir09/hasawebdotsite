// Private-activity consent with the separate activity OAuth app. Sign-in uses
// a different app and `user:email`. This app asks for `read:user` only, which
// GitHub documents as the scope for anonymized private contribution counts.

export const ACTIVITY_SCOPE = "read:user";
/** One consent attempt stays usable for ten minutes, like GitHub's codes. */
export const CONSENT_TTL_MS = 10 * 60_000;

const TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();
const STATE = /^[A-Za-z0-9_-]{43}$/;

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 32 random bytes as 43 URL-safe characters: an OAuth state or PKCE verifier. */
export function randomConsentValue() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function isConsentValue(value: unknown): value is string {
  return typeof value === "string" && STATE.test(value);
}

/** RFC 7636 S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string) {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
    ),
  );
}

/** Storage key for a state. The state itself is never stored. */
export async function consentStateHash(state: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(state)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Exactly `read:user`, in any separator form GitHub reports. */
export function hasActivityScope(value: string | null | undefined) {
  return (
    String(value ?? "")
      .split(/[ ,]+/)
      .filter(Boolean)
      .sort()
      .join(",") === ACTIVITY_SCOPE
  );
}

export function activityAuthorizeUrl(options: {
  oauthOrigin: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  login: string;
}) {
  const url = new URL("/login/oauth/authorize", options.oauthOrigin);
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: ACTIVITY_SCOPE,
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: "S256",
    // Suggests the selected account. The callback still verifies the identity.
    login: options.login,
    allow_signup: "false",
  }).toString();
  return url.toString();
}

export type ActivityExchange =
  | { status: "token"; token: string; scopes: string }
  // No token reached this adapter. `code` is an expired or reused code.
  | { status: "none"; reason: "code" | "provider" | "network" };

/**
 * Exchanges a callback code with its PKCE verifier. Any delivered token is
 * returned, even with the wrong scope, so the caller can revoke it.
 */
export async function exchangeActivityCode(
  transport: (url: string, init: RequestInit) => Promise<Response>,
  oauthOrigin: string,
  app: { id: string; secret: string },
  input: { code: string; verifier: string; redirectUri: string },
): Promise<ActivityExchange> {
  let response: Response;
  try {
    response = await transport(
      new URL("/login/oauth/access_token", oauthOrigin).toString(),
      {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "hasaweb-activity",
        },
        body: new URLSearchParams({
          client_id: app.id,
          client_secret: app.secret,
          code: input.code,
          redirect_uri: input.redirectUri,
          code_verifier: input.verifier,
        }),
      },
    );
  } catch {
    return { status: "none", reason: "network" };
  }
  let body: Record<string, unknown> | null = null;
  try {
    const value: unknown = await response.json();
    if (value && typeof value === "object" && !Array.isArray(value))
      body = value as Record<string, unknown>;
  } catch {
    body = null;
  }
  const token = body?.access_token;
  if (typeof token === "string" && token.length > 0 && token.length <= 8192)
    return {
      status: "token",
      token,
      scopes: typeof body?.scope === "string" ? body.scope : "",
    };
  return {
    status: "none",
    reason: body?.error === "bad_verification_code" ? "code" : "provider",
  };
}
