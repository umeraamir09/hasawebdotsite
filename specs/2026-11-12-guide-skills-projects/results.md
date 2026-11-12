# Phase 42C: Optional Skills and Projects adapters

## Scope and acceptance

Requirements: the [Phase 42C roadmap entry](../../docs/roadmap.md#phase-42c-add-optional-skills-and-projects-adapters), [onboarding](../../docs/onboarding.md) and the Skills/Projects/skip/save portions of [ON-06/07/12/13](../../docs/acceptance-criteria.md#initial-setup-checks). Prerequisites 27-28, 31 and 42B are owner-approved or integrated on `main` (42B merged in PR #56 at `c6cc2cf`). Branch `feat/42c-skills-projects-adapters`, no delegated workers. Write boundaries: `apps/web/components/setup-guide.*`, `guide-optional-steps.tsx`, `apps/web/lib/guide`, the guide browser group, current guidance. No server, schema or route changes.

## Decisions

- Skills and Projects reuse the editor's entry mutations and fields (`addSkill`, `addProject`, removals, `moveEditorItem`, `DraftTextField`, `ImageUpload`, `OrderedItems`). Categories and case studies are not offered.
- The component is created with the first entry (`addFirstEntry`). `settleOptional` drops entries nothing was entered into (blank skill names; projects with no text, technologies, links or image) and then an empty section, on both Continue and Skip. Entered content and IDs are never rewritten, so Back/retry does not duplicate.
- Continue on Projects requires a title and summary for every remaining project; Skip keeps incomplete projects, which then carry the normal publication blockers. Continue also refuses unsaved raw input; Skip does not.
- Skip this step goes to the next screen; Skip remaining steps targets `remainingTarget` (`review`), a stable intent independent of later optional screens. Review itself is 42E and still renders the unavailable placeholder.

## Results

Local: `pnpm lint` (existing warnings only), web typecheck and guide unit tests pass. `pnpm test:editor -- --browser-filter="setup guide"` passes all four groups; the extended "profile images and required links" group now covers: untouched Skills Continue creates no component, a blank extra skill is dropped while the entered skill keeps its ID across Back/Continue, an untouched project is dropped on Skip, a partial project blocks Continue but survives Skip once with a stable ID, completing it keeps the ID, and Skip remaining steps saves `review` and keeps both sections. The wider `pnpm verify` profiles and the full `test:editor`/`test:draft-api` suites were not run locally; CI covers them. Owner approval is not yet requested or recorded.

Limitations: Chromium only; Review navigation and ON-06/12 integration with GitHub are 42D-42F; the guide is not reachable from production routes.

## Documentation impact

Updated the implementation baseline row, onboarding status, draft client contract and roadmap record link. 42D-42F remain pending; the roadmap box stays unchecked.
