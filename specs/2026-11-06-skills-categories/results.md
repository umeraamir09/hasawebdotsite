# Phase 31 skills and technology categories

## Scope and acceptance

Implement [Phase 31](../../docs/roadmap.md#phase-31-add-skills-and-technology-categories). Product and acceptance requirements are in [product](../../docs/product.md) and [acceptance criteria](../../docs/acceptance-criteria.md); the roadmap entry above states the completion check.

Scope: one skills component with manually entered names, optional named categories and entry/category ordering. Category controls stay in the editor; onboarding reuses simple name entry (no onboarding screens here). Grouped and uncategorized entries render in saved order. No ratings and no automatic extraction. The empty-step-to-no-component adapter belongs to Phase 42C, not this increment.

Prerequisites 17 and 27 are owner-approved and merged. Integration points 23 (publication validation, already covers these component types in `packages/db/src/publication.ts`) and 26 (publish finish) are merged; published-parity must be verified through them. Shared base: `22f340b` (`refactor/split-entry-controls`, on `main` at `87d2290`). Branch `feat/31-skills-categories`, worktree `.wrangler/worktrees/phase31`. Run in parallel with Phase 32 (branch `feat/32-work-experience`).

### Ownership split (coordinator-led, October-style parallel mode)

The schema (`packages/schema/src/components/skills-categories*.ts`), registry entry, picker, model adapter, renderer markup and publication SQL rules already exist, so no shared-contract commit beyond `22f340b` was needed. That commit gave each phase its own controls file and dispatch case so neither edits `editor-fields.tsx`.

- **This phase owns:** phase310
- **Other phase owns:** the other component's schema, controls, helpers, renderer markup/CSS block, publication rules and tests.
- **Shared files** (`packages/components/static/portfolio.css`, `apps/web/components/editor.css`, `scripts/editor-browser.mjs`, `packages/db/src/publication.ts`, `packages/schema/src/fixtures.test-support.ts`, `docs/implementation-status.md`, `packages/components/README.md`, `apps/web/lib/draft/README.md`): edit only this component's hunks, in new clearly named blocks; the lead reconciles during sequential integration. If a change to the schema, registry entry, generation-policy or equivalence fixtures looks necessary, stop and report to the lead instead of making it.

## Decisions

- **Render order.** The model adapter already emits groups in category order followed by one unnamed trailing group of uncategorized skills; each group keeps saved entry order and empty groups are dropped. The roadmap and [acceptance criteria](../../docs/acceptance-criteria.md#6-skills-and-technologies) ask for "selected grouping, and order", so category order is the owner's saved group order and this adapter is kept unchanged. A flat interleaving of entry order across groups would make category ordering meaningless.
- **Category removal.** Removing a category keeps its skills as uncategorized, after a confirmation that states how many skills stay. Removing a skill is confirmed like a project.
- **Publication.** The Phase 23 rules (at least one entry, non-blank skill name, non-blank category name) are unchanged and were exercised through the real publish journey.
- **Omitted controls.** The category select appears only once a category exists; category order only with two or more categories.
- **Simple name entry.** `addSkill` and the `Skill name` field are reusable by Phase 42C; category controls stay in the editor.

## Results

- `apps/web/components/skills-controls.tsx`: skill name entry, category add/rename/remove, assign or clear category, skill and category ordering through `OrderedItems`/`moveEditorItem`, confirmed removals, field errors for blank names, raw invalid input kept through `DraftTextField`.
- `apps/web/lib/editor/skills.ts` (+ test): stable-ID add/remove/assign helpers that validate against the draft schema, refuse over-budget changes and clear raw input of removed items.
- `scripts/skills-controls-browser.mjs`: editor check (preview groups in saved order, confirmed removal, mobile) and publish-journey prepare/assert helpers wired into `editor-browser.mjs` and `publish-journey-browser.mjs` with minimal hunks.
- Not done: onboarding screens and the empty-step adapter (Phase 42C). No completion approval is recorded.

Verification (local, 2026-11-06): `pnpm verify --profile=checks` passed (46 files, 508 tests, lint, types); `pnpm verify --profile=editor` passed including the new skills controls check and the publish journey, which asserts the published groups (Tools, Languages, uncategorized) equal the saved-draft order with no meters, ratings or levels, and that a blank skill name blocks Publish via the Phase 23 rule. The publication, renderer and full profiles were not run in this worker.

## Documentation impact

Changed assumption: the skills controls were a placeholder of two order lists. Updated the implementation-status row set (new Skills row), and the components README projection paragraph (group order, category removal, no ratings). Unresolved prerequisites: Phase 42C onboarding name entry and empty-step adapter; owner approval of completion. No schema, registry, fixture or publication SQL change was needed.

## Approval

The owner approved completion on November 6, 2026 after integration into `main` (`0557587`) and a passing full local verification gate. Production guide/editor activation remains Phase 42E.
