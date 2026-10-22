# D1 persistence

`src/schema.ts` defines the Drizzle/SQLite tables, including the Better Auth adapter tables. The `portfolio.user_id` unique constraint enforces one portfolio per account. Draft bodies use the Phase 09 contract and a database limit of 1,048,576 UTF-8 bytes. Publication bodies stay in R2; D1 holds version metadata and the live pointer.

## Local migrations and fixtures

From the repository root:

```sh
pnpm db:generate
pnpm db:migrate:local
pnpm local:seed
pnpm test:persistence
```

`db:generate` runs drizzle-kit against the checked-in schema and snapshots. Review every generated SQL file before applying it. `0002_counter_owner.sql` explicitly retains `ON DELETE CASCADE`, which drizzle-kit's generated ADD COLUMN omitted. Keep future changes compatible with the previous deployed application. The three local Wrangler configurations share `packages/db/migrations`; migration application uses Wrangler's `d1_migrations` tracking. Production configuration and migration deployment arrive in Phase 52.

The seed creates two deterministic development users and private empty drafts. It adds no sessions, credentials, or public claims. It preserves existing drafts on reruns. Its placeholder appearance IDs are private fixtures. Product initialization uses the approved catalog through `repositories.portfolio.provision()`.

## Owner access

Use `ownerApi` at the request boundary and pass Better Auth's session reader:

```ts
const handler = ownerApi(
  {
    db: env.DB,
    origin: applicationOrigin,
    readSession: (headers) => auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    }),
  },
  async (_request, repositories) => {
    const portfolio = await repositories.portfolio.get();
    return privateJson(portfolio ?? null, portfolio ? 200 : 404);
  },
);
```

This generic boundary example is for internal/fixture use. Current product routes use the named Hono/jobs owner API and `currentOwner` checks; draft reads use the specialized consistent streaming query. Do not replace those hot handlers with `portfolio.get()` and whole-document decoding. See the [Phase 13 protocol](../../specs/2026-10-17-revision-aware-drafts/protocol.md).

The guard checks the request URL against the exact application origin. POST, PUT, PATCH, DELETE, and any other unsafe method also require that exact Origin header and the application/json media type. It resolves the session on every request, then verifies the session ID, user ID, expiry, and account deletion state against D1. Authentication or D1 failures deny access. Responses always use private/no-store and noindex headers.

`ownerRepositories` accepts only an identity resolved by the authentication library. Never construct it from a request body, path, query, or owner-ID header. Each operation includes its own persisted session and owner predicates. A previously created repository therefore cannot keep accessing data after session revocation or deletion. Inserts derive the portfolio ID from the active session; supplied extra ownership fields cannot redirect inserts or upserts. Missing and cross-owner record IDs both return no record. Map those results to 404 in future handlers.

The repositories provide portfolio creation/reads, asset metadata, candidate publication versions, current claims, connected GitHub records, contact recipients and outbox, owner counters, and provider identity listings. Provider listings exclude grants. GitHub withdrawal atomically clears active credentials and authorized data while preserving encrypted remote cleanup separately. Outbox finalization clears visitor payloads, also enforced by a database constraint. These persistence helpers are internal methods; handlers must select permitted fields and run the relevant feature validation before calling them.

`repositories.portfolio.provision()` takes no content or identity arguments. It conditionally inserts an empty private draft from the approved appearance catalog under the active-session predicate, with initial Address progress. A conflict on the account's unique portfolio leaves every existing column untouched. It returns only the active owner's portfolio ID and never parses existing draft content. A revoked/expired/deleting session cannot insert or recover a portfolio, including through a repository obtained before revocation. `portfolio.create(id, draft)` remains an internal fixture/maintenance helper; the initialization API does not expose its arguments.

Owner counters use an encoded namespace and a cascading user reference. Owners cannot access shared email budget keys through this repository. Shared budgets and operator audits require trusted service repositories when their flows arrive. The schema exports support those services; raw queries do not belong in request handlers.

Registry reads are available through the owner repository. Database triggers prevent name changes and transfer, keep claimed names permanent, and reject platform-reserved inserts. Held reservations release before portfolio deletion; claimed names retain permanent ownerless rows. First publication must convert the hold and change the live pointer in the same transaction in Phase 25. Explicit Address confirmation is the reservation mutation described below. Authenticated draft-save HTTP endpoints exist through the Phase 13 named owner API. Contact acceptance with atomic budgets, delivery retries and provider grant verification remain in their scheduled phases.

## Initial setup storage

Migration `0003_initial_setup.sql` adds `setup_progress`, `first_editor_entered_at` and `draft_validation_version` in place, plus tracked `owner_save_attempt`/`owner_save_piece` staging tables. It preserves existing rows, children, claims and triggers. Existing drafts remain at their stored version until saved. Offline owner draft reads use the shared migration contract. Production validated reads use a single D1-generated JSON envelope without whole-document Worker parsing; the owner-status endpoint reads only portfolio identity metadata.

`repositories.setup.get()` returns private navigation, the shared revision and the permanent entry timestamp. `setup.saveProgress(revision, progress)` and `setup.saves` use the measured bounded-save engine against the canonical portfolio. Content/progress commit atomically and increment `draft_rev` together. A stale revision fails without changing either value. The setup mapping rejects all writes after first entry, including commits prepared before handoff. `ownerDrafts(...).saves("content")` uses the content mapping and preserves the milestone and frozen progress. Attempt context is persisted and continuations cannot change it. Recovery inspection, explicit discard and bounded cleanup remain available after handoff.

`setup.recordFirstEditorEntry(revision)` is an internal persistence operation for the later authoritative handoff service. That service must flush valid saves and validate required saved content and ready owned assets at exactly that revision before calling it. No HTTP route or client flag invokes it in this phase. The first successful write increments the shared revision; repeats return the existing milestone. Database triggers prevent resetting/changing it or changing progress after entry, even during later editor content edits. Route gating and activation remain their scheduled phases.

Version 1 alone does not prove the approved destination limits were validated. Existing rows receive validation generation 0 and cannot use incremental setup saves until checked. Newly created drafts pass the current schema and receive generation 2. `setup.validateLegacyDraft()` provides a reference validator with an owner/session/revision-checked generation write for offline maintenance. It loads and validates a whole document and must not be exposed as a Free hot HTTP save path. `legacyValidation(...)` now supplies bounded staged validation and explicit destination correction through the production draft API. Its server-owned cursor checks bounded nodes against the shared schema and cross-document SQL rules; only a completed revision-checked commit installs generation 2. Original canonical content remains unchanged during validation/correction. No migration blindly marks old data valid or truncates destinations.

Before explicit Address confirmation, `requestedSubdomain` is a private non-reserving candidate. Two owners can save the same candidate through generic draft actions. Confirmation creates an exclusive registry hold and saves the field as its mirror. Public snapshot construction must use the shared public-content projection after publication filtering. Account deletion releases held reservations and cascades through progress/milestones and staging via the existing portfolio/user references. Published claims survive as ownerless permanent names. Post-handoff owner cleanup is available through the Phase 13 API. Dormant-owner staging cleanup remains Phase 51.

## Production draft and progress API

Migration `0005_owner_draft_api.sql` adds persisted attempt context and legacy validation metadata without rebuilding tables. Existing attempts default to setup context. `ownerDrafts` streams D1-generated validated/recovery text chunks of at most 65,536 Unicode code points from one consistent snapshot, and provides bounded metadata reads and request-local setup/content repositories. `assertSaveSession` supplies the same persisted expiry/revocation/deletion precheck for draft/progress handlers without constructing unused general owner repositories. Every operation retains its own access predicates. The named jobs owner API exposes strict action bodies; fixture SQL, injection and benchmark preparation are separate integration builds. See the [Phase 13 protocol](../../specs/2026-10-17-revision-aware-drafts/protocol.md) for routes, exact bodies, response/error contracts, retry semantics and limits. Phase 14 adds mandatory `X-Expected-Owner-Id` preconditions on draft/progress routes, compared against authenticated identity before draft work. Missing values return 400 `invalid_input`; mismatches return 409 `owner_changed`. The header never selects an owner or replaces persisted authorization. See the [shared browser client](../../apps/web/lib/draft/README.md).

## GitHub generations and cleanup

Migration `0004_github_refresh_contracts.sql` adds connection/cache generations, complete public and authorized calendar columns, separate errors, and a global `github_grant` coordinator. Old columns remain for schema compatibility. Unknown legacy calendars are cleared for refetch. Legacy envelopes without an app binding move to `github_legacy_credential` and cannot be used by refresh jobs. Private consent for that stable account is blocked until those credentials are reconciled with the correct activity app and retired safely. Public-only setup remains available.

`repositories.github.select(identity, expectedGeneration)` creates with `null` or changes selection at the captured generation. `disconnect(generation)` disables private access while retaining an independently safe public fallback. Both invalidate old jobs and queue any active grant for remote deletion in one D1 batch. Later graph removal handlers must combine the draft revision protocol with withdrawal before reporting success. Ordinary Skip must not call withdrawal.

Call `beginConsent(activityAppId, generation)` before starting OAuth or exchanging a code. Its ticket reserves the app/account globally, including across owners. `finishConsent(ticket, key, token, scopes, verifiedIdentity)` requires the matching stable identity/username and `read:user`. The future OAuth adapter supplies server-verified values after session/state/PKCE checks. These methods are not public APIs. Removal/selection during consent makes completion queue the issued token for cleanup instead of enabling it. Call `cancelUnissuedConsent` only when the adapter proves no exchange started or token was issued. Never expire a reservation while an exchange may still complete. Interrupted exchanges require durable reconciliation in that adapter.

If an issued token fails identity or scope validation, `finishConsent` encrypts it and queues token-only cleanup before throwing. Its authenticated binding records the verified account and token-only purpose; the original selected-account reservation remains blocked until cleanup succeeds. Revoking just the rejected token preserves any existing grant for the wrong account. Selection, active credentials and published output remain unchanged.

Trusted jobs use `githubJobs.capture` and return success/error through `refresh` with the captured ticket. Every write checks generation, identity, deletion, and current grant as applicable. Owner reads omit credentials. `servingState` reads cache and authorization in one D1 snapshot. Combine it with the active immutable publication through `projectPublishedActivity`. The future public endpoint must apply the existing cache withdrawal/purge policy before enabling shared caching.

`pendingGitHubCleanups` returns bounded due tickets without credentials. `runGitHubGrantCleanup` atomically claims an operation, decrypts only its cleanup credential, makes one provider call, and records the outcome. Concurrent/duplicate/stale deliveries cannot obtain a credential or invoke GitHub. Pending/running cleanup blocks same-app/account consent. Successful deletion clears ciphertext and permits a new reservation. Completed failures retry after one minute. Interrupted calls stay uncertain; crashes may leave in-flight work. Neither state permits automatic lock stealing. An operator/durable execution adapter must establish that the old request ended and reconcile provider state before retrying or releasing it. Expiry alone is not proof.

Cleanup coordination survives portfolio deletion through a nullable reference. Later account deletion must withdraw active grants before removing connection rows, finish remote cleanup, then remove residual coordinator metadata. These operations never alter sign-in provider rows. Generation/cache triggers reject old unguarded authorization and `private_counts` writes. Graph routes must stay disabled until jobs/site/web use these contracts and legacy credentials have been reconciled. Provider fetching, routes, OAuth, cache purge, queues and cron remain Phases 40–42.

## Verification

`test:persistence` starts an isolated local Worker, applies migrations 0000–0002, populates version 1 content with an asset, permanent claim and legacy GitHub cache/credential, applies the additive migrations, reapplies tracked migrations, and reseeds twice, and exercises the repositories in workerd/D1 with multiple owners and controlled session states. It uses the real Better Auth adapter and signed cookies, including an actual cached session cookie after D1 revocation. It also checks draft byte boundaries, concurrent inserts/counters, relational constraints, account-deletion cascades, permanent claims, failed dependencies, and restart persistence. It removes only its own ignored test state on the next run and writes evidence to `.wrangler/persistence-integration/evidence.json`. CI runs it alongside the existing three-Worker smoke test. The test Worker is separate from application entrypoints and accepts only local loopback requests.

## Private upload lifecycle

`privateAssets(binding, identity)` adds the web upload lifecycle without changing the asset schema. Its identity comes from Better Auth. Pending insertion, ready lookup and conditional pending-to-ready finalization repeat persisted session expiry/revocation, account deletion, portfolio ownership and portfolio deletion checks. The web handler supplies a fresh server-generated ID. It records actual bytes only after a complete R2 write.

`failPrivateAsset` changes only a matching immutable pending row to failed and returns its persisted state. The caller must confirm failed or absent metadata before deleting the matching object. A ready row survives an uncertain finalization response. Unavailable reconciliation leaves bytes private for later recovery. This is an internal cleanup capability, not an owner API or a general status setter.

The [private asset adapter](../../apps/web/lib/assets/README.md) owns binary validation, R2 writes and owned-ready-purpose/object-existence resolution. Existing generic asset repository methods are not proof of upload readiness. Future setup and publication must use the authoritative resolver. Jobs has no draft-bucket access or source-transfer permission from this module.

## Address reservations

Migration `0006_address_reservations.sql` extends `subdomain_claim` into one held/claimed namespace. Existing rows remain permanent claims. Their `claimed_at` stays null because the earlier schema did not store that time. Existing draft candidates do not become holds. New holds have `held_at` and no `claimed_at`; first-publication conversion must supply `claimed_at`. Held rows release before portfolio deletion, while claimed rows become permanent ownerless names.

`ownerAddresses(db, identity)` exposes `availability`, authoritative `state`, and explicit `confirm`. Availability checks the dynamic `reserved_subdomain` table and creates no row. Confirmation accepts a strict immutable command with ID, portfolio scope, expected revision, context, name, and setup progress when applicable. It rejects open staging work. The D1 batch deletes only the current hold, inserts the new hold unless an existing permanent claim applies, updates the draft mirror under revision/session/setup guards, then inserts a receipt whose `CHECK(applied=1)` consumes the immediately preceding update count. Any failure rolls the entire batch back, including a zero-row update. Same-owner permanent confirmations preserve the row and claim timestamp.

`address_confirmation` stores a complete payload hash, accepted revision, and resulting state for exact replay. Concurrent duplicate receipt collisions roll back before rereading the winning receipt. Reusing an ID with another payload returns `command_conflict`. Receipts remain for the portfolio's lifetime, including beyond the accepted browser replay window; ordinary staging cleanup does not delete them.

A database trigger rejects canonical address mirror changes that contradict a held or claimed row, including root changes, staging, and legacy commits. Unchanged historical mismatches remain editable, and repair to the registry name is allowed. Generic draft writes never create a hold. Held rows do not set `portfolio.subdomain`, create a public URL, or publish anything. Publication conversion and required setup validation remain later phases.
