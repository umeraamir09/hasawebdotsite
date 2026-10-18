# Phase 13 implementation and verification

Implemented October 17 and verified through October 18, 2026 on `feat/revision-aware-draft-api`. The owner approved Phase 13 completion on October 18, 2026, and its roadmap checkbox is checked.

## Implemented behavior

The existing web Worker adapter forwards authenticated draft/progress requests to the named jobs `OwnerApi`. Draft reads stream D1-produced JSON text chunks from one consistent query, without Drizzle draft decoding, whole-document Zod validation or Worker reserialization. The query checks the validation generation, supported numeric envelope version, persisted session, ownership and account deletion. Progress reads omit content. Initialization and owner-status response contracts retain their previous shapes.

Strict shared action schemas expose bounded patches, progress-only CAS, staged string/collection changes and explicit attempt recovery. Setup and content starts persist distinct contexts. Setup saves stop permanently at first editor entry, including previously prepared attempts. Content saves retain frozen progress and the milestone. Canonical content, applicable progress, timestamp and revision change atomically; successful responses return the persisted revision. A committed setup receipt remains readable after handoff. Reads and writes on a live session with no portfolio row return 404 `not_found`; revoked, expired or deleting sessions keep returning 401 `unauthorized`.

Legacy validation clones supported unvalidated content in D1, traverses shared schema definitions through a server-controlled cursor, and commits only after complete validation under revision CAS. Each call examines at most four fresh nodes, or two for deep paths, within the approved ceiling of 16 and at most 4 KiB of validation data. Checked ancestor metadata stays in the cursor, and immutable lazy schemas are resolved once. Large free text stays inside D1. Explicit destination corrections use the stored link kind, check the resulting document size and restart traversal. Unsupported structures remain blocked and available through the separate owner recovery attachment. The offline full-document maintenance validator has no HTTP action.

Migration `0005_owner_draft_api.sql` adds attempt context and validation metadata. Existing staged rows become setup attempts; pieces, claims and milestone triggers remain intact. Historical migrations are unchanged. The original document/request/change/piece/count/expiry limits remain in force. See the [production protocol](protocol.md) and [request/D1 budgets](quotas.md).

## Functional verification

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm check` | Lint, 12 package typechecks and 224 tests in 22 files pass. | [Command receipts](verification.json). |
| `pnpm build` | All 12 tasks pass, including Next/OpenNext and Worker dry runs. | [Command receipts](verification.json). |
| `pnpm test:draft-api` | 15 groups pass through the built web Worker and real production jobs router with signed Better Auth fixture sessions and isolated D1. | [API results](local-results.json). |
| Local handler/quota benchmark | All 22 cases pass; authentication and raw Drizzle reads are included in D1 counters. | [Measurements](local-benchmark/local-results.json). |
| Deep validation/correction benchmark | 100 measured commands per case pass after 100 warmups, including the deepest supported rich-text tree with a maximum escaped destination. | [Measurements](deep-local/local-results.json). |
| `pnpm test:persistence`, twice | Both runs pass all 73 groups, retained staging migration, repeatable fixtures and restart persistence. The harness clears intermediate migration files before each run. | [Persistence evidence](persistence-evidence.json), [receipts](verification.json). |
| `pnpm test:bounded-saves` | All 17 existing bounded-save groups pass. | [Regression evidence](bounded/local-results.json). |
| `pnpm test:auth:browser` | 29 provider/auth/provisioning groups, Chromium cookie isolation and ten browser journey checks pass. | [Browser evidence](auth/evidence.json). |
| `pnpm test:runtime` | Three Workers, D1, three R2 buckets, service bindings, Queue, Workflow and restart persistence pass. | [Command receipts](verification.json). |

Coverage includes content/progress races, stale revisions, staged commits, lost replies, identical/mutated retries, session transfer, expiry, revocation/deletion during writes, missing-portfolio reads and writes, storage failures and restart recovery. Handoff closes prepared setup writes while content, inspection, discard and bounded cleanup continue. Two owners can save the same candidate. Separate assertions preserve existing publications, published pointers, permanent claims, ready assets, frozen setup data and connected-service rows across direct and staged content saves.

The legacy suite compares bounded validation with the full reference reader across every component type, required/unknown fields, discriminators and versions, arrays/tuples, references/uniqueness, rich-text depth, destination rules, NUL/astral/lone-surrogate text and actual maximum drafts. Rejected corrections preserve canonical content and attempt sequence. Invalid version types remain recoverable. The production API suite is included in CI.

## Provider measurements

All 22 measured cases meet the warm p95 CPU target below 10 ms. The final maximum draft read measures 8.881 ms in jobs and 0.855 ms in web. Deep validation measures 9.010 ms in jobs. Worker startup is 60 ms for jobs and 48 ms for web, below one second. These are provider CPU percentiles, not client latency or a promise that every invocation stays below 10 ms. See [measurements, tuning history and limitations](performance.md).

Streaming reduces CPU at a measured D1 cost of 268 rows read for the maximum draft, compared with five for the earlier whole-string response. Authentication and the snapshot still use three queries in total. Progress reads continue to omit content. The [quota evidence](quotas.md) records this tradeoff and separate instrumented provider measurements.

Both temporary Workers and the dedicated test database were deleted. The local experiment secrets were removed, and API inventory checks confirm both preexisting databases remain. See the [deletion receipt](cleanup.txt) and [independent cleanup verification](cleanup-verification.json).

## Scope and operation

No UI, Figma, autosave orchestration, local recovery interface, conflict dialog or onboarding activation changed. Production deployment remains outside this phase. The temporary provider fixtures use synthetic owners and sessions, separate workers.dev Workers and a dedicated test database.

Retain committed receipts until explicit cleanup. Expiry denies writes without deleting staging automatically. Large/dense legacy documents may require many calls, and authentication/retries consume additional quota. The [earlier capacity model](../2026-10-16-free-owner-saves/quotas.md) still applies to autosave planning; these measurements do not establish unlimited Free-tier capacity.

Apply the forward migration before enabling these handlers. A code rollback can leave its additive columns and retained staging in place. Do not downgrade by dropping staging or rewriting historical migrations. Future schema/refinement changes must update the incremental validator, generation checks and equivalence fixtures together.
