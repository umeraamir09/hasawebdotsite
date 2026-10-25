# S-8 bounded dispatcher prerequisite

## Outcome and gate

The follow-up implements reusable inactive preparation, Queue/D1 dispatch, page assembly and private asset transfer, but **fails the required feasibility gate**. The repeated maximum candidate's native Queue CPU is p95 71.704 ms, above 10 ms. Valid dense/gallery workloads also exceed shared Free quotas. Phase 24 remains blocked. No owner completion approval or integration is recorded, and the existing Phase 24 worktree/audit is untouched.

Shared base: `main` at `5564c31`. Branch: `feat/s8-dispatch-feasibility`. One implementation owner; no delegation. The owner approved this implementation plan, not the resulting prerequisite. [Publication requirements](../../docs/acceptance-criteria.md#15-subdomain-selection-and-publication), [Phase 24 dependencies](../../docs/roadmap.md#phase-24-prepare-immutable-publication-versions) and [historical S-8/S-9 failures](../2026-10-15-workflow-assets/results.md) retain their authority.

Final source files are identified by the [base and SHA-256 manifest](evidence/source-manifest.json); native and quota provider versions are recorded separately.

## Delivered contract

The [protocol](protocol.md) describes atomic revision-guarded SQL source capture without a whole-draft Worker parse, bounded command/text/component preparation, actual shared `renderFragment` calls, Unicode-safe byte cursors, wrapper-preserving output and streaming multi-page assembly. `s8-v2` pins the corrected byte-cursor/stream policy. Unsupported work versions fail; cleanup can remove older candidate formats.

D1 owns candidate identity, source revision, immutable execution policy, cursors, page/transfer receipts, fenced leases, consecutive attempts and deadlines. Queue packets contain only the candidate UUID. Deterministic private R2 keys make replay safe; bounded sweeping recovers missing wakes and expired leases. Four exhausted attempts persist terminal failure rather than endlessly redelivering. Cleanup survives owner removal and retains draft sources and prior live output.

The named web `PublicationAssets` entry checks persisted candidate reachability, exact asset purpose, ownership, readiness, bytes/media and deletion before resolving a source key. Jobs streams through a service binding and repeats fencing/metadata checks before its receipt. `DRAFT_BUCKET` stays web-only. The default web HTTP route does not expose that entry. Production publication, consumer/binding/cron activation, editor activation, public serving and live-pointer/claim changes are absent.

## Evidence

- Local matrix covers small/mixed drafts, exact 1 MiB total content across three pages, long Unicode/descriptions, isolated surrogates, deep rich text, 3,000 components, both existing decorations, enabled/disabled Face Reveal, repeated gallery references and case-study images. Maximum image/PDF copies have exact byte/hash checks. The independent full renderer is an offline correctness oracle only.
- Failure checks cover duplicate delivery, stale/terminal leases, cross-candidate source tickets, wrong purpose, unreachable ready assets, readiness/size mismatch, persisted deletion, post-write replay, lost enqueue acknowledgement, sweep recovery, active/exhausted fourth attempts, source retention and cleanup isolation. A later draft revision cannot alter a sealed candidate. Actual owner removal permits candidate cleanup.
- The first full local gate passed 454 tests and all suites. The final focused batch-32 profile passed, including 11 integration groups. The [final full gate](evidence/verification-summary.json) passed all 13 commands, including 455 unit tests, every application build and all renderer/auth/persistence/upload/dispatch/draft/autosave/editor/runtime/routing suites. All heavy checks use `pnpm verify` and its shared lock.
- [Native complete matrix](evidence/native-batch32-results.json): 8/8/21/22/51/51 checkpoints, exact output and maximum private copies. [Repeat maximum provider CPU](evidence/native-repeat-max-cpu.json): 50 successful SEA invocations, median 27.128 ms, p95 71.704 ms, p99 149.963 ms. Native deployed Queue version `0b505d79-adfe-4ca2-8861-74258b6af585` predates the final stream/deletion/marker fixes; it cannot approve the final revision. [Initial execution](evidence/native-initial-small-cpu.json) and [small repeated batch-16 samples](evidence/native-repeat-small-batch16-cpu.json) remain separate evidence.
- [Deployed quota counters](evidence/provider-quota-results.json) cover 8/51/116 complete invocations, including the named source's D1/R2 counters. [Invocation boundaries](evidence/quota-invocation-boundaries.json) identify the instrumented version and outcomes. They are excluded from native CPU claims. [Local proof](evidence/local-batch32-results.json) additionally records large binary inventories, recovery and cleanup.
- [Shared ledger and limitations](costs.md): maximum batch-32 planning usage is 62,153 Worker invocations, 1,691,327 reads, 80,933 writes and 9,135 Queue operations/day with the requested replay/failed-candidate reserve and explicit shared forecasts. Dense usage is 25,349,423 reads and 15,813 Queue operations/day. Storage/admission/retention remain unresolved. No paid-plan assumption or content-limit reduction is made.

The [cleanup receipt](evidence/provider-cleanup.json) confirms deletion and subsequent HTTP 404 metadata checks for all eight owned resources. Cleanup required detaching the consumer and removing producer Workers before deleting their Queue.

Isolated resources used the `hasaweb-s8-f5419d` prefix and synthetic data only. All three buckets had managed public access disabled and no custom domains. Queue retention was 86,400 seconds, consistent with Free's fixed retention; subscription billing metadata was inaccessible, so account-plan proof remains incomplete. Native and quota deployments were separate. Source fixtures import the real boundary implementation, but do not measure full production OpenNext startup. Local heavy verification ran concurrently with the remote client, so client latency is not a CPU metric. Provider CPU, version, location and invocation boundaries are retained where available.

The [Unicode regression](evidence/unicode-regression.json) preserves the failing normalization and repair. Historical oversized three-page stress remains in the original S-8 record, separate from the valid total-1-MiB case. Restricted-sandbox verification-runner failures were rerun elevated and passed; none were waived. An automatic permission-review timeout on quota execution was retried once successfully. The first quota collector omitted R2 counter names; its incomplete run was discarded and the corrected complete run supplies the ledger.

## Separate boundary review

A separate final pass reviewed transfer authorization, revision races, lease fencing, retry recovery, deletion/cleanup and budgets. It found and repaired: later pages being skipped during assembly, SQLite lone-surrogate corruption, an active fourth claim being expired too early, owner-deletion cleanup guards, missing source-hop instrumentation, unbounded assembly stream waits and a valid attribute colliding with the controlled wrapper marker. Focused tests and the final full gate cover the repaired local behavior.

The review does not approve feasibility. Remaining blockers are the measured CPU failure, dense/gallery quota failures, final-version/native cold and authorization/sweeper evidence, source/tombstone storage retention and admission, full production source-module startup, and S-8-specific interrupted-stream/transient D1/R2 failure injections. Existing upload fault tests are not substitutes for those dispatcher tests. Production snapshot/manifest/style retention and future generated palettes also require measurement when integrated. S-9 browser/query-cache withdrawal remains a separate prerequisite.

## Concrete remediation and approval

1. Profile the repeated maximum invocation, including byte decoding, normalization, React serialization and bookkeeping. Redesign the batch/output strategy until complete native warm p95 is below 10 ms with demonstrated cold behavior. Increasing the batch from 16 to 32 saved messages but failed CPU.
2. Remove repeated dense JSON scans and reduce traversal/transfer wake overhead. Measure the resulting reads, writes, storage and CPU together; gallery and dense cases must have an explicit supported planning contract without shrinking the agreed content allowance.
3. Bound candidate admission and physical source/tombstone retention, retain sealed-source assets during GC, and verify deletion/late-write cleanup plus transient storage/stream faults. Reproduce the shared ledger, including actual sweeps and production start/poll/snapshot/manifest work.
4. Only after those gates pass, obtain explicit owner approval of the tested revision, integrate it into the shared base, rerun invalidated checks, and record approval/integration commits in Phase 24's audit. Material changes need renewed verification and approval. No Phase 24 implementation starts now.

## Documentation impact

The changed assumption is that reusable preparation/source-transfer code now exists, while feasibility and activation remain unapproved. Updated the roadmap dependency, implementation baseline, architecture, renderer/components/database/private-asset guidance and verification profiles. Downstream account deletion and GC must retain sealed candidate references and remove surviving cleanup state. Historical S-8/S-9 evidence and prior owner approvals remain intact. No roadmap completion checkbox was changed.

## October 25 continuation

The owner requested continued S-8 technical work in the existing clean worktree at `e9e3158`. Phase 24 remains blocked pending technical verification, explicit completion approval, integration and integration checks. The separate Phase 24 worktree is outside this task's write boundary.

Baseline claim to test: complete native invocations of `e9e3158`, at logical batch 32 with the actual renderer and synthetic maximum/dense/gallery inputs, either meet warm p95 below 10 ms or identify a reproducible failing boundary. Diagnostic profiling and quota counters are separate from native acceptance. Previous provider state and cleanup receipts are preserved.

The owner confirmed Workers Free for account `b6f9a87e6702c76c45a8d61744826e0f` on October 25. [Plan evidence](evidence/provider-plan-confirmation.json) separates that confirmation from inaccessible billing metadata. Fresh resources use `hasaweb-s8-d3c356`, with public bucket access disabled.

The exact `e9e3158` baseline completed [five maximum-content repetitions](evidence/native-e9e3158-five-results.json). [Per-candidate native CPU windows](evidence/native-e9e3158-five-cpu.json) report p95 49.047 ms in DEN, 31.655 ms in SJC, 54.001 and 54.490 ms in SEA, and 43.755 ms in DEN. Every repetition fails 10 ms; two windows contain 50 of 51 expected observations. All retained outcomes are successful with exact output. These repeats use 128-byte synthetic binaries. The earlier fresh baseline separately completed small/maximum/dense with full-size binaries before a gallery seed request timed out. Client transport failure is not a provider CPU-limit failure.

Production-mode diagnostic profiles identified hex decoding and duplicate text decoding as concrete application work. They include local workerd/D1 adapter overhead and are not native acceptance CPU. An explicit CTE-materialization experiment increased dense reads and was discarded. Current working changes use native hex conversion, adjacent bounded text windows, a single typed asset/page index, shared component/project entry rendering, reused sealed profile parts, grouped readiness scans, admission/retention and specific fault injection. Final local/native verification and the shared ledger remain pending. Runs interrupted by watched source edits or the old shared fixture-config path are diagnostic only. Each run now owns its configuration directory, and the client closes idle oracle-download connections.
