# Phase 10 results

Implemented on October 15, 2026 on `feat/owner-persistence`. The owner approved Phase 10 completion on October 15, 2026, and its roadmap checkbox is checked.

## Implementation

The database package now has 15 Drizzle tables and three tracked SQL migrations. These cover Better Auth records, portfolios, assets, publication versions, reserved names and permanent claims, GitHub connections/activity, contact recipients/outbox, counters, and operator email audits. Schema generation reports no pending changes.

Owner repositories resolve ownership from a session identity and check the persisted session, its expiry, and the account deletion flag in each operation. Inserted records derive their portfolio from that identity. Explicit field selection prevents an injected owner or portfolio from changing the target. Unique constraints enforce one portfolio per account and one publication number per portfolio. The reusable API guard checks the application origin, requires exact Origin and JSON headers for mutations, resolves the session, and forces private/no-store and noindex responses.

Claim triggers prevent transfers, deletion, and name changes. Foreign-key deletion retains the claim name with no portfolio reference. Owner counters have a separate encoded namespace and cascade on account deletion. GitHub disconnect clears grant ciphertext and private counts atomically. Both repository finalization and a database constraint remove visitor payloads on sent/failed outbox records.

Local seeding applies migrations before adding development identities and valid private drafts. It creates no usable sessions or provider credentials and preserves existing drafts on reruns. CI now runs the workerd/D1 persistence suite.

## Verification

| Check | Result |
| --- | --- |
| Frozen dependency installation | Passed |
| `pnpm check` | Passed Biome, all 11 package typechecks, and 139 unit tests |
| `pnpm build` | Passed all 11 packages, including OpenNext and both Worker dry runs |
| `pnpm test:persistence` | Passed 31 integration groups in actual local workerd/D1 |
| `pnpm test:runtime` | Passed three Workers, D1, three R2 buckets, service bindings, Queue, Workflow, and restart persistence |
| Drizzle regeneration | No schema changes or missing migrations |
| `git diff --check` | Passed |

The [integration evidence](evidence.json) records each group. The suite applies migrations twice and fixtures twice, then exercises two owners and controlled expired, revoked, deleting, and mismatched sessions. It also uses the real Better Auth adapter and signed cookies. An actual Better Auth session cache cookie still resolves its cached identity after D1 revocation, while the owner guard denies that same request. Rejected mutation requests never reach the write handler. Authentication and D1 failures return 503 without private content.

Cross-owner tests cover portfolio reads; asset reads, listing, creation collisions, updates and deletion; version reads, listing, collisions and failure writes; claim reads; GitHub and recipient upserts with injected portfolio IDs; outbox reads, listing, collisions and finalization; provider listings; and owner/global counter isolation. Additional checks cover concurrent portfolio creation and counter increments, exact 1 MiB UTF-8 draft boundaries, relational constraints, finalized payload removal, account deletion cascades, and claim retention. Restart checks recover the same portfolio, ready asset, counter, and claim.

The first integration run caught drizzle-kit's omission of `ON DELETE CASCADE` when adding the counter owner column. The checked-in migration corrects that omission, and the deletion test now passes.

## Acceptance evidence

1. Fresh and repeated migrations/fixtures pass in the isolated integration database. The standard local seed and existing three-Worker smoke test also pass.
2. Database tests enforce uniqueness, foreign keys, valid JSON, byte bounds, and permanent reservations.
3. Owner isolation and injected-ID checks pass across all private repositories. Shared email budget keys cannot be addressed through owner counters.
4. Origin, media type, signed/cached/missing/forged sessions, expiry, revocation, deletion, mismatched users, cache headers, and unavailable dependencies pass.
5. Repositories opened before revocation/deletion lose access. Provisioning cannot change publication pointers. Outbox finalization clears payloads.
6. Integration verification uses the checked-in migrations and real workerd/D1, passes restart checks, and is included in CI. Existing checks and builds pass.
7. This report and machine-readable evidence are recorded. The owner approved the roadmap completion checkbox on October 15, 2026.

## Scope and workspace cleanup

At the owner's explicit request, the accidentally concurrent chat's alternate guard, tests, fixture, draft-update method, package/seed changes, and report were removed. They are not part of this implementation. Its conflicting tables in the default local database were backed up under ignored `.wrangler/` storage and removed before applying these tracked migrations. The pre-existing runtime probe and R2 fixtures were preserved; the full local runtime smoke test passes afterward.

No public UI changed, so no Figma access or writes were needed. Provider sign-in flows, draft save/revision endpoints, upload validation, live-pointer/first-claim transactions, encryption and provider authorization, global contact budget acceptance, delivery workers, operator tools, and production deployment remain in their scheduled phases. The private fixture appearance IDs do not approve a public theme/font catalog. These local checks do not establish Cloudflare production CPU feasibility or replace the required hot-API runtime measurement.

## PR review fixes

Both findings on PR #9 were reproduced against local workerd/D1 before fixing them. Portfolio creation now ignores all uniqueness conflicts before reading only the active owner's portfolio. Outbox finalization now updates only queued or sending rows, so a later attempt cannot replace a sent/failed result or its error metadata.

Two new regression groups cover portfolio ID collisions for owners with and without an existing portfolio, duplicate finalization, both terminal outcomes, and concurrent finalization from queued and sending states. `pnpm check` passes with 139 unit tests; `pnpm test:persistence` passes all 31 integration groups, repeated migrations/fixtures, and restart persistence. Updated evidence is recorded in [evidence.json](evidence.json).
