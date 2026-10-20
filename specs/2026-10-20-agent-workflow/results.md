# Agent workflow overhaul

## Scope and acceptance

Implement the owner's reviewed workflow plan on `chore/agent-workflow`, based on `0f009e7`. One implementation owner edits workflow guidance, roadmap dependencies and local verification tooling. No application feature, deployment or roadmap checkbox is authorized as complete by this work.

Acceptance requires concise phase records, targeted reading/documentation checks, two isolated implementation workers, explicit dependencies for every remaining phase, local named check profiles with affected builds, safe evidence defaults and a shared heavy-verification lock. The owner's follow-up adds coordinator-led subagents alongside separate owner-led chats. Keep code CI conservative. Preserve historical evidence and technical/product acceptance requirements.

## Decisions

The owner chose documentation plus small tools, risk-based checks, separate owner-led chats, two implementation chats by default, mandatory local verification and selective committed proof. Whole phases remain the normal approval unit. Explicit reusable-milestone approval is allowed only when it unblocks actual downstream work. Dependencies must be approved and integrated before consumption.

The October 20 review narrowed the original plan: automatic changed-file selection and broader CI restructuring are deferred. Build affected applications; shared contracts, dependencies/runtime/toolchain changes and uncertain impact require full builds. No fixed speedup is promised. Existing code CI suites remain; their runtime measurement step becomes a correctness smoke run, while explicit profiling remains available.

The owner subsequently requested a second supported mode: a single instruction such as "Implement phases 17 and 18 in parallel" authorizes the lead chat to delegate the named work to subagents. Separate owner-led chats remain the default. Both modes use two implementation workers, isolated worktrees, one heavy local gate and the same explicit prerequisite/completion approvals. This extends the original owner-led choice without approving any implementation phase or authorizing new sidebar chats.

## Dependency audit

Every pending phase from 17 through 54, including 22A and 42A–42F, now states start dependencies. Later integration prerequisites are separate where they permit useful earlier implementation. Existing completion checks and approved phase history remain intact. No new milestone is approved by this record.

| Phases | Changed assumption and handling |
| --- | --- |
| 17–20, 22–26 | Retain real editor/upload/setup/publication prerequisites and measured feasibility gates. 17/18 can be the first pair after checking write boundaries. |
| 21 | Public link records and deliberate account-email acceptance do not depend on Phase 20 photo-import controls. Reuse the authenticated owner boundary. |
| 27 | Draft component ordering/registry/removal does not require publication 23–26. Keep future validation hooks and private-grant removal integration in 41. |
| 28–34 | Add missing rich-text, entry-control, link and PDF dependencies. Controls can precede publication; work-description entry does not require the general rich-text editor. Real published parity, validation, atomic page/asset changes and withdrawal remain completion prerequisites. |
| 35–38 | Preset controls can start on the existing renderer/catalog/editor; pure palette generation can start from 11E/16 before preset UI. Full additional-page/CSP/manifest/withdrawal integration stays required. An explicitly approved reusable boundary may unblock a real consumer without approving its parent phase. |
| 39–42 | Private full-page preview depends on actual page/interaction services. Public graph service/setup can start before public serving, but published configuration, private consent, cleanup, generations and refresh still require real integration. |
| 42A–42D | Default styles are already available, so Phase 35 appearance controls do not block Address/shell work. Profile/Links and optional adapters depend on their actual shared capabilities. Required navigation and optional-skip behavior are preserved. |
| 42E–42F | Preserve complete guide/routing activation and journey verification. Explicitly add real preview/contact services 39/45 as later integration prerequisites because the existing 42E scope requires replacing unavailable adapters. This resolves an omitted dependency rather than claiming those services already exist. |
| 43–45 | Email services can start from existing provider/auth/storage foundations. Owner settings, publication blockers, public acceptance, atomic outbox budgets and preview suppression retain explicit integration checks. |
| 46–49 | Metadata derivation/controls can use existing draft fields before profile UI and page publication. Add previously implicit dependencies for real page removal, live-endpoint withdrawal and account-scoped cleanup. Preserve consent cleanup, session denial and permanent reservations. |
| 50–54 | Discovery layout may precede the completed example/journey. Operator work, delivery, complete acceptance and launch retain real cross-feature prerequisites. |

## Results

Implemented October 20, 2026 on `chore/agent-workflow`, based on `0f009e76a5e6f2516c0722c0dfcf2f1392e3b675` plus this working diff. Owner completion approval is pending. No numbered phase checkbox changed. Initial verification preceded commits or PR publication; the owner subsequently requested committing this branch and opening a PR. That request does not approve phase completion. No deployment, feature activation or Figma edit occurred.

The complete local gate `npm exec --yes --package=pnpm@12.11.2 -- pnpm verify --profile=full` passed all ten commands. Routine logs and suite proof are ignored under `.wrangler/verification/2026-10-20T13-05-18.827Z-1BAcX2/`; its summary records command status, duration, source revision and working-change hashes. Only guidance/result text changed between that initial gate and the first PR commit. The later auth harness repair has its own verification below.

- Lint, all twelve typecheck tasks, 347 tests across 29 files and all twelve production build tasks pass. The seven new runner tests exercise dry-run behavior, invalid profile/build requests, failure propagation, sequential execution in two real temporary Git worktrees, detached-descendant interruption cleanup, source-state recording and unique evidence/override behavior.
- Renderer passes 27 browser groups. Auth passes 30 fixture groups and 16 browser journeys. Persistence passes 73 access/migration/restart checks. Draft API passes 15 groups. Autosave passes 45 browser groups and its two session/API prechecks.
- Combined runtime verifies all three Workers, D1/R2, service bindings, Queue/Workflow and restart persistence. Runtime smoke passes six cases plus the retained rejection, isolation, cached-session, deletion and D1-failure assertions. The rejection/isolation assertion block is byte-identical to the original benchmark. The smoke report contains no cold/warm samples or CPU profiles; it proves no production CPU/capacity claim. Explicit benchmark sampling counts remain unchanged; a new performance measurement was not needed or claimed.
- Routing passes 31 local host/path/method boundaries. A separate docs profile and final diff-hygiene check pass. All 178 checked local guidance links/anchors resolve; all 45 pending phases have explicit dependencies without cycles, and original completion checks/checkboxes match the base verbatim.

The root verification command defaults to full checks, exposes manual profiles/affected builds and serializes heavy runs with Linux/WSL flock. Standalone local harnesses default to unique ignored evidence paths while preserving explicit overrides and existing remote measurement paths. SIGINT/SIGTERM cleanup is tested; SIGKILL/machine crashes cannot perform cleanup. Native Windows locking is not implemented.

The WSL default pnpm resolves to an incomplete Windows installation; the documented Linux npm runner works with pinned pnpm 12.11.2. No dependency versions or lockfile changed. Existing code CI suites and the required foundation job remain, with runtime profiling replaced by correctness smoke mode. Remote CI had not run at initial verification; the subsequent CI failure and repair are recorded below. Automatic selection and broader CI changes remain deferred.

The mandatory phase record is reduced from three separate preimplementation files plus a later result to one evolving record. No search receipt or routine committed screenshot/log is required. Historical spec files remain unchanged. Actual end-to-end implementation throughput has not been benchmarked; these structural reductions do not establish a numerical speedup.

### Coordinator-led mode follow-up

Documented the explicitly requested mode in AGENTS, the workflow guide and the roadmap. The lead supplies worker context and exact worktree paths, coordinates shared contracts, serializes verification/integration and presents per-phase results for owner approval. Existing subagent model preferences apply. No coordinator ledger, new sidebar chats or additional approval stages are required. This is documentation only; no phase workers were started. The docs verification profile passes, all 53 local links/anchors in the four follow-up documents resolve, and the final diff passes whitespace checks. At that documentation-only follow-up, application/tooling code was unchanged and the existing local gate remained applicable; the later harness repair is verified separately below.

### CI authentication cancellation repair

The first PR CI run at `b7b2d9c` failed in the auth browser harness after fixture/cookie checks with CDP `-32602 Invalid InterceptionId`. See [failed CI run](https://github.com/umeraamir09/hasawebdotsite/actions/runs/39434112218). Lint, typechecks/unit tests, builds and renderer verification had passed. The runtime smoke step had not been reached.

A controlled local Chromium reproduction paused a fetch, aborted it with AbortController and then attempted late fulfillment. Chromium emitted matching `Network.loadingFailed` with `canceled: true` and `net::ERR_ABORTED`; fulfilling the retired interception reproduced the exact CI error. The existing async auth proxy assumed paused requests remained live across awaited HTTP/cookie work. Navigation or application abort can invalidate that assumption. The earlier passing local run did not establish freedom from this race.

The first local repair relied only on correlated Network cancellation and failed on a retired `POST /api/owner/draft/pending` with no matching cancellation event. That failing run is retained under `.wrangler/verification/2026-10-20T14-10-11.136Z-I9ZH6e/`. Network notifications alone do not establish the lifetime of every paused interception.

The harness now tracks real paused Fetch requests and permits at most one fulfillment per ID. Observed cancellation retires the response before sending it; Chromium's exact `-32602 Invalid InterceptionId` response retires a known request if its cancellation event did not reach this session. Unknown IDs, duplicate fulfillment and other protocol/proxy errors still fail. Each retirement reason is recorded with the request measurement. Active state is removed after completion, and error diagnostics identify method/host/path without OAuth query values. No product authentication, ownership or recovery handler changes.

A browser regression holds a synthetic subrequest, explicitly aborts it, observes Chromium cancellation, releases its response and verifies the active page remains usable and checks that a retired/unknown ID cannot be fulfilled again. Local repair validation passes lint, all twelve typechecks, 347 unit tests, affected web/jobs builds, 30 auth fixture groups and 17 browser journeys. Output is under `.wrangler/verification/2026-10-20T14-14-04.140Z-OgBD1e/`. Further verification and current remote CI status are tracked in [PR 23](https://github.com/umeraamir09/hasawebdotsite/pull/23).

## Documentation impact

The changed assumptions are total phase ordering, three mandatory preimplementation spec files, broad repeated documentation searches, historical phase plans as reusable process, routine committed evidence, and runtime profiling in regression CI. Current guidance is updated in AGENTS, README, implementation status, roadmap, architecture testing guidance, onboarding, authentication and the renderer package README. The new workflow owns process; existing technical contracts retain authority over their subsystem. Historical specs/evidence remain unchanged.

The coordinator follow-up changes the assumption that all parallel work must be started and coordinated through separate owner-led chats. AGENTS, the workflow guide and roadmap now describe both modes consistently; the roadmap's 45 dependency entries, completion criteria and checkboxes remain unchanged. Subagent messaging inside an explicitly delegated task is distinguished from unsolicited messages to owner-led chats. Existing verification, isolation, model preferences and owner-approval boundaries still apply.

Dependent scopes are updated across all pending phases as described above. Product/acceptance behavior, provider limits, recovery/privacy rules, publication feasibility and release matrix remain requirements. S-8 dispatch, S-9 withdrawal, owner-flow CPU feasibility, real asset transfer and all unimplemented integrations remain unresolved prerequisites. The workflow is implemented and locally verified; owner completion approval remains pending. Current guidance and affected package instructions were checked for superseded process/evidence defaults, changed links and downstream prerequisites. No known current contradiction remains. Product/acceptance documents stay unchanged because no required behavior was removed or weakened.

The CI repair changes the harness assumption that an interception survives browser cancellation. Authentication verification guidance and this result record are updated. Existing phase dependencies, product/acceptance behavior, provider fixtures and release matrix remain accurate. Phases 17, 42F and 53 consume the repaired auth harness without acquiring extra product requirements. No documentation cleanup is deferred.
