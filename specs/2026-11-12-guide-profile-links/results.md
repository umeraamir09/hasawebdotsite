# Phase 42B: Combined Profile and required Links screens

## Scope and acceptance

Requirements: the [Phase 42B roadmap entry](../../docs/roadmap.md#phase-42b-add-the-combined-profile-and-required-links-screens), [onboarding](../../docs/onboarding.md#provider-suggestions-and-image-handling) and [ON-03/04/05](../../docs/acceptance-criteria.md#initial-setup-checks). Prerequisites 19-21 and 42A are owner-approved and on `main` at `dbdb123`. Branch `feat/42b-profile-links-screens`, no delegated workers. Write boundaries: `apps/web/components/setup-guide.*`, `apps/web/lib/guide`, the guide browser group, current guidance. No server, schema or route changes.

## Decisions

- Profile reuses `ProfileControls` with `showLocation={false}` (name, bio, avatar and banner with previews, crop dialogs, on-request provider name/photo suggestions with explicit acceptance). Links reuses `SocialLinksControl` (labels, ordering, account-email suggestion with public-visibility explanation). No starter or duplicate links are inserted and no social-links component is added.
- Continue on either screen refuses unsaved raw input, waits for pending images, runs `flushValid()` and the authoritative setup check, and advances only when the screen's fields (`stepFields`) are no longer reported. Shell clamping from 42A still enforces order.
- Skills remains the 42A placeholder until 42C.

## Results

Local: `pnpm lint`, web typecheck and guide unit tests pass. `pnpm test:editor -- --browser-filter="setup guide"` passes four groups: the three 42A groups unchanged (axe now covers the real Profile screen at desktop and 390 px) and the new "setup guide profile images and required links" group (empty Continue refused, real avatar/banner crop uploads stored with accepted avatar, invalid link blocks, valid labeled link advances, Back and Continue leave one link and no social component). `pnpm verify --profile=auth` stopped at its unit stage on two `verification.test.mjs` tests inside other worktrees under `.claude/worktrees` (phase-40/41 copies; 4835 other tests passed). Run directly, `test:auth:browser` and `test:autosave` passed. `test:draft-api` and the full `test:editor` suite exited non-zero in one run; they were not diagnosed or rerun locally because the owner chose to leave full verification to CI. Treat both as unverified until CI passes.

Limitations: Chromium only; provider and account-email suggestions are covered by existing editor groups, not re-run inside the guide; the guide is not reachable from production routes.

November 13, 2026: the owner approved Phase 42B completion after PR #56 merged to `main` at `c6cc2cf`. No separate boundary review is recorded.

## Documentation impact

Updated the implementation baseline row, onboarding status, draft client contract and roadmap record link. 42C-42E remain pending. The approval follow-up checks off the roadmap entry and records approval in the implementation baseline.
