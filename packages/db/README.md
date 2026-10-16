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

The seed creates two deterministic development users and private empty drafts. It adds no sessions, credentials, or public claims. It preserves existing drafts on reruns. Template and sample provisioning belongs to Phase 12. The fixture appearance IDs are private placeholders until the approved catalog exists.

## Owner access

Use `ownerApi` at the request boundary and pass Better Auth's session reader:

```ts
const handler = ownerApi(
  {
    db: env.DB,
    origin: applicationOrigin,
    readSession: (headers) => auth.api.getSession({ headers }),
  },
  async (_request, repositories) => {
    const portfolio = await repositories.portfolio.get();
    return privateJson(portfolio ?? null, portfolio ? 200 : 404);
  },
);
```

The guard checks the request URL against the exact application origin. POST, PUT, PATCH, DELETE, and any other unsafe method also require that exact Origin header and the application/json media type. It resolves the session on every request, then verifies the session ID, user ID, expiry, and account deletion state against D1. Authentication or D1 failures deny access. Responses always use private/no-store and noindex headers.

`ownerRepositories` accepts only an identity resolved by the authentication library. Never construct it from a request body, path, query, or owner-ID header. Each operation includes its own persisted session and owner predicates. A previously created repository therefore cannot keep accessing data after session revocation or deletion. Inserts derive the portfolio ID from the active session; supplied extra ownership fields cannot redirect inserts or upserts. Missing and cross-owner record IDs both return no record. Map those results to 404 in future handlers.

The repositories provide portfolio creation/reads, asset metadata, candidate publication versions, current claims, connected GitHub records, contact recipients and outbox, owner counters, and provider identity listings. Provider listings exclude grants. GitHub disconnect clears the grant ciphertext and private counts in one D1 batch. Outbox finalization clears visitor payloads, also enforced by a database constraint. These persistence helpers are internal methods; handlers must select permitted fields and run the relevant feature validation before calling them.

Owner counters use an encoded namespace and a cascading user reference. Owners cannot access shared email budget keys through this repository. Shared budgets and operator audits require trusted service repositories when their flows arrive. The schema exports support those services; raw queries do not belong in request handlers.

Existing claims are read-only through the owner repository. Database triggers prevent name changes, transfer, deletion, and insertion of platform-reserved names. Deleting a portfolio clears its claim's owner while retaining the name permanently. First publication must create a claim and change the live pointer in the same transaction in Phase 25. No standalone owner claim mutation is exposed here. Public draft-save endpoints, public contact acceptance with atomic budgets, delivery retries, encryption and provider grant verification remain in their scheduled phases.

## Initial setup storage

Migration `0003_initial_setup.sql` adds `setup_progress`, `first_editor_entered_at` and `draft_validation_version` in place, plus tracked `owner_save_attempt`/`owner_save_piece` staging tables. It preserves existing rows, children, claims and triggers. Existing drafts remain at their stored version until saved. Owner draft reads use the shared migration contract; the owner-status endpoint reads only portfolio identity metadata.

`repositories.setup.get()` returns private navigation, the shared revision and the permanent entry timestamp. `setup.saveProgress(revision, progress)` and `setup.saves` use the measured bounded-save engine against the canonical portfolio. Content/progress commit atomically and increment `draft_rev` together. A stale revision fails without changing either value. The setup mapping rejects all writes after first entry, including commits prepared before handoff. Later editor saving must use its own mapping while preserving the milestone and frozen progress.

`setup.recordFirstEditorEntry(revision)` is an internal persistence operation for the later authoritative handoff service. That service must flush valid saves and validate required saved content and ready owned assets at exactly that revision before calling it. No HTTP route or client flag invokes it in this phase. The first successful write increments the shared revision; repeats return the existing milestone. Database triggers prevent resetting/changing it or changing progress after entry, even during later editor content edits. Route gating and activation remain their scheduled phases.

Version 1 alone does not prove the approved destination limits were validated. Existing rows receive validation generation 0 and cannot use incremental setup saves until checked. Newly created drafts pass the current schema and receive generation 2. `setup.validateLegacyDraft()` provides a reference validator with an owner/session/revision-checked generation write for offline maintenance. It loads and validates a whole document and must not be exposed as a Free hot HTTP save path. Phase 13 must provide bounded legacy validation and explicit correction before exposing these saves for unvalidated legacy content. No migration blindly marks old data valid or truncates destinations.

The candidate lives only in private draft JSON. Two owners can save the same candidate; neither obtains a claim. Public snapshot construction must use the shared public-content projection after publication filtering. Account deletion cascades through progress/milestones and staging via the existing portfolio/user references. Post-handoff editor cleanup and dormant-owner staging cleanup belong to Phases 13 and 51.

## Verification

`test:persistence` starts an isolated local Worker, applies migrations 0000–0002, populates version 1 content with an asset and permanent claim, applies the additive setup migration, reapplies tracked migrations, and reseeds twice, and exercises the repositories in workerd/D1 with two owners and controlled session states. It uses the real Better Auth adapter and signed cookies, including an actual cached session cookie after D1 revocation. It also checks draft byte boundaries, concurrent inserts/counters, relational constraints, account-deletion cascades, permanent claims, failed dependencies, and restart persistence. It removes only its own ignored test state on the next run and writes evidence to `.wrangler/persistence-integration/evidence.json`. CI runs it alongside the existing three-Worker smoke test. The test Worker is separate from application entrypoints and accepts only local loopback requests.
