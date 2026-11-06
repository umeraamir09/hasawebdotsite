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

- Controls follow the Phase 28 project pattern: stable entry IDs, an empty entry on Add (no sample), raw owner-scoped recovery for rejected input, `OrderedItems`/`moveEditorItem` ordering and confirmed removal that clears only that entry's raw inputs (`apps/web/lib/editor/work-experience.ts`).
- Dates use `type="month"` inputs bound to the schema's `draftMonthSchema`; browsers without month inputs fall back to text and an invalid value stays in local recovery.
- The current-role toggle removes the stored `endDate` and the end-date raw input, hides the end-date field and retries a start date that was only held back by the old end date. Clearing the toggle leaves the end date empty and required.
- Reversed dates: the schema already issues the error at `endDate`, so the edit is rejected and kept as raw input. The control compares the displayed start and end values and shows "End date must not precede start date." on the end-date field. The raw input shows in the publication checklist as "Finish unsaved ... end date" and Publish is withheld. No SQL rule was added or weakened: stored drafts cannot contain reversed dates.
- Description is a plain multi-line text area. The renderer outputs it in one paragraph, so a work-experience-scoped `white-space: pre-line` rule in `portfolio.css` keeps line breaks identical in the preview and published pages (both use that stylesheet and the `[data-component="work-experience"] .pf-entry > p:last-child` selector). No markup or schema change.
- The organization link uses the existing `draftWebUrlSchema`/`isSafeLink` path; an absent or empty link renders a `<span>`, not an anchor.

## Results

Implemented: `apps/web/components/work-experience-controls.tsx`, `apps/web/lib/editor/work-experience.ts` and test, `scripts/work-experience-browser.mjs` (editor group plus publish-journey helpers wired into `editor-browser.mjs` and `publish-journey-browser.mjs`), scoped CSS in `editor.css` and `portfolio.css`.

Verification: `pnpm verify --profile=editor` (check, web/jobs builds, editor browser suite including the new work-experience group and a real publish-journey draft-versus-published check of order, text, line breaks, organization link and absent-link) passed: 48 editor browser groups, 2 production API groups. The first two runs failed before passing: one on a test-selector bug in the new group, one on an unrelated Phase 29 Tiptap-readiness timeout in `text-controls-browser.mjs` that did not recur. Targeted: `vitest lib/editor/work-experience.test.ts` (4 tests), `pnpm typecheck`, `biome check`. No completion approval is recorded.

## Documentation impact

Changed assumption: work experience was a placeholder "Entry order" list. Updated: the implementation-status row ("Work experience controls"), the packages/components README paragraph on line-break and link rendering, and this record. Education remains outside the component library. Unresolved prerequisites: Phase 42E guide/editor activation; owner approval for completion; the Phase 31 branch edits the same shared files, so the lead reconciles `implementation-status.md`, `editor.css`, `portfolio.css`, `editor-browser.mjs` and `publish-journey-browser.mjs` at integration.

## Approval

The owner approved completion on November 6, 2026 after integration into `main` (`0557587`) and a passing full local verification gate. Production guide/editor activation remains Phase 42E.
