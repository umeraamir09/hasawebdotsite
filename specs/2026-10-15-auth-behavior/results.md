# S-5 authentication behavior results

October 15, 2026. The local fixture experiment passes 26 checks using Better Auth 1.7.7, its shipped GitHub/Google adapters, Drizzle 0.45.4, and workerd with local D1. Chromium separately verifies browser cookie enforcement. The roadmap checkbox awaits owner approval.

## What ran

`pnpm spike:auth` runs `scripts/auth-behavior-spike.mjs`. It creates an isolated local Wrangler configuration and empty D1 database under ignored `.wrangler/auth-behavior`, starts the dedicated fixture Worker, exercises OAuth HTTP requests, runs Chromium, and writes sanitized [evidence.json](evidence.json). The runner removes its generated signing secret and D1 state afterward. It never deploys or changes production data. Install the repository dependencies first and provide Chromium at `/opt/google/chrome/chrome`, or set `AUTH_SPIKE_CHROMIUM` to its executable path.

This session used `node scripts/auth-behavior-spike.mjs` because the available Windows pnpm shim cannot resolve its pnpm 12.11.2 installation from WSL. Direct Node execution uses the pinned repository dependencies. The equivalent direct Biome, Vitest, and web TypeScript commands pass. All eight repository unit tests pass. Wrangler bundles and executes the new fixture entry during the integration run. No product route imports the fixture entry.

The fixture replaces outgoing provider HTTP responses, rather than replacing Better Auth's provider adapters or account/session lookups. The GitHub token exchange, user profile, and email-list mapping run through the shipped adapter. Google's token exchange returns a synthetic ID token that its callback adapter decodes. Provider credentials, tokens, consent pages, remote TLS, and real provider identity assertions are outside this controlled experiment. The client-supplied Google ID-token sign-in path is not exercised.

## Passed checks

- GitHub-first and Google-first verified sign-ins link the matching email to the same local user. Returning provider identity preserves that user. Session records persist in D1.
- Both providers reject missing-email callbacks. Both reject implicit linking with unverified incoming emails. A verified incoming email cannot claim an existing unverified user's account.
- Explicit linking requires a local authenticated session and a valid provider callback. A successful new provider link persists and subsequently signs in to that owner. Missing/unverified emails and invalid codes fail for both providers. A different owner's email/provider account cannot change ownership.
- Missing, mismatched, cookie-less, cancelled, invalid-code, and replayed callbacks produce no new account/session. The runner checks D1 counts before and after failures.
- Empty, null, sibling, and foreign origins fail on mutations. Non-JSON mutations and external callback destinations fail. Auth handlers reject a sibling portfolio hostname, even with a deliberately supplied apex cookie.
- Emitted state, session-token, session-cache, and remember-choice cookies all use `__Host-` names with Secure, HttpOnly, SameSite=Lax, Path=/, and no Domain. Chromium accepts the emitted cookies on the HTTPS apex, sends none to portfolio/asset hosts or HTTP, hides them from `document.cookie`, and rejects sibling attempts to overwrite them with a parent Domain attribute. Browser responses are intercepted locally, so this proves cookie policy rather than deployed TLS.
- Cached and uncached session reads resolve the same user. Sign-out expires the current browser's cookies and deletes its D1 session. An uncached lookup of the old token fails.

## Supported configuration

[auth-behavior.ts](../../apps/web/spike/auth-behavior.ts) records the tested configuration for Phase 11 to adopt.

| Setting | Tested value and reason |
| --- | --- |
| Base URL and trusted origins | Fixed `https://hasaweb.site`, with the exact apex origin only |
| Request boundary | Exact URL origin; all non-read requests require the exact Origin and JSON content type, in addition to Better Auth's checks |
| Database | Drizzle SQLite adapter over D1, using synthetic S-2 auth tables; Phase 10 still owns product migrations |
| Linking | Enabled, no trusted-provider bypass, `requireLocalEmailVerified: true`, different emails forbidden, final-provider removal forbidden |
| GitHub identity scopes | Disable default scopes and request `user:email`; the generated authorization URL contains no `read:user` or repository scope |
| Google identity scopes | Default `openid email profile` |
| Cookies | `cookiePrefix: __Host-hasaweb`, `useSecureCookies: false`, cross-subdomain cookies disabled, explicit Secure/HttpOnly/Lax/Path=/ defaults |
| Session cache | Enabled with a 300-second maximum age |
| Auth initialization | New configuration per fixture request; no request identity retained between calls |

`useSecureCookies: false` prevents Better Auth from prepending `__Secure-` to the explicit `__Host-` prefix. It does not disable the explicitly configured Secure cookie attribute. Using `cookiePrefix` also covers dynamically generated state cookies, rather than fixing only session-cookie names.

The first run found that Better Auth's default social sign-in route accepted a foreign Origin without a nonempty cookie header. The explicit mutation guard now rejects that request. Its own redirect validation continues to reject external callback destinations.

The pinned package source is the basis for these settings. [Better Auth account linking documentation](https://better-auth.com/docs/concepts/users-accounts) provides background; do not copy its trusted-provider example, which bypasses email verification. Recheck the actual dependency when upgrading.

## Limits and follow-up

A copied, still-valid cache cookie remains accepted after D1 sign-out until the cache expires. The experiment explicitly confirms this behavior before forcing an uncached lookup. The current browser loses its cookies immediately, but cache acceptance alone cannot prove immediate revocation. Follow architecture sections 7 and 12: owner APIs must check current deletion state independently, and use `disableCookieCache: true` when fresh session revocation is required. Product account deletion is still Phase 49 work.

This is fixture evidence for S-5, not a claim that the production sign-in journey exists. Phase 11 must add product routes and recovery behavior using real provider applications. Live provider registration, redirect allowlists, consent, real account sign-in, and deployed callbacks remain unverified here and must pass before launch. Phase 06 must prove separate GitHub private-activity authorization, including effects of previously granted scopes. Phase 10 must add product constraints and owner-scoped persistence; Phase 47 owns complete connected-provider settings and disconnect behavior.
