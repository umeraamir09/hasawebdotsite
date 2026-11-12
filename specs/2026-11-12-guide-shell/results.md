# Phase 42A: Build the guide shell, progress, and Address screen

## Scope and acceptance

Requirements: the [Phase 42A roadmap entry](../../docs/roadmap.md#phase-42a-build-the-guide-shell-progress-and-address-screen), [onboarding screen sequence and navigation](../../docs/onboarding.md#required-setup-and-navigation), and the parts of [ON-01, ON-02, ON-13, ON-14 and ON-19](../../docs/acceptance-criteria.md#initial-setup-checks) that apply to the shell and the Address screen. Current contracts: the [shared draft client](../../apps/web/lib/draft/README.md), [Phase 22 address reservations](../2026-10-21-address-reservations/results.md) and [Phase 22A setup checks and handoff](../2026-10-23-setup-handoff/results.md).

Change: a focused responsive step shell with a header (brand, save state, Sign out), seven-step progress, Back on later steps, saved-step resume and the first required screen, Address. It reuses the editor's reservation and availability checks, the shared autosave controller in setup context and the shared recovery controls. Required steps offer no skip or editor action.

Acceptance checks (from the roadmap entry):

- ON-01/02/13/14/19 pass for this increment.
- Concurrent selection produces one reservation and no public URL.
- Required navigation cannot be forged.
- The incomplete required signup journey is not activated.

Prerequisites 11A–11B, 12–17 and 22–22A are owner-approved and on `main` at `89c92b3`. Default styling from 16/11E is used; Phase 35 controls are not needed. Branch `feat/42a-guide-shell` in worktree `.claude/worktrees/eager-driscoll-83a650`, created from `origin/main` at `89c92b3`. `git worktree list` showed only merged phase branches and the unrelated `fix/workers-redirect-mode` and `fix/github-cleanup-redirect` worktrees. No delegated workers.

Write boundaries: `apps/web/components` (guide shell, shared address hook, `AddressControl` refactor, editor-entry sign-out reuse), `apps/web/lib/guide`, `apps/web/lib/auth-client.ts`, the guide browser fixture, the editor browser harness and its new guide groups, and current guidance. No server, schema, migration or production route changes.

## Decisions

- **Server facts gate navigation.** Setup progress is client-saved navigation. The guide shows `resumeStep(saved progress, issues)`, where `issues` comes from the existing authoritative `POST /api/owner/setup/check` for the confirmed revision. A saved step past the first incomplete required step (address → Address; name/bio/avatar/banner → Profile; links → Links) resumes at that step. Until the first check returns, only Address can show. No step is read from the URL.
- **Address continuation order.** Continue validates the format locally, runs the advisory availability check, sends the explicit address confirmation, reads the registry, reruns the setup check for the new revision, and only then saves progress (`changeProgress` + `flushValid`). Progress is saved after the hold rather than inside the address command so that a failed or rejected reservation never leaves a saved later step. An existing hold on the same name with no raw input skips a second confirmation.
- **Shared address field state.** `useAddressReservation` holds the field logic previously inside `AddressControl`: raw-input typing, availability, explicit confirmation and registry verification. The editor control keeps its text and behavior; the guide passes `Continue` as the action label.
- **Steps without adapters.** Profile through Review show the shell, progress, Back and a "not available yet" note, with no Continue. This lets resume, Back and the progress clamp be tested without implying later steps exist. 42B–42E replace these notes.
- **No production activation.** `SetupGuide` is mounted only by `apps/web/integration/guide-fixture.tsx`, served at `/guide` by the editor browser harness. `/auth/entry` and `/editor` are unchanged.
- **Figma copy.** Read-only inspection of frames `326:173` (desktop Address), `326:614` (mobile Address) and `326:340` (Skills, for Back/skip placement) supplied the layout, progress segments, field and persistent Continue. The frame's "Claimed when you publish / This address is not reserved" note predates the October 21 reservation amendment; the guide uses "Reserved when you continue" copy that matches the current contract. The Figma file was not modified.
- **Sign-out.** The editor entry's sign-out request moved to `signOutOwner()` in `lib/auth-client.ts` so both shells share it. The fixture replaces it with a counter so the shared test session is not revoked.

- **Availability results stay valid for an unchanged name.** Disabling the field during Continue blurs it, and the blur started a second availability check that superseded the submit's own check, so Continue silently stopped. `useAddressReservation.check()` now returns its result whenever the name is unchanged, and only the newest query updates the message. The guide also skips the blur check while a submit is running. This also applies to the editor control, whose visible behavior is unchanged.

## Results

The `auth` profile covers this change: it runs `pnpm check`, web/jobs builds, the auth browser journeys (the account-entry sign-out moved to a shared helper), the draft API, autosave (shared recovery controls) and the full editor browser suite (the refactored `AddressControl` and the new guide groups). No server, schema or package contract changed, so `full` is not required.

The locked run at `.wrangler/verification/2026-11-12T03-26-51.077Z-ONQYcJ/summary.json` passed on `89c92b3` plus the working changes in this record (working-changes hash `c0155a8d…`): lint, type checks and 650 unit tests, web/jobs builds, 19 auth browser journey checks, 19 draft API groups, 49 autosave groups and 65 editor browser groups (the 60 existing groups plus 5 new guide groups). No assertions, timeouts or retries were relaxed. The existing editor group "address local typing, explicit reservation, reload, keyboard and mobile" passed unchanged against the refactored control.

New browser groups (`scripts/setup-guide-browser.mjs`, real signed sessions and the production owner API):

- **Address reservation, progress, resume and Back.** A new owner starts at Address with seven progress segments, Address marked current, and no Back, skip, Review or editor action. Invalid input cannot continue and creates no claim. A valid name shows "Available now", Continue holds it (`subdomain_claim` `held`, `portfolio.subdomain` null, draft mirror set, progress `profile`), and focus moves to the new step heading. Reload and a second browser context resume at Profile. Back shows the held name; Continue again sends no second confirmation (one receipt); a changed name swaps the hold.
- **Forged progress and local input.** `review` saved as progress through the owner API resumes at Address while no hold exists; with a hold, a saved `github` resumes at Profile. Invalid address text survives reload as explicit browser recovery ("Continue preserved edits"), is marked Unsaved input and invalid, and leaves the hold and draft mirror unchanged.
- **Two owners, one name.** Simultaneous Continue from two owners produces exactly one `subdomain_claim` row; the other owner sees "That address is unavailable. Choose another name." and can continue with another name.
- **Stale tab.** A second tab with unfinished input cannot replace the hold the first tab just made: its confirmation is rejected on the old revision, it stays on Address, and it offers Load newer version and Keep my edits for review.
- **Keyboard, mobile, reduced motion, accessibility.** Tab reaches the field and Enter continues; the field shows a visible focus ring; progress transitions are disabled under reduced motion; axe (WCAG 2.0/2.1/2.2 A/AA tags) finds no violations on Address or Profile at desktop and 390-pixel widths; neither page scrolls horizontally; Sign out calls the provided handler.

Screenshots of these runs are in the suite's ignored `suite-6/guide-*.png` evidence and are attached to the pull request.

Defects found and fixed during this work: the blur/availability race above; focus falling to `<body>` when the focused Continue button is removed with its step (focus now moves to the new heading after navigation saves); a test-harness crash when a filtered or sharded editor run never opens the editor page; and mobile header wrapping of Sign out.

Limitations: Chromium only, as for other incremental phases; the confirmed browser/viewport matrix remains Phase 53. Steps after Address are placeholders until 42B–42E. Required navigation is enforced by server checks for the steps that exist; Profile and Links continuation are 42B's. The guide is not reachable from any production route.

Completion approval and roadmap checkoff are not recorded.

## Documentation impact

Changed assumption: the guided UI is no longer entirely pending; its shell and Address screen exist behind a test fixture, while route activation remains Phase 42E. Updated the [onboarding status](../../docs/onboarding.md), [architecture setup paragraph](../../docs/architecture.md), [implementation baseline](../../docs/implementation-status.md) (new row and the browser-recovery row), the [draft client contract](../../apps/web/lib/draft/README.md) (shared address hook and setup guide section) and the roadmap entry's record link. The roadmap checkbox stays unchecked pending owner approval. Unresolved: 42B–42F, and the stale Figma Address note described above, which needs the owner's decision before anyone edits the file.
