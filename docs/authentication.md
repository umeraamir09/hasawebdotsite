# Authentication

Phase 11 implements GitHub and Google sign-up/sign-in at `/sign-in`. Successful OAuth callbacks open `/editor`. The editor is a static client shell; `/api/owner` checks the current persisted session and deletion state before returning the owner's name and existing portfolio ID. No account tokens, email address, or draft content appear in that response. Sample provisioning and the full editor arrive in later roadmap phases.

## Local setup

1. Copy `apps/web/.dev.vars.example` to `apps/web/.dev.vars` and replace the signing secret and both providers' client credentials.
2. Set `APP_ORIGIN` to the exact browser origin, without a trailing slash. Use `http://127.0.0.1:8787` for the three-Worker runtime or `http://127.0.0.1:3000` for `pnpm dev:web`.
3. Apply the local D1 migrations with `pnpm db:migrate:local`.
4. Configure provider callbacks at `{APP_ORIGIN}/api/auth/callback/github` and `{APP_ORIGIN}/api/auth/callback/google`. Local and production provider applications should have separate credentials.
5. Start the runtime with `pnpm dev` or the Next development server with `pnpm dev:web`.

Do not use a portfolio hostname, a LAN address, or a URL path as the app origin. Only local loopback HTTP permits non-Secure `hasaweb-local` cookies. HTTPS uses `__Host-hasaweb` cookies, with Secure, HttpOnly, SameSite=Lax, Path=/, and no Domain attribute.

## Production configuration

Set `APP_ORIGIN=https://hasaweb.site` in the production web Worker and provide `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` through deployment secrets. The signing secret must contain at least 32 characters. Missing configuration returns a controlled 503 and the screen provides retry. Provider applications must allow exactly these callback URLs:

- `https://hasaweb.site/api/auth/callback/github`
- `https://hasaweb.site/api/auth/callback/google`

GitHub requests only `user:email`, with default scopes disabled. Google requests its default identity scopes. Private GitHub contribution authorization uses a separate app/grant in later phases. Verified matching provider emails may link accounts, with no trusted-provider bypass. Neither missing nor unverified emails can merge owners. A standalone unverified-email account may sign in without becoming eligible for automatic linking, as established in Phase 05.

The HTTP entry accepts only social sign-in, sign-out, session lookup, and GitHub/Google callbacks. Sign-in requests cannot supply arbitrary scopes, ID tokens, or callback destinations. Password, email-only, and connected-provider management routes are unavailable. Phase 47 adds explicit settings/link/disconnect routes after their ownership rules are implemented.

Session-cookie caching retains the proven 300-second setting, but account/editor authorization always performs an uncached lookup and repository access checks. Sign-out invalidates the D1 session; copied cache cookies cannot reopen the editor. Deleting accounts cannot create new sessions or enter through an existing session.

## Verification

- `pnpm test:auth` runs local workerd/D1 product-table provider fixtures and Chromium cookie isolation checks.
- After `pnpm build`, `pnpm test:auth:browser` also exercises the rendered app, pending/retry/cancellation, keyboard activation, editor entry and sign-out in Chromium. It uses isolated local databases and ports 8811/8812, inspector 9248, and Chromium debugging ports 9245/9246. Set `AUTH_SPIKE_CHROMIUM` if Chromium is installed elsewhere.
- `pnpm check`, `pnpm test:persistence`, and `pnpm test:runtime` cover the shared contracts and local runtime. Run Wrangler suites sequentially because their default inspector ports overlap.

The provider fixtures replace provider HTTP responses and consent, while retaining Better Auth's shipped adapters, state handling, cookies and D1 writes. Browser tests proxy API calls to the same product handlers in the fixture Worker and serve the built app from OpenNext. Separate smoke checks exercise the actual Next route adapters with local bindings. This does not verify live provider applications, real consent, deployed callbacks, or production CPU limits. Those checks remain required before launch.

The Figma handoff marks Terms and Privacy content as unfinished. The implementation omits the agreement statement until approved policy content and working destinations exist.
