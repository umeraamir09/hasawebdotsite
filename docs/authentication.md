# Authentication

Phase 11 implements GitHub and Google sign-up/sign-in at `/sign-in`. Normal successful OAuth callbacks open `/editor`, a static client shell that initializes the private portfolio through the Phase 12 API. `/api/owner` remains a read-only session/deletion check returning the owner's name and existing portfolio ID, without tokens, email or draft content. Phase 13 adds separate private draft/progress APIs. Phase 17 implements a reusable editor and authorized private-preview adapters through handoff fixtures. Production editor entry and onboarding remain gated until the complete guide activates in Phase 42E. See [current status](implementation-status.md).

The following setup/verification instructions describe the authentication baseline and Phase 12 initialization. The [October 16 initial-setup agreement](onboarding.md) changes the target first-user journey. Required setup routing has not yet been activated.

## Private portfolio initialization

The account shell calls `POST /api/owner/portfolio` with `{}` before displaying its signed-in state. The existing Worker adapter forwards the original request to the jobs `OwnerApi` service binding. Authentication, persisted-session/deletion checks, exact Origin and JSON requirements apply. Only an empty JSON object is accepted, within a 1,024-byte streamed-body limit. Caller-supplied owner IDs, portfolio IDs, template choices, provider content and setup flags are rejected.

Provisioning inserts one private portfolio using the approved Leaf/DM Sans/system defaults, empty owner fields, no decoration and Face Reveal off. Its revision starts at zero, private progress starts at Address, and the first-editor milestone remains unset. The application uses the single fixed `portfolio-v1` template. Provider name/email/photo stay in account identity for later deliberate acceptance. This operation creates no assets, public claim, publication or GitHub connection.

Repeated, concurrent and retried requests return the existing portfolio ID without reading or rewriting its draft, progress or milestone. Initialization also preserves legacy validation markers and publication state. The response has the same small user/portfolio identifier shape as `/api/owner`, with private/no-store and noindex headers. Failed or interrupted requests use the shell's Retry action; expired sessions return to sign-in. `GET /api/owner` and session probes remain read-only. Required guide routing and the authoritative editor handoff remain later phases.

## Draft recovery sign-in

Phase 15 adds `startSignIn(provider, "draft-recovery")`. Normal sign-in still uses `/editor` with `/sign-in?provider=github|google` errors. Recovery permits only the fixed pair `/auth/recovery` and `/auth/recovery/error`; arbitrary return URLs, query variants and mixed normal/recovery pairs are rejected. Provider callback routes and scopes are unchanged.

Before same-tab navigation, quiesce the controller, settle the current acknowledgement and persist its latest local recovery record. Persist a version-1 sessionStorage continuation containing only owner ID, portfolio ID, record ID, setup/content context and controlled `draft-recovery` flow. Neither draft content nor credentials enter URLs or continuation storage. Unavailable durable browser storage prevents leaving, with a visible retry message.

The callback calls uncached `GET /api/owner` before opening recovery storage. Only an authenticated matching owner and portfolio can load its record range. A different account receives an explanation and another sign-in path; it cannot copy or dismiss the original recovery. Cancellation, provider failure, callback reload and Back retain continuation. Expiry during conflict review preserves its durable selections for explicit continuation. Restoration and reviewed replacement update matching continuations to their durable replacement record/context before retiring sources, so remaining raw input survives another callback reload. Missing or stale continuations offer ordinary account entry without provisioning. Matching callbacks also offer an account-entry link, including clean checkpoints and expiry before the initial draft read; they never require nonexistent edits to continue.

The callback mounts shared recovery controls and requires explicit continuation before saving preserved valid values. Existing command/transfer/discard journals retain receipt verification; unknown staging requires the original journal or explicit discard. Conflicts enter three-way selected review. After handoff, setup records can contribute explicitly selected content to a fresh content scope, without converting setup attempts or replaying progress. This route supplies recovery only. The editor adapter is implemented in Phase 17; controlled setup-aware entry and guide activation remain Phases 22A and 42E. See the [client contract](../apps/web/lib/draft/README.md).

## Dormant editor preview authorization

`serveEditorPreview` verifies the original cookie with the owner API before serving a private/no-store, noindex boot shell. The shell contains no draft data. `openEditorPreview` checks uncached owner/portfolio identity before mounting the child and reports that identity to the pinned parent connection. Focus and browser restoration recheck the original identity before resuming; an account change disposes the old display. Neither preview adapter resolves raw asset IDs. Actual ready-asset access belongs to Phase 18.

These adapters are exercised by the Phase 17 handoff fixture. They are not registered as production routes. Normal OAuth and `/editor` still use the account shell until the complete setup entry resolver is activated.

## Planned setup-aware entry and recovery

New signups must complete Address, the combined Profile screen, and Links before first editor entry. Skills, Projects, and public/private GitHub activity follow as optional steps, then private Review and Open editor. There is no initial editor bypass. Before first handoff, returning sign-ins resume saved progress; after handoff, they open the saved editor directly. Later removal of required content blocks publication only and does not rerun onboarding.

The roadmap adds explicit follow-up work to completed authentication rather than reopening Phase 11. It must update the three normal-entry decisions while preserving fixed recovery mode: the client OAuth success destination, its exact server allowlist, and the signed-in `/sign-in` redirect. Use a controlled internal resolver with persisted owner setup state, preserving the provider callback routes and origin/redirect restrictions. Do not accept arbitrary return URLs. Activate required routing only after the full guide and handoff are usable.

Direct editor navigation must not bypass setup. Setup still needs authenticated access to its own/shared draft, upload, candidate-address, authorization, and private-preview capabilities. Check uncached session/deletion state and authoritative setup data on handoff. Provision exactly one private draft under retry/concurrency, and record a permanent revision-aware first-editor-entry milestone that stale tabs cannot clear.

An authenticated private suggestion path may return the provider name/photo and an email suggestion for deliberate acceptance. This is new work, not permission to broaden the current public or `/api/owner` response accidentally. Provider photo use needs explicit acceptance, cropping, and validated private asset import. Account email never becomes a public link automatically.

Onboarding/editor adapters reuse the [shared client and Phase 15 coordinator](../apps/web/lib/draft/README.md). Keep the fixed recovery callback when adding the future normal-entry resolver. Send the expected-owner precondition on draft/progress requests and stop on `owner_changed` before loading recovery into another account. Preserve recoverable local input through reauthentication and isolate it by owner/portfolio. Restoring a session returns to the same pending setup or authorized editor flow without duplicate preparation.

## Planned GitHub activity consent

Both signup providers can add a graph and authorize private activity during onboarding or in the editor. Public activity uses the separately verified platform credential. Private consent uses a separate activity OAuth app/grant with `read:user`, one-use expiring owner/session-bound state, PKCE, and selected-account identity checks. It neither expands signup scopes nor links GitHub sign-in to a Google owner's account.

Controlled consent returns resume the graph step. Cancelled, failed, or wrong-account consent preserves existing public setup and offers Retry, public-only setup, or later incomplete editor repair. It cannot gate editor entry after required setup. Explicit graph removal withdraws its separate private access with immediate local removal and retryable remote revocation; it leaves sign-in connected. See [architecture section 8.5](architecture.md#85-github-activity-product-9) for production dependencies and stale-refresh protection.

## Local setup

1. Copy `apps/web/.dev.vars.example` to `apps/web/.dev.vars` and replace the signing secret and both providers' client credentials.
   Also copy `apps/jobs/.dev.vars.example` to `apps/jobs/.dev.vars`. The named owner API independently verifies sessions, so both Workers need the same `APP_ORIGIN`, signing secret and development OAuth credentials.
2. Set `APP_ORIGIN` to the exact browser origin, without a trailing slash. Use `http://127.0.0.1:8787` for the three-Worker runtime or `http://127.0.0.1:3000` for `pnpm dev:web`.
3. Apply the local D1 migrations with `pnpm db:migrate:local`.
4. Configure provider callbacks at `{APP_ORIGIN}/api/auth/callback/github` and `{APP_ORIGIN}/api/auth/callback/google`. Local and production provider applications should have separate credentials.
5. Start the three-Worker runtime with `pnpm dev` for functional account entry and portfolio initialization. `pnpm dev:web` renders the Next.js screens alone; the owner initialization endpoint requires the web Worker adapter and jobs service binding.

Do not use a portfolio hostname, a LAN address, or a URL path as the app origin. Only local loopback HTTP permits non-Secure `hasaweb-local` cookies. HTTPS uses `__Host-hasaweb` cookies, with Secure, HttpOnly, SameSite=Lax, Path=/, and no Domain attribute.

## Production configuration

For the future production release, set `APP_ORIGIN=https://hasaweb.site` in both web and jobs and provide matching `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` through deployment secrets. The signing secret must contain at least 32 characters. Missing configuration returns a controlled 503 and the screen provides retry. Provider applications must allow exactly these callback URLs:

- `https://hasaweb.site/api/auth/callback/github`
- `https://hasaweb.site/api/auth/callback/google`

GitHub requests only `user:email`, with default scopes disabled. Google requests its default identity scopes. Private GitHub contribution authorization uses a separate app/grant in later phases. Verified matching provider emails may link accounts, with no trusted-provider bypass. Neither missing nor unverified emails can merge owners. A standalone unverified-email account may sign in without becoming eligible for automatic linking, as established in Phase 05.

The HTTP entry accepts only social sign-in, sign-out, session lookup, and GitHub/Google callbacks. Sign-in requests cannot supply arbitrary scopes, ID tokens, or callback destinations. Password, email-only, and connected-provider management routes are unavailable. Phase 47 adds explicit settings/link/disconnect routes after their ownership rules are implemented.

Session-cookie caching retains the proven 300-second setting, but account/editor authorization always performs an uncached lookup and repository access checks. Sign-out invalidates the D1 session; copied cache cookies cannot reopen the editor. Deleting accounts cannot create new sessions or enter through an existing session.

The Phase 13 draft download resolves the uncached Better Auth identity with read-only session lookup, then checks persisted session expiry, ownership and account deletion in its single consistent D1 read. It omits the duplicate repository-construction check and unused cookie-refresh work. Authentication/status endpoints retain session refresh. Draft mutations, progress and recovery commands use a direct persisted-session precheck in the database package without constructing unused general owner repositories; they retain session refresh and each operation checks persisted access again. See the [draft API protocol](../specs/2026-10-17-revision-aware-drafts/protocol.md).

## Verification

- `pnpm test:auth` runs local workerd/D1 product-table provider fixtures, private portfolio initialization/access checks and Chromium cookie isolation checks. Standalone runs default to unique ignored evidence directories. Use `--evidence-dir=...` or `AUTH_EVIDENCE` only when selecting another destination; preserve the Phase 11 historical record.
- After `pnpm build`, `pnpm test:auth:browser` also exercises the rendered app, pending/retry/cancellation, keyboard activation, editor entry and sign-out in Chromium. It uses isolated local databases and ports 8811/8812, inspector 9248, and Chromium debugging ports 9245/9246. Set `AUTH_SPIKE_CHROMIUM` if Chromium is installed elsewhere. The proxy tracks active paused requests and Chromium cancellation; a regression deliberately aborts a held subrequest before its response. A known request is fulfilled at most once, and Chromium's exact invalid-interception response retires it even if no matching Network cancellation reached this session. Unknown IDs, duplicate fulfillment and other interception errors still fail verification.
- `pnpm check`, `pnpm test:persistence`, and `pnpm test:runtime` cover the shared contracts and local runtime. Run Wrangler suites sequentially because their ports overlap. The [auth verification profile](agent-workflow.md#choose-local-checks) builds web/jobs, exercises auth/draft/recovery and shares the worktree resource lock.

The provider fixtures replace provider HTTP responses and consent, while retaining Better Auth's shipped adapters, state handling, cookies and D1 writes. Browser tests proxy API calls to the same product handlers in the fixture Worker and serve the built app from OpenNext. Separate smoke checks exercise the actual Next route adapters with local bindings. This does not verify live provider applications, real consent, deployed callbacks, or production CPU limits. Those checks remain required before launch.

The Figma handoff marks Terms and Privacy content as unfinished. The implementation omits the agreement statement until approved policy content and working destinations exist.
