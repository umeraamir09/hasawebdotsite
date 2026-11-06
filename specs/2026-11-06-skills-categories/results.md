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

None yet.

## Results

Not started. No completion approval is recorded.

## Documentation impact

To be completed by the implementer.
