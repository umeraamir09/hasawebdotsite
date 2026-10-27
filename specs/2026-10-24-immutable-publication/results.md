# Phase 24 immutable publication

## October 27 implementation

### Scope and acceptance

Implement [Phase 24](../../docs/roadmap.md#phase-24-prepare-immutable-publication-versions) and [publication acceptance](../../docs/acceptance-criteria.md#15-subdomain-selection-and-publication). Prepare complete immutable candidates, public-only snapshots, retained renderer dependencies and manifests with resumable receipts. Preserve the live pointer and address namespace on every preparation outcome.

Prerequisites 02, 08, 11A, 16, 18 and 23 are owner-approved. PR #33 integrated the approved S-8 local milestone and paid-at-launch policy into shared `main` at `e3f313b`. The existing `feat/24-immutable-publication` worktree at `/home/umer/hasawebdotsite/.wrangler/worktrees/phase24` was fast-forwarded to that base before implementation. Its previous identical untracked audit was preserved at `/tmp/phase24-prerequisite-audit-20261027.md`. The clean prerequisite integration gate at `869aa40` is retained in the S-8 record. The final full gate checks the merged base and all changed contracts.

Write boundaries are candidate preparation and retention, the shared controller preparation adapter, static platform packaging, their fixture tests and affected guidance. No parallel workers were requested or delegated. Public pointer/claim commit, public serving, complete owner-flow activation and production configuration retain their later phases.

### Decisions

Use the existing fenced dispatcher and private-source transfer. Finalization runs bounded tasks within the transferring stage and writes candidate-scoped retained platform files, complete document shells, snapshot parts and a final manifest. Candidate scope makes failed-output cleanup independent of other candidates and retained live versions. No public route is enabled.

### Results

#### Capacity follow-up — October 27, 2026

The owner requested repair of the separate review's capacity finding. Work continues in `/home/umer/hasawebdotsite` on existing branch `phase-24-review-and-cleanup`, based on merged `90e7279`, preserving the review edits. No delegation was requested. Scope is admission accounting, its additive migration and combined retention/capacity fixtures; publication activation remains outside this change.

Migration `0012` introduces a pending-candidate membership table maintained by transactional triggers. Candidate insertion acquires a slot; a retained-version reference releases it; deleting a reference restores cleanup accounting, including owner cascades. The migration backfills existing unreferenced candidates. Admission counts only pending rows and limits source checks to their candidate IDs, so retained history does not grow those admission scans. The 128-slot limit still covers unfinished work, unreferenced ready candidates, failures and cleanup tombstones. Bulk reference removal can create more than 128 cleanup tickets and blocks admission until cleanup physically retires enough rows; it never discards those tickets.

The original row-count rule reproduced the reported HTTP 500 with 128 retained current portfolios. With the fix, all 43 publication groups passed across the full 15-case content matrix. Diff review then strengthened the fixture so the pending-row limit is tested with zero sources, and a separate race checks one source per portfolio below row capacity. The final focused run passed all 29 small-content/fault/retention/lifecycle groups and repeated lint, typechecks and all 458 unit tests. The persistence suite passed 85 checks plus the existing-database admission backfill assertions; Drizzle reported no schema drift.

All thirteen full-profile commands passed across locked runs `2026-10-27T11-53-16.305Z-4GC2Si`, `2026-10-27T12-02-24.188Z-t6EOxB` and `2026-10-27T12-19-17.758Z-8lT4xj`. The final focused receipt is `2026-10-27T12-12-28.015Z-EpqRJm`. The initial full run passed checks, all builds, renderer, authentication and persistence, then failed on a local Miniflare connection loss during upload fault injection. The resumed run passed uploads, the full publication matrix, draft API and autosave, then failed when ProxyWorker lost the editor address-save connection. Uploads and all 38 editor groups passed on their unchanged reruns; the remaining runtime/smoke/routing suites passed. No failure was waived. Only the capacity fixture assertions changed after the initial checks/build; the repeated checks and focused publication run cover that test-only refinement.

[Selected capacity proof](evidence/capacity-follow-up.json) retains the old-rule failure, all full-gate command outcomes, final source digests, content cases, capacity assertions and migration result. Normal diff review checked backfill, transactional release/reacquisition, deletion cascades, atomic admission and preservation of retention guards. The reported capacity finding is fixed and locally verified. The corrective migration/admission change is ready for follow-up boundary review; no independent re-review is claimed here. The prior owner approval remains recorded and the roadmap remains unchecked. Native paid capacity and S-9 withdrawal remain later gates.

#### Separate boundary review — October 27, 2026

Reviewed merged revision `90e7279` against Phase 24, AC 15, the candidate protocol and the Phase 23 validation boundary. The review traced revision/session admission, public snapshot projection, private asset tickets, mutable-fact sealing, retained-version guards, and failure cleanup. The existing full-gate evidence and candidate fixture were inspected; no application tests were rerun for this documentation-only review.

**Finding: retained versions consume the global 128-candidate admission limit.** `publicationTasks.create` counts every candidate row, including ready candidates referenced by retained `publish_version` rows. Migration 0011 and the sweeper deliberately prevent those candidates from being cleaned or expired while referenced. Thus 128 retained candidates alone prevent every portfolio from preparing another publication; transient candidates and tombstones can reach the limit sooner. The existing fixture separately proves the global cap and retained-candidate protection, but does not test their combined effect. Removing old superseded versions cannot solve the case of 128 current portfolios. Phase 25's version integration and the launch capacity model must resolve and verify this interaction before public activation; the current protocol's statement that a reference permits another candidate is conditional on global capacity. This is an unresolved boundary finding, so this review does not clear Phase 24 for roadmap checkoff.

October 27 follow-up: the capacity repair and verification above supersede this review's unresolved finding at `90e7279`. Its original scope and conclusion are preserved below.

The review found no other concrete defect in the inspected boundaries. Existing local failure fixtures support preservation of the prior pointer and claim, ticket denial, replay, cleanup and retained-reference protection; they do not establish native paid capacity or cache withdrawal. Phase 25 must still revalidate mutable commit facts and authorize serving against the active manifest, and S-9 remains a release/dependent-phase gate.

The local implementation and required full verification coverage are complete. The [retained verification record](evidence/local-verification.json) records all thirteen required commands, tested file digest, case manifests and operation counts. [Selected reproduction evidence](evidence/reproductions.json) preserves the finalization-order and relocated-config failures and the corrected privacy fixture. No failure was waived. The owner approved Phase 24 completion on October 27, 2026, after PR #34 merged to `main` at `90e7279`. The separate boundary review above identified an unresolved capacity interaction; Phase 24 remains unchecked.

- `publication-v1` captures the exact validated revision and excludes samples, hidden links, disabled Face assets, setup/progress, recipients and credentials. The shared controller flushes and remains paused through candidate admission; it reports `preparing`, never a live publication.
- Candidates now retain complete main/case-study/resume documents with the shared layout, `snapshot.json`, 404/robots/sitemap, selected platform dependencies and `manifest.json`. Bounded SQLite slices and streamed R2 assembly avoid whole-draft hot parsing. Every manifest file has a verified size/hash, with a separate manifest receipt. Platform packaging participates in the jobs build/cache output; its binding remains confined to the candidate fixture.
- Migration `0011` adds mutable-fact sealing and retained-version references. Ownership/readiness/type/size and address/recipient/GitHub facts are rechecked before readiness. References prevent cleanup/expiry/deletion, release private working source/facts for another candidate and keep source-asset retention. The pointer transaction must create its reference in Phase 25.
- Injected finalization writes, source truncation/interruption/timeout, R2 and checkpoint faults, stale leases, deletion and exhausted cleanup recover or retain retryable cleanup. The seeded previous version and claim survive preparation. Old-format cleanup remains supported.

#### Verification

The original locked full run at `.wrangler/verification/2026-10-27T08-46-32.354Z-o8GK3K/summary.json` passed checks, all application builds, renderer, auth, persistence and uploads before the new privacy fixture failed its schema. The only subsequent application-related change fixed that fixture to use the permitted single Projects component; the instrumented fixture/cost-helper corrections are covered by the repeated checks and publication suite. No shipped runtime source or build input changed after the passing build. The resumed locked run at `.wrangler/verification/2026-10-27T08-56-21.617Z-GkOJjq/summary.json` passed checks and every remaining full-profile suite. Together these prove all thirteen commands in the repository's full profile without repeating unaffected checks.

| Verification | Result |
| --- | --- |
| Lint, all package typechecks, unit tests | Passed, 458 tests in 41 files. Three existing editor CSS specificity warnings remain. |
| All application builds | Passed, including the retained platform package. Build scripts used dry-run packaging. |
| Renderer | 27 browser groups passed. |
| Authentication | 30 API/security checks and 19 browser journeys passed with provider fixtures. |
| Persistence/migrations | 85 checks passed, including restart persistence. Drizzle reports no schema drift. |
| Private uploads | 11 groups passed with actual D1/R2 and browser transport. |
| Candidate preparation | 41 groups across 15 content cases passed. Includes a 1,048,576-byte draft, 3,000 components, Unicode/surrogate boundaries, deep lists, descriptions, both decorations, samples/private recipients, Face Reveal and full 5 MiB image/10 MiB PDF copies. |
| Draft API | 17 production API groups passed. |
| Autosave/recovery | 49 browser checks passed, with no reported browser errors. |
| Editor | 38 browser groups passed, with no reported browser errors. |
| Runtime and routing | Worker/binding/restart tests, correctness smoke and 31 host/path/method boundaries passed. |

The maximum draft completed in 97 dispatch checkpoints; the dense case needed 141. The measured successful parent-invocation maximum was 40 D1/R2/Queue/source/platform calls. These are local operation counts, not provider CPU measurements. Platform hashes and CSS dependency reachability were checked independently for all five packaged files, totaling 766,135 bytes. The budget helper now avoids adding the previously forecast delivery work a second time to complete-candidate measurements. Its historical Free comparisons are not local blockers or a paid launch budget result.

Normal diff review, changed file/anchor links and migration SQL/snapshot alignment were checked. The final documentation profile passed at `.wrangler/verification/2026-10-27T11-11-24.200Z-L10hSS/summary.json`; untracked files also passed explicit whitespace checks. The final port inspection found no listening verification processes on the suite port ranges. Routine success/failure logs, screenshots, scratch state and full manifests remain ignored; selected proof is retained above. The normal diff review does not substitute for the required separate high-risk review.

#### Remaining blockers and integration boundaries

1. The retained-candidate capacity finding is fixed and locally verified in the follow-up above. The corrective migration/admission boundary is ready for follow-up review. Phase 23's existing owner approval remains intact.
2. Record the review disposition of the corrective change before Phase 24 checkoff. Owner completion approval is recorded above and PR #34 is integrated into `main` at `90e7279`.
3. Phase 25 supplies atomic pointer/claim commit and manifest-authorized serving. Phase 26 supplies the admission operation, progress/retry and Open/Copy integration. Complete guide/editor activation remains later work. The current PDF/additional-page/appearance representations do not claim those later capabilities are complete.
4. Before release, run native Workers Paid CPU/operation/storage/cost acceptance and S-9 browser/query/edge withdrawal verification under the approved paid-at-launch policy. No subscription purchase, deployment, native provider CPU run or public activation occurred here.

### Documentation impact

The changed assumption is that the dormant dispatcher prepares complete candidates rather than scaffold fragments alone. Updated the baseline, architecture, roadmap record link, verification profile/map, renderer/database/controller contracts and the lasting [candidate protocol](protocol.md). Added a dated S-8 protocol supersession note and preserved all earlier failures and approvals. The cost helper distinguishes measured complete delivery from historical forecasts. The capacity follow-up separates pending admission from retained storage and updates the database contract, candidate protocol, baseline, roadmap and cost-helper guidance, with dated S-8 supersession notes. Retained references release slots; deleting references restores cleanup debt. The repair is locally verified, its follow-up review is pending, and Phase 25–26 activation and paid/S-9 gates remain unresolved.


## Local-development decision before PR #33, October 27, 2026

October 27 supersession note: PR #33 is now integrated at `e3f313b`. The pending-integration statements in this historical decision record no longer block implementation. See the implementation record above. The paid-at-launch policy remains current.

The owner chose Workers Paid, currently a $5/month minimum, only at launch and explicitly authorized removing Free-budget blockers so implementation can continue. The [deployment policy](../../docs/deployment-policy.md) is the current budget/start/release contract. The original blocked audit below is preserved history, not a current instruction to wait for a Free-plan CPU pass or an early subscription purchase.

The owner-authorized **S-8 local development milestone** uses tested runtime `5b796accfac88bf40b2875e606b79c52192a3e16`, with [local/native correctness and failure evidence](../2026-10-24-s8-dispatch-feasibility/results.md). The local PR candidate integrated the scaffold and policy at `5e81f2b`. Follow-up `869aa40` excludes generated `.wrangler` state and nested worktrees from unit-test discovery. This Phase 24 worktree was synchronized locally to that candidate, preserving its existing audit. On the owner's subsequent instruction, local `main` was restored to `5564c31`; no main push occurred. All session changes are proposed on `docs/paid-launch-policy` for PR review, not directly on main. No parallel delegation was requested or used.

The [full local integration gate](../2026-10-24-s8-dispatch-feasibility/evidence/integration-869aa40.json) passed all 13 commands on clean `869aa40`, including 456 unit tests and 32 S-8 groups. The first root run discovered other worktrees' tests and failed; `869aa40` fixes test discovery, and no failure was waived. The owner-approved local start milestone is technically verified but shared-base integration is pending this PR's merge. Do not start dependent Phase 24 application changes before that merge and any checks invalidated by it. The remaining blocker is PR integration, not Free-plan feasibility or buying the plan now. Free-only quota/CPU/storage fit and buying Workers Paid now are no longer local start dependencies. Paid-provider performance/cost/retention and actual deployment checks are launch gates. S-9 remains a real withdrawal/privacy requirement in its dependent phases. This record does not check Phase 24 complete or approve public activation.

### Local implementation plan

1. Reuse the integrated immutable revision capture, `s8-v3` renderer preparation, fenced Queue/D1 tasks, streamed assembly and named web private-source transfer. Preserve the web-only draft bucket, prior version and permanent claim behavior.
2. Build a private candidate snapshot from included public content. Exclude setup/progress, samples, disabled Face assets, private recipients and provider credentials. Revalidate mutable ownership/readiness/consent and retain the exact controller-confirmed revision; incomplete local saves/uploads cannot report publication success.
3. Retain complete main/case-study/resume documents, trusted shells, sanitized snapshots and manifests. Promote only required content-hashed CSS/JS/fonts/approved art; exclude raw regeneration inputs and reference portraits. Record sizes/hashes and resumable receipts. No live-pointer update in Phase 24.
4. Add failure/retry/deletion/cleanup proof for these new outputs and protect sealed/current/retained references. Exercise maximum/dense/Unicode/decorations/Face and full authorized byte copies against the actual shared renderer.
5. Run the applicable full local gate and separate publication/privacy/recovery boundary review. Present Phase 24 completion for explicit owner approval. Continue dependent phases after their code dependencies are integrated; at launch preparation upgrade and execute the paid-provider/release gates before public access.

### Documentation impact of the owner decision

The hosting target and verification timing changed. The shared roadmap, architecture, baseline, workflow, product/onboarding/acceptance guidance, S-8 contract/cost record and subsystem READMEs now link the paid-at-launch policy. This audit records the corresponding start milestone and preserves the old unmet-prerequisite evidence. Owner-facing content, account privacy, atomic publication, withdrawal and phase completion criteria remain unchanged.

## Historical October 24 prerequisite audit

The sections below describe `main` at `5564c31` before the S-8 follow-up and October 27 decision. Their absent-code and Free-budget blockers are superseded by the integration and current policy above. Original findings, failed measurements and earlier approvals are retained.

### Scope and acceptance

Requested work is [Phase 24](../../docs/roadmap.md#phase-24-prepare-immutable-publication-versions). Its completion requires a revision-bound immutable candidate with a complete manifest, no live-pointer change, and injected-failure evidence that the prior version survives and uncommitted public assets are cleaned. Relevant product checks are [AC 15](../../docs/acceptance-criteria.md#15-subdomain-selection-and-publication), especially saved-draft isolation and publication-failure preservation. The [renderer contract](../../packages/render/README.md) requires bounded preparation, Unicode-safe partitioning and wrapper-preserving assembly without dropping owner content.

Shared base is `main` at `5564c317396a70d9d9fbb1e382520e87b80f4fe9`, which includes the Phase 23 PR #32 merge. Branch is `feat/24-immutable-publication`; worktree is `/home/umer/hasawebdotsite/.wrangler/worktrees/phase24`. Existing worktrees were inspected before creating this one. No parallel implementation was requested or delegated. This audit writes only this phase record. Application, schema, renderer and runtime changes have not started.

#### Prerequisite findings

The [roadmap](../../docs/roadmap.md#how-to-complete-a-phase) makes dependencies start requirements. [AGENTS.md](../../AGENTS.md#parallel-work-and-approval) says, "Start work only after the owner approves its prerequisites and their code is integrated into the shared base."

| Dependency | Finding at the shared base |
| --- | --- |
| 02 | Checked and owner-approved October 15, under the recorded revised bounded-rendering approach. This does not prove final dispatcher CPU feasibility. |
| 08 | Checked and owner-approved October 15, with the Queue/D1 fallback and cache requirements explicitly outstanding. Approval covers the experiment and recorded fallback requirement. |
| 11A | Checked and owner-approved October 16. Use the bounded-save follow-up, not the failed whole-body 1 MiB path. |
| 16 | Checked and owner-approved October 19 after the renderer repairs. Production partitioning and measured dispatch remain Phase 24 work. |
| 18 | Checked and owner-approved October 22. Private uploads are implemented; jobs source-asset transfer remains separate. |
| 23 | Checked and owner-approved October 24; merged in the current shared base. Its recorded separate publication-boundary review remains pending. |
| Measured S-8 Queue/D1 fallback | **Unmet start prerequisite.** Current guidance and historical evidence explicitly identify this as unvalidated. No measured fallback or corresponding owner-approved milestone was found in the shared base. |
| S-9 browser/query-cache requirements | Reviewed. The recorded browser TTL and warmed-query purge gaps remain unresolved. Verification is required before dependent withdrawal/public-serving behavior; it is not treated here as an additional unconditional Phase 24 start dependency. |

### Decisions

Do not start the Phase 24 pipeline while the measured-dispatch prerequisite is unmet. Preserve the checked historical phases and owner approvals. A local runtime smoke test, the existing Workflow probe, or the offline full-document renderer cannot establish the missing feasibility result.

The [S-8/S-9 results](../2026-10-15-workflow-assets/results.md) rejected unbatched Workflows. The historical daily model records 4,230 steps for 30 near-limit single-page publications before preparation/cleanup. Its naive per-step Queue replacement records 12,690 Queue operations before retries and shared contact/GitHub work. These are the existing experiment's findings, not new measurements or a refreshed provider-limit claim. The larger three-page deployed stress experiment also failed with `Too many API requests by single Worker invocation`; its deliberately oversized combined draft is not evidence that every valid 1 MiB draft fails.

The [architecture publication contract](../../docs/architecture.md#83-publish-product-15-the-core-flow) requires measured Queue/D1 batching before production task implementation. The runtime inspection confirms that `apps/jobs/src/index.ts` still contains local-only Queue/Workflow probes. Jobs has site/public asset bindings but no private draft bucket binding; `apps/web/wrangler.jsonc` owns `DRAFT_BUCKET`. Adding direct jobs access would change the existing private-storage boundary and cannot substitute for specifying and measuring an authorized transfer.

### Results

Status on October 24, 2026: **blocked before implementation; Phase 24 is incomplete**. Created the requested isolated branch/worktree and completed the prerequisite audit. No publication implementation, new dispatcher measurements, provider configuration changes or roadmap checkoff were made.

### Verification

- Compared every named dependency against the current roadmap approvals and implementation baseline. Confirmed the shared base is the Phase 23 merge and inspected the current jobs runtime and web/jobs bucket bindings.
- Read the existing acceptance requirements, workflow, renderer boundary and S-8/S-9 evidence. Searched affected current guidance and downstream references for dispatcher, Queue/D1 and withdrawal requirements. They consistently retain the missing feasibility prerequisite.
- `pnpm verify --profile=docs` passed on base `5564c31` with this audit record untracked. Its ignored receipt is `.wrangler/verification/2026-10-24T13-32-19.155Z-SBDzzG/summary.json`. Selected the docs profile because this change contains only the audit record. The pnpm launcher reported a sandbox-denied dependency/store lock attempt before running the dependency-free verification script successfully; this provides no dependency-install or application-check result. Relative file/anchor links and the new-file diff were checked separately, including `git diff --no-index --check /dev/null specs/2026-10-24-immutable-publication/results.md`, because `git diff --check HEAD` does not inspect untracked file contents. Subsequent edits only corrected this record's link and verification details.
- Application builds, browser suites, failure-injection tests and CPU/quota benchmarks were not run. No application code changed, and those checks would not supply the missing final-dispatch measurements.

### Remaining blockers and next work

1. Resolve the S-8 fallback as a prerequisite measurement task using the real shared renderer. Cover bounded validation/snapshot preparation, valid maximum drafts and oversized/nested/Unicode units, actual invocation CPU and API calls, replay-safe D1 task state, leases/lost triggers, bounded batching, retries, assembly, cleanup and source-asset transfer. Include shared save/contact/GitHub costs in the request, D1, R2, Queue and CPU model. Preserve existing failed evidence. A batch size chosen solely from local elapsed timers does not satisfy this requirement.
2. Obtain explicit owner approval of the verified prerequisite or a specifically named reusable milestone, and integrate it into the shared base before starting the pipeline. No approval of that missing result is inferred from approval of Phase 08 or the request to implement Phase 24.
3. Then implement the remaining Phase 24 acceptance scope, including exact controller-confirmed revision capture, pending/local-only input handling, mutable-fact revalidation, display-only snapshots, reachable assets and retained content-hashed platform assets, resumable partitioning/assembly, complete manifests and failure cleanup without changing the live pointer. Shared runtime/contracts require the full local verification profile and a separate boundary review before completion review.
4. Before dependent withdrawal/public serving, correct and verify the S-9 browser/query/edge-cache policy. Existing metadata and accepted purge requests do not prove observed withdrawal. The pending Phase 23 publication-boundary review is also retained as outstanding review work, without revoking its owner-approved completion.

There is no Phase 24 completion approval to request while its implementation and prerequisite measurements remain absent.

### Documentation impact

No production assumption changed. Current baseline, architecture, onboarding and renderer guidance already describe the unvalidated fallback and private source-transfer boundary correctly, so they need no contract updates. This record documents the unmet start prerequisite and preserves the historical approvals, measurements and separate review/cache requirements. No unrelated documentation changes are included.
