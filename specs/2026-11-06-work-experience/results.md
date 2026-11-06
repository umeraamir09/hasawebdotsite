# Phase 32 work experience

## Scope and acceptance

Implement [Phase 32](../../docs/roadmap.md#phase-32-add-work-experience). Product and acceptance requirements are in [product](../../docs/product.md) and [acceptance criteria](../../docs/acceptance-criteria.md); the roadmap entry above states the completion check.

Scope: role, organization, dates, current-role status, description, optional organization link and entry ordering. An ongoing role requires no end date; reversed dates fail with a field error; published entries and links match the draft. The organization link uses the existing safe-link rules. Description entry is a plain text area and does not depend on Phase 29's rich-text editor. Education stays outside the component library.

Prerequisites 17 and 27 are owner-approved and merged. Integration points 23 (publication validation, already covers these component types in `packages/db/src/publication.ts`) and 26 (publish finish) are merged; published-parity must be verified through them. Shared base: `22f340b` (`refactor/split-entry-controls`, on `main` at `87d2290`). Branch `feat/32-work-experience`, worktree `.wrangler/worktrees/phase32`. Run in parallel with Phase 31 (branch `feat/31-skills-categories`).

### Ownership split (coordinator-led, October-style parallel mode)

The schema (`packages/schema/src/components/work-experience*.ts`), registry entry, picker, model adapter, renderer markup and publication SQL rules already exist, so no shared-contract commit beyond `22f340b` was needed. That commit gave each phase its own controls file and dispatch case so neither edits `editor-fields.tsx`.

- **This phase owns:** phase320
- **Other phase owns:** the other component's schema, controls, helpers, renderer markup/CSS block, publication rules and tests.
- **Shared files** (`packages/components/static/portfolio.css`, `apps/web/components/editor.css`, `scripts/editor-browser.mjs`, `packages/db/src/publication.ts`, `packages/schema/src/fixtures.test-support.ts`, `docs/implementation-status.md`, `packages/components/README.md`, `apps/web/lib/draft/README.md`): edit only this component's hunks, in new clearly named blocks; the lead reconciles during sequential integration. If a change to the schema, registry entry, generation-policy or equivalence fixtures looks necessary, stop and report to the lead instead of making it.

## Decisions

None yet.

## Results

Not started. No completion approval is recorded.

## Documentation impact

To be completed by the implementer.
