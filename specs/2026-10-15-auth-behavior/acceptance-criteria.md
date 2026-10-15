# Phase 05 acceptance checks

- Both real provider adapters complete OAuth callbacks using controlled token/profile responses in workerd and persist sessions in D1.
- Same verified email links across providers in either order; returning provider identity reopens the same account.
- Missing/unverified incoming email and an unverified existing account cannot implicitly merge. Rejected attempts leave account identity unchanged.
- Explicit linking requires a session and a successful OAuth state/code exchange; different emails and provider accounts belonging to another owner cannot link.
- Missing, mismatched, replayed state, cancelled authorization, invalid code, untrusted origin, and sibling-host requests fail without issuing a usable session or changing ownership.
- All emitted auth cookies have Secure, HttpOnly, SameSite=Lax, Path=/, a __Host- name, and no Domain. A browser-compatible cookie jar sends them only to the apex over HTTPS.
- D1 lookup and cookie-cache sessions identify the same owner; sign-out invalidates the D1 session. Cache invalidation limits are documented.
- Record command, check results, supported configuration, and limitations. Obtain owner approval before checking off the roadmap phase.

## Recorded evidence

All 26 fixture and browser checks pass on October 15, 2026. See [results.md](results.md) and [evidence.json](evidence.json) for the exact scope and limitations. Biome, strict web TypeScript, and all eight repository unit tests pass. Chromium uses intercepted HTTPS responses; live OAuth applications and deployed callbacks remain launch follow-up checks. The copied-cookie cache revocation limit is measured and documented. Phase completion approval is pending.
