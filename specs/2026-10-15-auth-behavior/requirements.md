# Phase 05 requirements

Run architecture spike S-5 for roadmap Phase 05 and acceptance criterion 2.2. This is a feasibility experiment, before the product authentication implementation in Phase 11. No product UI or Figma changes are needed.

Use the pinned Better Auth 1.7.7 and Drizzle D1 adapter. A verified email shared by GitHub and Google must resolve to one account. Missing and unverified provider emails must never merge accounts. Explicit linking must prove ownership through an authenticated local session and a successful provider OAuth callback. Neither provider is trusted irrespective of email verification.

Use a fixed apex base URL, exact trusted origin, Secure/HttpOnly/SameSite=Lax cookies with Path=/ and no Domain. Cover the OAuth state cookie as well as session and cache cookies. Keep GitHub sign-in separate from private-activity permission by disabling its default read:user scope and requesting user:email only. Google requests openid/email/profile.

Keep synthetic provider responses and local D1 in a separate nondeployable fixture entry. Do not write production secrets, provider tokens, session cookies, or account identifiers to recorded evidence. Fixture success does not claim that live provider applications, consent, TLS/browser policy, or deployed callbacks have been verified.
