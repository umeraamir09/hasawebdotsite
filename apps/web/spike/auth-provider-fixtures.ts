// Local integration HTTP fixtures only. Never import from product routes.
type Profile = { id: string; email?: string; verified: boolean };
const profiles: Record<string, Profile> = {
  explicit: {
    id: "explicit",
    email: "explicit@example.invalid",
    verified: true,
  },
  shared: { id: "shared", email: "shared@example.invalid", verified: true },
  other: { id: "other", email: "other@example.invalid", verified: true },
  unverified: {
    id: "unverified",
    email: "shared@example.invalid",
    verified: false,
  },
  missing: { id: "missing", verified: false },
  freshUnverified: {
    id: "fresh-unverified",
    email: "fresh@example.invalid",
    verified: false,
  },
  freshVerified: {
    id: "fresh-verified",
    email: "fresh@example.invalid",
    verified: true,
  },
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}
function base64(value: unknown) {
  return btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

// Intercept HTTP responses only. Keep the shipped provider adapters, code
// exchange, profile mapping, state handling, linking and D1 adapter intact.
// Unknown outbound traffic fails closed so fixtures never reach providers.
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (
    url.href === "https://github.com/login/oauth/access_token" ||
    url.href === "https://oauth2.googleapis.com/token"
  ) {
    const raw = await request.text();
    const body = request.headers
      .get("content-type")
      ?.includes("application/json")
      ? (JSON.parse(raw) as Record<string, string>)
      : Object.fromEntries(new URLSearchParams(raw));
    const profile = profiles[body.code ?? ""];
    if (!profile) return json({ error: "invalid_grant" }, 400);
    return json({
      access_token: body.code,
      token_type: "Bearer",
      expires_in: 3600,
      // The Google callback adapter decodes the token-exchange response.
      // This fixture does not exercise the client-supplied idToken endpoint.
      id_token: `${base64({ alg: "RS256", typ: "JWT" })}.${base64({
        sub: profile.id,
        name: "Fixture owner",
        email: profile.email,
        email_verified: profile.verified,
        aud: "fixture-google",
        iss: "https://accounts.google.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })}.fixture`,
    });
  }
  if (url.origin === "https://api.github.com") {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    const profile = profiles[token ?? ""];
    if (!profile) return json({ message: "Bad credentials" }, 401);
    if (url.pathname === "/user")
      return json({ id: profile.id, login: profile.id, email: profile.email });
    if (url.pathname === "/user/emails")
      return json(
        profile.email
          ? [
              {
                email: profile.email,
                primary: true,
                verified: profile.verified,
              },
            ]
          : [],
      );
  }
  throw new Error(`Unexpected fixture egress: ${url.origin}${url.pathname}`);
};
