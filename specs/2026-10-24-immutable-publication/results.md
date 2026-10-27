# Phase 24 immutable publication prerequisite audit

## Current local-development decision, October 27, 2026

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
