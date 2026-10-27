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

`setup.recordFirstEditorEntry(revision)` remains an internal fixture/maintenance operation. Product handoff uses `ownerSetup(db, identity, assetReady)` and never exposes that unrestricted storage helper. Its `validate({portfolioId, revision})` reads required facts from SQL without decoding full profile text or optional components. The server-owned `assetReady` callback must use the private object resolver. Its `handoff` repeats required facts, owned-ready image metadata, held reservation, staging absence, revision and persisted session checks in the milestone update. Repeats return the existing milestone even after content removal. Database triggers freeze the timestamp and progress after entry. The [authentication contract](../../docs/authentication.md#setup-aware-entry-and-handoff-services) defines the HTTP and client integration. Full guide/editor activation remains Phase 42E.

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

`authorizedPortfolio()` returns only the active owned portfolio ID under those same predicates. Provider-photo retrieval checks it before and after remote HTTP without allocating an asset or retaining source bytes.

`failPrivateAsset` changes only a matching immutable pending row to failed and returns its persisted state. The caller must confirm failed or absent metadata before deleting the matching object. A ready row survives an uncertain finalization response. Unavailable reconciliation leaves bytes private for later recovery. This is an internal cleanup capability, not an owner API or a general status setter.

The [private asset adapter](../../apps/web/lib/assets/README.md) owns binary validation, R2 writes and owned-ready-purpose/object-existence resolution. Existing generic asset repository methods are not proof of upload readiness. Phase 22A setup uses this authoritative resolver; publication must reuse it. Ready objects referenced by active drafts must remain immutable and available through handoff. Account deletion must revoke access before object cleanup. Jobs has no draft-bucket access or source-transfer permission from this module.

## Address reservations

Migration `0006_address_reservations.sql` extends `subdomain_claim` into one held/claimed namespace. Existing rows remain permanent claims. Their `claimed_at` stays null because the earlier schema did not store that time. Existing draft candidates do not become holds. New holds have `held_at` and no `claimed_at`; first-publication conversion must supply `claimed_at`. Held rows release before portfolio deletion, while claimed rows become permanent ownerless names.

`ownerAddresses(db, identity)` exposes `availability`, authoritative `state`, and explicit `confirm`. Availability checks the dynamic `reserved_subdomain` table and creates no row. Confirmation accepts a strict immutable command with ID, portfolio scope, expected revision, context, name, and setup progress when applicable. It rejects open staging work. The D1 batch deletes only the current hold, inserts the new hold unless an existing permanent claim applies, updates the draft mirror under revision/session/setup guards, then inserts a receipt whose `CHECK(applied=1)` consumes the immediately preceding update count. Any failure rolls the entire batch back, including a zero-row update. Same-owner permanent confirmations preserve the row and claim timestamp.

`address_confirmation` stores a complete payload hash, accepted revision, and resulting state for exact replay. Concurrent duplicate receipt collisions roll back before rereading the winning receipt. Reusing an ID with another payload returns `command_conflict`. Receipts remain for the portfolio's lifetime, including beyond the accepted browser replay window; ordinary staging cleanup does not delete them.

A database trigger rejects canonical address mirror changes that contradict a held or claimed row, including root changes, staging, and legacy commits. Unchanged historical mismatches remain editable, and repair to the registry name is allowed. Generic draft writes never create a hold. Held rows do not set `portfolio.subdomain`, create a public URL, or publish anything. Phase 22A required setup validation checks the owned hold and its mirror. Publication conversion remains Phase 25.

## Publication readiness

`ownerPublication(db, identity, assetReady).check(command)` reads only the active owner's saved revision, rejects open save attempts and unsupported validation generations, and rechecks owner/session/revision after asynchronous object reads. It shares required profile/link SQL with setup. Editor entry never bypasses these checks. The production web adapter resolves each included asset through the existing private object resolver, checking ownership, purpose, ready status, media type, size and object existence. Disabled Face Reveal images and untouched component sample assets are excluded.

Queries keep draft JSON in SQLite and return bounded issue paths and asset references. Readiness rules share collection scans and emit bounded issue JSON. At most four collection queries run in each compound query because the tested D1 runtime rejected the initial large compound SELECT; a global issue cap spans all groups. Eight object references are checked per page. `hasMoreIssues` means the first 50 structural issues are incomplete; fix them and recheck. Continue `nextAssetOffset` until null. A page response neither authorizes a publication nor proves cross-request mutable asset/provider facts remain unchanged. Required snapshot/commit guards and production CPU/quota measurements remain Phases 24–25.

Before first publication, the requested-address mirror must match an owned held row outside the platform blocklist. Later checks require the owned claimed row to match the fixed published address; compatible historical drafts need no requested-address mirror after first publication. Missing reservations are repaired using the content-context Address command in the editor; readiness never resets setup or changes a milestone. GitHub checks use the existing consent/generation resolver and a valid matching successful calendar. Contact checks require the referenced portfolio recipient to be verified. This service makes no public writes or provider requests.

## Inactive S-8 dispatch persistence

Migrations `0007`–`0010` add `publication_candidate`, `publication_transfer`, `publication_page` and one private `publication_candidate_index` row per source, plus cleanup retention metadata. They do not enable publication. [S-8 protocol and evidence](../../specs/2026-10-24-s8-dispatch-feasibility/protocol.md) define the bounded consumer. The [paid-at-launch decision](../../docs/deployment-policy.md) authorizes local reuse after milestone integration and applicable checks. The candidate source is private D1 working state, separate from a public snapshot/version. One guarded SQL statement seals a validated revision; Workers read bounded fields rather than parsing the complete draft. Owner deletion denies further work and private transfer. Cleanup records deliberately survive portfolio/user removal so candidate R2 objects can still be removed.

Candidate leases fence checkpoints and transfer receipts. A Queue message contains only its UUID; delivery batching does not change per-message operation charges. Sealed-source asset references must remain retained until candidate completion/cleanup even if the mutable draft later removes them. Future account deletion and garbage collection must include these records, not infer reachability solely from the current draft. Candidate prefixes use the candidate UUID, not a portfolio ID. Cleanup never changes a live pointer, namespace claim or private draft object.

Admission limits retained sources to one per portfolio and four globally, with at most 128 pending candidates. Retained-version references release pending slots; unfinished work, unreferenced ready candidates and cleanup tombstones still count. Ready inactive probes expire after one hour. Cleaned tombstones receive bounded late-object checks and physical deletion after at least 24 hours and confirmed empty output prefixes. Cleanup clears source/index and owner identifiers. `publicationRetainsAsset` protects the sealed source before and after indexing; later collectors must also check draft/live-version references. Overall allocation, metered asset storage and final native paid CPU require prelaunch verification. Free-only fit no longer blocks local Phase 24 after the authorized milestone is integrated and checked. No production consumer, cron, source or platform-package binding is activated; local authorization does not certify production readiness.


## Immutable candidate delivery

[Phase 24](../../specs/2026-10-24-immutable-publication/results.md) extends the dormant dispatcher with a sanitized `snapshot.json`, complete main/case-study/resume documents, generic 404, robots/sitemap and a content-hashed manifest. Renderer policy `publication-v1` rejects unfinished older policies; their cleanup still works. Each candidate retains only reachable ready owned uploads and the platform CSS, vanilla script, DM Sans font and selected clean cat art. Hands artwork is included in the shared generated CSS/SVG. Appearance and additional-page behavior still follow their later activation phases.

Migration `0011_publication_sealing.sql` captures private bounded address/recipient/GitHub facts and adds an optional immutable `publish_version.candidate_id` reference. Admission compares mutable facts around validation and capture. The final guarded ready checkpoint compares those facts and all copied assets' current ownership/readiness/type/size. A ready candidate is preparation success, not publication success. No pointer or address row changes here.

Version references require a ready candidate owned by that portfolio, prevent cleanup/expiry/deletion while retained, and release its private source/facts so later candidates can be admitted. Migration `0012_publication_admission.sql` backfills a `publication_candidate_pending` membership table and maintains it through transactional insert/delete triggers. Retained versions consume no pending slots. Removing a version restores its candidate to cleanup accounting, including account-deletion cascades. Bulk removal can exceed 128 pending rows and blocks new admission until cleanup physically retires enough tickets. Source checks use only pending candidate IDs, so retained history does not grow admission scans. Never edit membership directly. The index remains for asset retention and artifact receipts. Phase 25 must insert the reference with its atomic version/pointer commit and resolve only manifest-authorized paths. Deleting an account cascades version references; its orphan candidate cleanup ticket survives. Every collector must honor both candidate and version references. No candidate document, snapshot or platform file is publicly served by this implementation.
