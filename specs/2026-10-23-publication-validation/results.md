# Phase 23. Publication validation and checklist

## Scope and acceptance
Implements [Phase 23](../../docs/roadmap.md#phase-23-build-publication-validation-and-checklist) and [publication criteria 15.4–6](../../docs/acceptance-criteria.md#15-subdomain-selection-and-publication), using the current component registry and approved catalog.
Prerequisites 11E, 13, 17–18 and 20–22A are owner-approved and integrated in main at 14af1a6. Phase 20's separate provider review remains outstanding and does not change its recorded owner approval.
Branch: feat/23-publication-validation. Worktree: /home/umer/.codex/worktrees/phase23-publication-validation/hasawebdotsite.
Write boundaries: shared publication messages/projection, database readiness queries, private check adapter, reusable editor checklist/correction controls, focused verification and affected guidance. No schema migration, publication commit, setup activation or roadmap checkoff.

## Decisions
Readiness checks use the saved revision and current owner authorization. Republish checks follow architecture 8.3: the owned permanent claim must match the fixed published address. A missing historical requested-address mirror cannot force a published owner back through Address selection. They never use the editor-entry milestone as readiness.
The service pages private object checks and caps reported issues. Local D1 rejected the initial 30-term compound query even though native SQLite accepted it. Rules now run in groups of four, retaining a global 50-issue cap and explicit truncation. The [selected failure evidence](evidence/d1-compound-query.json) and [rejected SQL](evidence/rejected-check.sql) preserve that runtime constraint. Page results are evidence about one revision, not a publication authorization. Phase 24 must revalidate facts while preparing its immutable candidate; Phase 25 must guard the address in its pointer transaction.

## Results
Implemented shared check messages and offline sample/disabled-photo omission, bounded database checks, the private web adapter, and the reusable checklist with field navigation and catalog/optional-section corrections. GitHub uses the existing consent/generation resolver and contact uses private verified recipient state.

Local verification passed:

- `pnpm verify --profile=full` at clean commit `175be51`: all 12 commands passed, including 440 unit tests, lint/type checks, all application/package builds, renderer/auth/persistence/upload/draft/recovery/editor suites, runtime correctness smoke and routing. The [full receipt](../../.wrangler/verification/2026-10-23T16-12-29.454Z-gC5X3x/summary.json) records identical starting/final source state. Publication-specific checks include five real-D1 boundary cases, private API/R2 checks, and three editor browser groups.
- Final diff review found that removing a section could leave its unfinished input blocking readiness. A browser regression reproduced the failure. Commit `dc3632d` clears only that section's input and preserves unrelated input; the regression also repairs Address after editor entry and verifies the saved hold without changing the milestone or publishing. The [focused receipt](../../.wrangler/verification/2026-10-24T08-36-21.942Z-mHvhmm/summary.json) passed.
- `pnpm verify --profile=editor` at clean commit `dc3632d`: 440 unit tests, lint/type checks, web/jobs builds and all 38 editor browser groups passed. The [editor receipt](../../.wrangler/verification/2026-10-24T08-37-04.224Z-k1ZEeK/summary.json) records identical starting/final source state. This bounded editor-only follow-up does not change the previously verified service contracts.

The first runtime run exceeded the terminal lifetime; its verified orphaned processes were stopped before restarting the locked runner. An earlier full run was invalidated by editing source while Wrangler watched it. Another caught an invalid GitHub test setup; the fixture now changes connection generation through its supported transition. The final passing runs used frozen commits.

Implementation and local verification are complete. The separate publication-boundary review and explicit owner completion approval remain pending; the roadmap stays unchecked. That review should inspect authorization/revision changes during object reads, sample omission and private service references, provider generation/consent, and held versus claimed addresses. The branch has not been integrated into main.

The reusable checklist is exercised through the authenticated handoff fixture; `/editor` activation remains Phase 42E. Full component configuration tools retain their own phases; the checklist provides current field/catalog corrections or explicit optional-section removal. External provider HTTP/consent is controlled in these local fixtures. Phase 24 must implement and measure preparation/source transfer and revalidate mutable facts; Phase 25 must implement the guarded publication commit. No deployment, live-provider, production CPU/capacity or completed signup-to-publication claim is made. Phase 20's already-recorded separate provider review remains outstanding.

### PR #32 image-operation regression fix, October 24, 2026

Codex review identified readiness suspension cancelling an in-flight avatar/banner replacement. Mounted image controls now report transient pending state, including a prepared crop and failed-upload retry. Readiness rejects that state before flushing and immediately before suspension. It preserves the replacement and retry data, hides stale checklist success while image work is pending, and permits checking again after acceptance or explicit cancellation. Failed uploads expose Cancel upload as well as Retry upload.

Added three regression cases in `apps/web/lib/draft/publication.test.ts` before implementation. Both image purposes and an operation beginning during flush incorrectly returned checklist success before the fix. The identical focused command, `node_modules/.bin/vitest run apps/web/lib/draft/publication.test.ts`, passes all seven tests after the fix. Only targeted tests were run at the owner's request; no full suites or builds. The pnpm launcher could not find its pinned Windows executable, so the existing local Vitest executable was used directly. Normal diff and React hook/lifecycle review completed. Changes remain scoped to this PR's existing branch/worktree; approval and release gates above remain unchanged.

### PR #32 CI formatting follow-up, October 24, 2026

Reproduced the Biome formatter failure at `b01f5ce` in the new image-upload unmount cleanup. Applied the formatter's single-line layout without changing behavior. `pnpm verify --profile=checks` passed lint, all 12 package type checks and all 443 tests in 40 files. The [receipt](../../.wrangler/verification/2026-10-24T10-46-18.626Z-EGR2JD/summary.json) records the checked working changes. The checks profile covers this formatting-only change; no builds or browser suites were rerun. Existing CSS specificity warnings remain nonblocking. The first local run hit a pnpm launcher exec-format error; a temporary executable wrapper for the installed pinned pnpm allowed the successful rerun.

## Documentation impact
Publication readiness now has a reusable saved-revision service and editor checklist. Updated schema/database/client contracts, catalog/architecture guidance, the implementation baseline, root overview and verification feature recipes to describe this boundary, compatible sample omission and the remaining preparation/commit/activation gates. Section removal clears only its own unfinished fields. Changed links and the final diff were checked. The regression follow-up updates the client contract for transient image-operation flags and the pre-suspension readiness guard. No prerequisite approval was changed; separate review, owner checkoff and later publication/activation phases remain unresolved.

The CI formatting follow-up changes no runtime or contract assumptions, so no guidance updates are needed.
