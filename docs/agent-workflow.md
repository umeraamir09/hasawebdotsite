# Agent workflow

Budget decision, October 27, 2026: apply the [paid-at-launch policy](deployment-policy.md). The owner authorized local S-8 reuse and removal of Free-only development blockers. Integrate the named milestone and check affected code before consumers start. Paid account activation and native paid verification belong to launch preparation; do not require a subscription during local work. All other dependency, completion-approval and privacy rules below remain in force.

Updated October 20, 2026 after the owner's workflow review. This is current process guidance. The roadmap owns dependencies and approvals, product/acceptance documents own behavior, and architecture/package contracts own technical decisions. Historical specs retain evidence, not authority over how every future task must be run.

## Start and record the work

Read the implementation baseline, the phase entry, and the affected acceptance criteria and subsystem contracts. Follow historical links only when a constraint or decision needs its original evidence. Do not load every spec before each task.

Create one `specs/YYYY-MM-DD-feature-name/results.md` before phase implementation. Use the headings below and fill results as work proceeds. A small follow-up updates the existing record. No separate requirements, plan, acceptance, decision TSV or search receipt is required by default.

```markdown
# Phase or task name

## Scope and acceptance
Link existing requirements. State the intended change and acceptance checks.
List approved prerequisites, the shared base, branch/worktree and write boundaries.

## Decisions
Record material departures and interface changes only, if any.

## Results
Record the local checks, tested revision/working changes, important proof,
limitations and remaining integration work. State approval separately.

## Documentation impact
Record changed assumptions, affected guidance and unresolved prerequisites.
If none changed, explain that in one sentence.
```

Add a separate protocol only for a lasting technical contract that readers need, such as recovery, publication dispatch or a provider measurement method. Requirements already defined elsewhere should be linked. Preserve earlier evidence and approval records; do not migrate old specs merely to match this format.

A documentation impact check follows affected assumptions and downstream consumers. Search once, fix contradictions, check changed links and inspect the final diff. Repeat only when further changes invalidate the check. Historical experimental evidence does not need rewriting to reflect later outcomes.

## Parallel implementation and integration

Two modes are supported:

- **Separate owner-led chats.** The owner starts each phase chat and supplies the other active phases and their write boundaries. This remains the default when no coordination mode is requested. Branch names alone do not reliably describe another chat's active work.
- **One coordinator with subagents.** The owner gives one chat a request such as "Implement phases 17 and 18 in parallel". That explicitly authorizes the lead to delegate the named work to subagents. The owner follows the lead chat; the lead supplies coordination context to each worker. Use subagents for this work. Do not create separate sidebar chats unless the owner explicitly requests them.

Default to two implementation workers for the current four-core environment. The coordinator is additional to those workers, but the shared heavy-verification limit stays one. In either mode, each implementation worker uses an isolated worktree and branch. Inspect `git worktree list --porcelain` before starting and compare intended write boundaries with other active work. A worktree isolates files, but not shared interfaces or local ports.

For coordinator-led work, the lead:

1. Checks approved prerequisites and real independence. If a shared contract must land first, sequences that part and explains the limit on parallelism.
2. Creates separate worktrees from the approved shared base and passes each subagent its exact worktree path, branch, scope, acceptance references, write boundaries and the other worker's responsibilities. Use the configured subagent model/reasoning preferences. Workers run commands in their assigned worktrees and do not switch the coordinator's checkout. Uncommitted changes are not automatically present in another worktree.
3. Coordinates overlapping interfaces, monitors progress and resolves integration conflicts. Workers update their own phase records; the lead does not require another coordination ledger or duplicate their results.
4. Serializes heavy checks through `pnpm verify`, obtains the required reviews and integrates branches sequentially. Repeats checks invalidated by integration.
5. Presents results for each named phase and asks for explicit owner completion approval. Delegation and successful tests do not authorize roadmap checkoff, dependent work before approval, deployment or feature activation.

One owner implements overlapping code or interface changes. Integrate that prerequisite first and obtain owner approval before consumers depend on it. Independent branches may each update affected shared guidance; reconcile those edits during sequential integration. Keep dependency contracts in source/package guidance rather than a separate registry. Resolve documentation conflicts in the same change and rerun checks invalidated by integration. Coordinator-to-subagent task messages are part of the authorized delegation. Do not create a scheduler, shared activity ledger or unsolicited messaging between owner-led chats.

Roadmap entries distinguish dependencies needed to start from later integration checks. A consumer can use an incomplete prerequisite only through a specifically named, verified milestone that the owner explicitly approves and that is integrated into the shared base. Ask for a milestone only when another task is ready to use it. Approval of a plan authorizes its work but does not approve implementation completion. Full phase checkboxes still require all completion checks and explicit owner approval.

Phases 17 and 18 are the first candidate pair. Check their actual write boundaries before running them together. Other possible pairs follow the roadmap, rather than phase number order. Keep mandatory guide activation, privacy, recovery, publication and runtime feasibility gates intact.

## Choose local checks

During coding, run the smallest checks that answer the current question. At completion, select a named profile and state why it covers the change. Profiles are manual choices, not automatic changed-file inference. Unknown impact selects `full`.

| Profile | Local commands and intended use |
| --- | --- |
| `docs` | `git diff --check HEAD`; manually check changed links and guidance. Documentation-only work. |
| `checks` | `pnpm check`; tooling/test changes with no shipped bundle impact. Run their focused behavior tests too. |
| `renderer` | Check, web/jobs builds, renderer and editor browser suites. Markup, preview bridge, styles and interaction. |
| `editor` | Check, web/jobs builds and editor browser suite. Editor fields, recovery adapters and private live preview. |
| `drafts` | Check, web/jobs builds, draft API, autosave and editor browser suites. Draft/recovery integration. |
| `auth` | Check, web/jobs builds, auth browser, draft API, autosave and editor suites. Owner/session boundaries. |
| `persistence` | Check, all application builds and persistence suite. Add draft/auth suites when their contracts change; shared schema/migrations select full. |
| `publication` | Check, all builds and inactive S-8 renderer/dispatch/private-transfer fixtures. This does not certify deployed CPU or unblock Phase 24. `S8_EVIDENCE` selects retained reproduction output. |
| `uploads` | Check, all application builds and private upload HTTP/browser suite. Upload framing, private R2 reads and lifecycle failures. Shared storage/auth contract changes still select full. |
| `runtime` / `full` | Check, all builds and every existing foundation regression suite, including runtime smoke and routing. Infrastructure, shared contracts, dependencies, uncertain impact. |

Examples:

```sh
pnpm verify --profile=renderer --dry-run
pnpm verify --profile=renderer --build=web,site
pnpm verify --profile=drafts
pnpm verify --profile=full
pnpm verify --profile=checks
```

`--build=web,site,jobs` selects affected application builds for ordinary profiles. Include every consuming application; a schema, public contract, dependency or toolchain change requires `full`. Full/runtime profiles always build all applications. Test/tooling-only changes can use `checks`; documentation-only changes use `docs`. Existing individual commands remain available for focused work.

A local gate is mandatory before completion review. Passing CI is additional evidence. Repeat a gate only when relevant source, contracts, build inputs, environment or integration changed. A later documentation-only edit does not invalidate a passing application gate. Review ordinary changes through the diff. High-risk changes need a separate review of concrete access, race, failure, recovery, migration, withdrawal or budget behavior. Request that review through an authorized chat; do not automatically create chats or subagents.

The confirmed browser/viewport and provider matrix in architecture section 13 remains the release requirement. Incremental checks cover affected behavior, including keyboard/focus, responsive layouts and failures where relevant. Existing Phase 53/54 acceptance and usability checks remain required. New hot handlers and changed performance boundaries still need their documented measurements.

## Resource lock and evidence

The runner uses Linux/WSL `flock` and one user-level lock under `$XDG_CACHE_HOME/hasaweb/verification.lock`, defaulting to `~/.cache/hasaweb/verification.lock`. Separate worktrees and clones share it. Heavy gate commands wait with a visible message. SIGINT/SIGTERM interruption stops the runner's own process tree before releasing the lock. SIGKILL or a machine crash cannot run cleanup; inspect leftover processes before starting another heavy run. Do not delete the lock file to force concurrency. Coding and reading may continue in the other chat. Use the runner for complete gates; schedule individual heavy commands so they do not overlap another gate. Native Windows locking is not implemented; use WSL.

The runner writes a unique `.wrangler/verification/<run>/summary.json`, command logs and suite evidence, including command results, duration, source revision, working-tree state and selected builds. It preserves explicit harness evidence overrides. Standalone local auth, draft, bounded-save, owner-runtime and renderer verification also default to unique ignored evidence directories. Explicit overrides may retain selected proof in a new spec. Do not overwrite historical receipts.

Commit concise results and selected proof needed to reproduce consequential defects or decisions. Keep ordinary successful logs/screenshots ignored locally or in CI artifacts. Important proof must not depend solely on expiring CI artifacts. Never commit credentials or session cookies. Preserve all existing historical evidence.

`pnpm test:runtime:smoke` exercises the former runtime benchmark's correctness checks without cold/warm sample loops or V8 profiling. `pnpm spike:runtime` retains explicit measurement mode. Smoke results make no CPU or capacity claim. Keep performance measurements separate from concurrent heavy local work.

## CI and future improvements

The existing foundation CI remains the code regression gate. Its runtime benchmark step uses correctness smoke mode; measurement remains explicit. Automatic test selection, documentation-only CI routing, remote build caching and broader CI restructuring are deferred until actual use identifies a worthwhile improvement. Preserve the existing required check name when later changing CI routing.

Evaluate this workflow through actual phase work. Record observed friction before adding automation. No fixed speedup is claimed, and no extra recurring measurement ledger is required.
