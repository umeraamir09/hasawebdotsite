# S-8 bounded dispatcher prerequisite

## Current decision, October 27, 2026

The owner approved [Workers Paid at launch, with local development continuing now](../../docs/deployment-policy.md). The earlier Free-only CPU, Queue and storage failures below remain true measurements, but no longer block local Phase 24. Upgrade only during launch preparation, before public activation; no billing or remote resource change is authorized now.

The named S-8 local development milestone reuses tested application `5b796accfac88bf40b2875e606b79c52192a3e16` and evidence/tooling through `acc77f2`. The owner instruction authorizes local continuation on this scaffold after shared-base integration and applicable local checks. This is not a claim that S-8 passed Free feasibility, completed Phase 24, or passed paid-provider production acceptance. The current [implementation sequence and release gates](../../docs/deployment-policy.md#implementation-sequence) control dependent work.

Final paid native CPU/cold/error behavior, positive publication start, scheduled cleanup, monthly costs, D1 allocation, R2 retention/peaks and actual public withdrawal must pass at launch. Keep all bounded-work, authorization, recovery and content contracts. The account remains Free until launch preparation. The 25-portfolio discussion did not change the established workload.

### Documentation impact of this decision

Changed the hosting target and the timing of provider-budget verification, not owner-facing functionality. Updated architecture, roadmap, implementation/workflow baseline, onboarding/acceptance/product guidance, subsystem READMEs, S-8 protocol/cost interpretation and linked historical spike entry notes. Preserve numerical evidence, original approvals and the prior blocked Phase 24 audit; append its current local/release split after integration. No phase completion box is checked by this decision.


### PR candidate verification and shared-base status

The owner requested a separate session branch and PR instead of direct main changes. Local `main` was briefly fast-forwarded during integration testing, then restored to its exact starting revision `5564c31` after preserving every commit on `docs/paid-launch-policy`. Nothing was pushed to main. Merge this PR before dependent Phase 24 application changes begin; local authorization is recorded, but integration into shared main is not yet complete.

The [candidate full gate](evidence/integration-869aa40.json) passed all 13 commands on clean revision `869aa408c6108f96f10efbc40a1d775058ae44ed`, with 456 unit tests, every build, 32 S-8 groups and all auth/persistence/uploads/draft/autosave/editor/runtime/routing suites. This run exercises the default logical batch 16 as additional correctness coverage; earlier native/quota batch-32 receipts remain separate measurements. No paid-provider pass is claimed.

The [first root integration run](evidence/integration-discovery-failure-5e81f2b.json) failed because default Vitest discovery collected tests inside other `.wrangler/worktrees` checkouts. Commit `869aa40` excludes generated `.wrangler` state and preserves all 41 active-checkout test files. The complete rerun passed; no test failure was waived. Later edits only record the owner decision, linked historical supersessions, this PR boundary and the preserved Phase 24 audit, so they do not invalidate the passing application gate.

## Historical Free-target outcome, before the owner decision

The inactive `s8-v3` implementation passes the full local gate and the deployed content matrix, but **S-8 feasibility remains unverified and Phase 24 remains blocked**. Native Queue CPU exceeds the required 10 ms p95. The complete shared forecast exceeds the Free Queue allowance for dense content. A valid gallery plus Face Reveal draft also disproves storage fit for the current separate private/public asset copies. No completion approval, integration, production activation or Phase 24 implementation is recorded.

The tested application revision is `5b796accfac88bf40b2875e606b79c52192a3e16`. Commit `94f317b` adds the gallery-plus-Face fixture and storage failure reporting without changing application code. Commits `531d8d5`, `676aeec` and `db739f6` correct incomplete CPU windows, reserve delivery replays and match storage inventories across candidate-specific URLs. The [current source manifest](evidence/source-manifest-s8-v3.json) separates runtime, fixture and measurement-tool revisions. Shared `main` remains `5564c31`; the separate Phase 24 worktree and prerequisite audit are untouched. One implementation owner, with no delegation.

The owner confirmed Workers Free for account `b6f9a87e6702c76c45a8d61744826e0f`. [Plan evidence](evidence/provider-plan-confirmation.json) distinguishes that confirmation from inaccessible subscription metadata. [Publication acceptance](../../docs/acceptance-criteria.md#15-subdomain-selection-and-publication), [Phase 24 dependencies](../../docs/roadmap.md#phase-24-prepare-immutable-publication-versions) and the unresolved S-9 withdrawal prerequisite still control dependent work.

## What changed

The [current protocol](protocol.md) pins `s8-v3`. Preparation reuses one bounded encoded-text window per invocation, a single typed asset/page index per candidate, grouped shared component/project rendering, and prepared profile parts across pages. It removes repeated dense collection scans without adding one persisted row per component. Complete shared rendering, normalization, escaping, Unicode and wrapper order remain unchanged. Maximum, dense and gallery candidates now require 28, 60 and 37 checkpoints respectively, compared with the original 51, 116 and 70. These are work counts, not a CPU speedup claim.

Admission permits one sealed source per portfolio, four globally and 128 retained records. Private ready probes expire after one hour. Cleanup scrubs source/index and owner identifiers. Tombstones retire after at least 24 hours and two-bucket absence checks; bounded sweeps can delay physical removal. Failed storage cleanup retains a scrubbed prefix ticket for explicit retry rather than endless redelivery. The reusable asset-retention guard protects all portfolio assets before indexing and indexed sealed references before transfer discovery. A future collector must combine this with draft/live-version reachability.

Lease/sequence fencing covers cleanup checkpoints as well as preparation. Assembly remains limited to sixteen inputs and two simultaneous storage bodies, with idle and total transfer deadlines. Local fault injection now exercises truncated, interrupted and idle streams, transient writes and checkpoints, deletion during transfer, cleanup exhaustion, late objects and old cursor policies. A repaired legacy tombstone bug preserves the original retention age instead of resetting it on every sweep.

## Verification and native evidence

The [clean full local gate](evidence/verification-5b796ac.json) passed all 13 commands at exact revision `5b796ac`, with 456 unit tests, every application build and [32 S-8 integration groups](evidence/local-s8-v3-full-results.json). The later [gallery-plus-Face proof](evidence/gallery-face-storage-results.json) passed 20 focused groups with full-size files. Tooling changes received formatting, syntax and exact ledger reproduction checks. Final repository lint passed with three existing specificity warnings in unchanged `editor.css`. Changed Markdown file links and runtime source hashes passed their checks. Heavy local verification used the shared `pnpm verify` resource lock.

The [native full-size matrix](evidence/native-s8-v3-full-results.json) passed all 13 cases, including exact total-1-MiB multi-page content, 3,000 components, deep rich text, long Unicode/descriptions, isolated and boundary surrogates, both decorations, Face Reveal, repeated gallery references, and complete maximum-size image/PDF hashes. The actual full web module supplied the private named source entry. [Active versions and deployment startup](evidence/native-s8-v3-provider-versions.json) identify Queue version `2dba82ff-ec15-4417-a9ab-46145d50a850` and full-source version `c0403b07-093d-4b22-b7d2-4ae590ce4875`. Full-source deployment startup was 92 ms. Deployment startup is separate from invocation CPU.

[Per-candidate native CPU](evidence/native-s8-v3-matrix-cpu.json) reports p95 values above 10 ms across the matrix. Examples are maximum 187.130 ms in SEA and dense 29.273 ms in DFW. A subsequent full-size repetition completed maximum at 127.299 ms in SEA and dense at 24.582 ms in DEN before a truncated HTTP response interrupted the gallery-plus-Face transfer. [Completed windows](evidence/native-s8-v3-interrupted-cpu.json) exclude that incomplete candidate; [the partial result](evidence/native-s8-v3-interrupted-results.json) preserves it. This is a client transport failure, not evidence of a CPU-limit rejection.

Analytics values are microseconds, divided by 1,000 for milliseconds. Windows include complete candidate work and identify region/version; adaptive analytics sometimes omit observations or include additional deliveries. Counts are retained beside checkpoints. All outcomes in the completed retained matrix/partial windows are successful, with zero reported errors. Repeated candidates do not label individual warm/cold isolates. Neither these windows nor deployment startup certify cold execution. Quota instrumentation and local profile samples are excluded from native CPU claims.

[Five repeated maximum candidates](evidence/native-s8-v3-five-results.json) all completed at 28 checkpoints with exact output and 128-byte synthetic binaries. Their [native CPU groups](evidence/native-s8-v3-five-cpu.json) retain all locations and outcomes:

| Repetition | Successful group p95, ms | Observed / checkpoints | Other outcomes |
| --- | --- | --- | --- |
| 1 | SEA 33.335 | 30 / 28 | One `clientDisconnected` |
| 2 | DFW 30.210; SEA 14.160 | 30 / 28 | One `clientDisconnected` |
| 3 | DFW 29.165 | 28 / 28 | None |
| 4 | SJC 29.615 | 28 / 28 | None |
| 5 | SEA 31.971 | 28 / 28 | None |

These are per-region quantiles, never averaged. The two non-success provider outcomes and additional invocations in the first two repetitions remain unexplained. All five outputs completed, [retained candidate error fields were empty](evidence/native-s8-v3-post-repetitions.json), and no retained group reports `exceededCpu`. The last three contain exactly 28 observations each, still above the target. No individual cold-isolate label is available and no warm p95 pass is established.

[Native lifecycle probes](evidence/native-s8-v3-lifecycle.json) exercised ten empty sweeps and five four-tombstone sweeps through HTTP, deleting all twenty synthetic old tombstones. This is the actual core sweeper function, not scheduled-trigger proof. Three D1 allocation cycles each inserted and deleted four 1-MiB source payloads. File metadata repeatedly rose from 1,372,160 to 5,578,752 bytes and returned to 1,372,160 bytes; D1 delete-statement `size_after` reported 1,376,256 bytes. Neither API snapshot nor this narrow allocation-only fixture proves capacity for 100 owners or page/index/asset growth.

A subsequent [isolated native HTTP sweeper run](evidence/native-s8-v3-sweeper-results.json), on [control version `cce2c323`](evidence/native-s8-v3-sweeper-deployment.json) with instrumentation disabled, replaced an earlier window contaminated by a state-read request. [Provider CPU](evidence/native-s8-v3-sweeper-cpu.json) contains 9/10 empty-sweep observations and all 5/5 four-tombstone observations. Empty-sweep p95 is 5.626 ms in KHI and 4.914 ms in LHE. Tombstone-sweep p95 is 10.419 ms in KHI and 7.673 ms in LHE. All retained outcomes are successful. These small regional groups do not establish a warm/cold guarantee, and one exceeds the target. Cron was never activated.

The [deployed start checks](evidence/native-s8-v3-start-denials.json) reject absent, forged and expired sessions and another owner's session without creating a candidate. The other-owner response is a generic fixture 500, not a product HTTP contract. Isolated positive-start CPU remains unverified.

The exact `e9e3158` baseline completed [five maximum repetitions](evidence/native-e9e3158-five-results.json), with [p95 values](evidence/native-e9e3158-five-cpu.json) from 31.655 to 54.490 ms. Local production-mode diagnostics identified hex and duplicate text decoding, which the implementation removes. Current [maximum](evidence/diagnostic-s8-v3-max.json), [dense](evidence/diagnostic-s8-v3-dense.json) and [gallery](evidence/diagnostic-s8-v3-assets.json) profiles show D1 response conversion, SDK instrumentation and preparation work. These sampled profiles include local adapter overhead. They do not attribute native outliers precisely. There is no controlled interleaved A/B result and no percentage speedup claim.

The [provider-backed shared ledger](costs.md) includes all 148 instrumented wakes, measured cleanup and local sweep reserves, the unchanged 100/30/30 workload, future delivery work, ten-percent replays including delivery, and one fully failed candidate. Dense usage projects 4,665,125 D1 reads, 85,093 writes and 10,443 Queue operations/day. Reads/writes fit; Queue exceeds the 10,000 allowance. Maximum usage projects 1,626,627 reads, 83,189 writes and 7,659 Queue operations/day. These operation forecasts do not override native CPU or storage failures.

The [current cleanup receipt](evidence/provider-s8-v3-cleanup.json) confirms deletion and subsequent HTTP 404 checks for all nine `hasaweb-s8-d3c356` resources: four Workers, one Queue, three buckets with their fixture objects, and one D1 database. Bucket public access remained disabled. No billing, DNS or production routing changed. Historical `hasaweb-s8-f5419d` receipts remain separate.

## Storage and remaining work

The [gallery-plus-Face storage proof](evidence/gallery-face-storage-ledger.json) uses a valid 7,098-byte draft, 24 gallery entries with repeated images, a case image, avatar/banner/Face and a 10 MiB PDF. Its private inventory is 50 MiB, and its nine distinct copied assets total another 50 MiB. One retained public version across 100 portfolios projects 10,487,616,300 bytes before snapshots/styles/temp files/replacements. The complete delivery/retention forecast reaches 11,015,636,956 bytes. This exceeds the agreed 10,000,000,000-byte planning allowance even without retaining extra public versions. A 24-hour orphan window is an assumption, not an implemented collector.

A [schema-validated distinct-gallery variant](evidence/unique-gallery-storage-lower-bound.json) is only 7,136 draft bytes. Replacing the 24 repeated gallery references with distinct image IDs permits 29 assets. At the current maximum upload sizes, one physical copy requires 157,286,400 bytes per portfolio or 15,728,640,000 bytes for 100 portfolios. The gallery images alone require 12,582,912,000 bytes. This is an arithmetic lower bound, not a seeded binary/native test. It assumes different owner payloads, so compression or cross-owner deduplication cannot be taken for granted. Even a single-copy layout cannot guarantee that the entire allowed maximum-content workload fits the agreed storage budget.

A separate boundary pass reviewed persisted authorization/purpose/size/deletion, revision CAS, source sealing, leases, retries, source/identifier scrubbing, old policy cleanup and runtime/storage budgets. Repaired local behaviors pass the focused and full gates. Remaining acceptance gaps are native p95 and cold labeling, isolated positive-start CPU, actual scheduled-trigger behavior, final delivery implementation/counters, general storage/GC capacity and the incompatible distinct-gallery maximum. The bounded private candidate lifecycle does not prove those future paths.

Avoiding duplicate private/public payloads would improve the current layout. A possible prototype is one immutable owned-object store with private/public manifest references, or a verified relocation/read-fallback design, preserving private reads, ownership, withdrawal and sealed/version reachability. This is a material contract change and is not implemented here. It still cannot satisfy the distinct-gallery lower bound. A guaranteed maximum-content fit therefore also needs an explicit owner decision about an aggregate content/storage contract or a larger allowance. Neither is changed in this work. Shorter orphan retention, task batching and deduplication assumptions cannot remove that lower bound.

Queue work also needs further task packing for the complete dense forecast. Native CPU needs a separately profiled minimal Queue entry and measured SDK/initialization boundaries before another batch choice. Do not reduce the content allowance, omit future delivery work or assume a paid plan to obtain a pass. After a replacement passes all technical gates, obtain explicit owner approval of its exact revision, integrate it, rerun affected checks and record both commits in Phase 24's audit. S-9 remains separate.

## Documentation impact

The changed assumption is that bounded indexed preparation, source admission/retention and specific dispatcher recovery tests now exist, while CPU, shared quota and storage feasibility still fail. Updated the protocol, shared ledger, implementation baseline, architecture, renderer/components/database/private-asset guidance and the downstream GC requirement. Current guidance must use the sealed-source retention guard. Historical failures and owner approvals remain below. No roadmap completion checkbox changed.

## Historical initial follow-up

The following record describes the initial follow-up before the October 25–27 changes. Its `s8-v2` metrics, missing proofs and original cleanup apply to that revision. Current evidence above supersedes its pending-work statements.

### Outcome and gate

The follow-up implements reusable inactive preparation, Queue/D1 dispatch, page assembly and private asset transfer, but **fails the required feasibility gate**. The repeated maximum candidate's native Queue CPU is p95 71.704 ms, above 10 ms. Valid dense/gallery workloads also exceed shared Free quotas. Phase 24 remains blocked. No owner completion approval or integration is recorded, and the existing Phase 24 worktree/audit is untouched.

Shared base: `main` at `5564c31`. Branch: `feat/s8-dispatch-feasibility`. One implementation owner; no delegation. The owner approved this implementation plan, not the resulting prerequisite. [Publication requirements](../../docs/acceptance-criteria.md#15-subdomain-selection-and-publication), [Phase 24 dependencies](../../docs/roadmap.md#phase-24-prepare-immutable-publication-versions) and [historical S-8/S-9 failures](../2026-10-15-workflow-assets/results.md) retain their authority.

Final source files are identified by the [base and SHA-256 manifest](evidence/source-manifest.json); native and quota provider versions are recorded separately.

### Delivered contract

The [protocol](protocol.md) describes atomic revision-guarded SQL source capture without a whole-draft Worker parse, bounded command/text/component preparation, actual shared `renderFragment` calls, Unicode-safe byte cursors, wrapper-preserving output and streaming multi-page assembly. `s8-v2` pins the corrected byte-cursor/stream policy. Unsupported work versions fail; cleanup can remove older candidate formats.

D1 owns candidate identity, source revision, immutable execution policy, cursors, page/transfer receipts, fenced leases, consecutive attempts and deadlines. Queue packets contain only the candidate UUID. Deterministic private R2 keys make replay safe; bounded sweeping recovers missing wakes and expired leases. Four exhausted attempts persist terminal failure rather than endlessly redelivering. Cleanup survives owner removal and retains draft sources and prior live output.

The named web `PublicationAssets` entry checks persisted candidate reachability, exact asset purpose, ownership, readiness, bytes/media and deletion before resolving a source key. Jobs streams through a service binding and repeats fencing/metadata checks before its receipt. `DRAFT_BUCKET` stays web-only. The default web HTTP route does not expose that entry. Production publication, consumer/binding/cron activation, editor activation, public serving and live-pointer/claim changes are absent.

### Evidence

- Local matrix covers small/mixed drafts, exact 1 MiB total content across three pages, long Unicode/descriptions, isolated surrogates, deep rich text, 3,000 components, both existing decorations, enabled/disabled Face Reveal, repeated gallery references and case-study images. Maximum image/PDF copies have exact byte/hash checks. The independent full renderer is an offline correctness oracle only.
- Failure checks cover duplicate delivery, stale/terminal leases, cross-candidate source tickets, wrong purpose, unreachable ready assets, readiness/size mismatch, persisted deletion, post-write replay, lost enqueue acknowledgement, sweep recovery, active/exhausted fourth attempts, source retention and cleanup isolation. A later draft revision cannot alter a sealed candidate. Actual owner removal permits candidate cleanup.
- The first full local gate passed 454 tests and all suites. The final focused batch-32 profile passed, including 11 integration groups. The [final full gate](evidence/verification-summary.json) passed all 13 commands, including 455 unit tests, every application build and all renderer/auth/persistence/upload/dispatch/draft/autosave/editor/runtime/routing suites. All heavy checks use `pnpm verify` and its shared lock.
- [Native complete matrix](evidence/native-batch32-results.json): 8/8/21/22/51/51 checkpoints, exact output and maximum private copies. [Repeat maximum provider CPU](evidence/native-repeat-max-cpu.json): 50 successful SEA invocations, median 27.128 ms, p95 71.704 ms, p99 149.963 ms. Native deployed Queue version `0b505d79-adfe-4ca2-8861-74258b6af585` predates the final stream/deletion/marker fixes; it cannot approve the final revision. [Initial execution](evidence/native-initial-small-cpu.json) and [small repeated batch-16 samples](evidence/native-repeat-small-batch16-cpu.json) remain separate evidence.
- [Deployed quota counters](evidence/provider-quota-results.json) cover 8/51/116 complete invocations, including the named source's D1/R2 counters. [Invocation boundaries](evidence/quota-invocation-boundaries.json) identify the instrumented version and outcomes. They are excluded from native CPU claims. [Local proof](evidence/local-batch32-results.json) additionally records large binary inventories, recovery and cleanup.
- [Shared ledger and limitations](costs.md): maximum batch-32 planning usage is 62,153 Worker invocations, 1,691,327 reads, 80,933 writes and 9,135 Queue operations/day with the requested replay/failed-candidate reserve and explicit shared forecasts. Dense usage is 25,349,423 reads and 15,813 Queue operations/day. Storage/admission/retention remain unresolved. No paid-plan assumption or content-limit reduction is made.

The [cleanup receipt](evidence/provider-cleanup.json) confirms deletion and subsequent HTTP 404 metadata checks for all eight owned resources. Cleanup required detaching the consumer and removing producer Workers before deleting their Queue.

Isolated resources used the `hasaweb-s8-f5419d` prefix and synthetic data only. All three buckets had managed public access disabled and no custom domains. Queue retention was 86,400 seconds, consistent with Free's fixed retention; subscription billing metadata was inaccessible, so account-plan proof remains incomplete. Native and quota deployments were separate. Source fixtures import the real boundary implementation, but do not measure full production OpenNext startup. Local heavy verification ran concurrently with the remote client, so client latency is not a CPU metric. Provider CPU, version, location and invocation boundaries are retained where available.

The [Unicode regression](evidence/unicode-regression.json) preserves the failing normalization and repair. Historical oversized three-page stress remains in the original S-8 record, separate from the valid total-1-MiB case. Restricted-sandbox verification-runner failures were rerun elevated and passed; none were waived. An automatic permission-review timeout on quota execution was retried once successfully. The first quota collector omitted R2 counter names; its incomplete run was discarded and the corrected complete run supplies the ledger.

### Separate boundary review

A separate final pass reviewed transfer authorization, revision races, lease fencing, retry recovery, deletion/cleanup and budgets. It found and repaired: later pages being skipped during assembly, SQLite lone-surrogate corruption, an active fourth claim being expired too early, owner-deletion cleanup guards, missing source-hop instrumentation, unbounded assembly stream waits and a valid attribute colliding with the controlled wrapper marker. Focused tests and the final full gate cover the repaired local behavior.

The review does not approve feasibility. Remaining blockers are the measured CPU failure, dense/gallery quota failures, final-version/native cold and authorization/sweeper evidence, source/tombstone storage retention and admission, full production source-module startup, and S-8-specific interrupted-stream/transient D1/R2 failure injections. Existing upload fault tests are not substitutes for those dispatcher tests. Production snapshot/manifest/style retention and future generated palettes also require measurement when integrated. S-9 browser/query-cache withdrawal remains a separate prerequisite.

### Concrete remediation and approval

1. Profile the repeated maximum invocation, including byte decoding, normalization, React serialization and bookkeeping. Redesign the batch/output strategy until complete native warm p95 is below 10 ms with demonstrated cold behavior. Increasing the batch from 16 to 32 saved messages but failed CPU.
2. Remove repeated dense JSON scans and reduce traversal/transfer wake overhead. Measure the resulting reads, writes, storage and CPU together; gallery and dense cases must have an explicit supported planning contract without shrinking the agreed content allowance.
3. Bound candidate admission and physical source/tombstone retention, retain sealed-source assets during GC, and verify deletion/late-write cleanup plus transient storage/stream faults. Reproduce the shared ledger, including actual sweeps and production start/poll/snapshot/manifest work.
4. Only after those gates pass, obtain explicit owner approval of the tested revision, integrate it into the shared base, rerun invalidated checks, and record approval/integration commits in Phase 24's audit. Material changes need renewed verification and approval. No Phase 24 implementation starts now.

### Documentation impact

The changed assumption is that reusable preparation/source-transfer code now exists, while feasibility and activation remain unapproved. Updated the roadmap dependency, implementation baseline, architecture, renderer/components/database/private-asset guidance and verification profiles. Downstream account deletion and GC must retain sealed candidate references and remove surviving cleanup state. Historical S-8/S-9 evidence and prior owner approvals remain intact. No roadmap completion checkbox was changed.

### October 25 continuation

The owner requested continued S-8 technical work in the existing clean worktree at `e9e3158`. Phase 24 remains blocked pending technical verification, explicit completion approval, integration and integration checks. The separate Phase 24 worktree is outside this task's write boundary.

Baseline claim to test: complete native invocations of `e9e3158`, at logical batch 32 with the actual renderer and synthetic maximum/dense/gallery inputs, either meet warm p95 below 10 ms or identify a reproducible failing boundary. Diagnostic profiling and quota counters are separate from native acceptance. Previous provider state and cleanup receipts are preserved.

The owner confirmed Workers Free for account `b6f9a87e6702c76c45a8d61744826e0f` on October 25. [Plan evidence](evidence/provider-plan-confirmation.json) separates that confirmation from inaccessible billing metadata. Fresh resources use `hasaweb-s8-d3c356`, with public bucket access disabled.

The exact `e9e3158` baseline completed [five maximum-content repetitions](evidence/native-e9e3158-five-results.json). [Per-candidate native CPU windows](evidence/native-e9e3158-five-cpu.json) report p95 49.047 ms in DEN, 31.655 ms in SJC, 54.001 and 54.490 ms in SEA, and 43.755 ms in DEN. Every repetition fails 10 ms; two windows contain 50 of 51 expected observations. All retained outcomes are successful with exact output. These repeats use 128-byte synthetic binaries. The earlier fresh baseline separately completed small/maximum/dense with full-size binaries before a gallery seed request timed out. Client transport failure is not a provider CPU-limit failure.

Production-mode diagnostic profiles identified hex decoding and duplicate text decoding as concrete application work. They include local workerd/D1 adapter overhead and are not native acceptance CPU. An explicit CTE-materialization experiment increased dense reads and was discarded. Current working changes use native hex conversion, adjacent bounded text windows, a single typed asset/page index, shared component/project entry rendering, reused sealed profile parts, grouped readiness scans, admission/retention and specific fault injection. Final local/native verification and the shared ledger remain pending. Runs interrupted by watched source edits or the old shared fixture-config path are diagnostic only. Each run now owns its configuration directory, and the client closes idle oracle-download connections.
