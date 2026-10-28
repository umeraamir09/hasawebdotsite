# hasaweb.site verification map

Read the [skill](../SKILL.md) for launch, doctor, locking, evidence and cleanup. This map describes the current local implementation, not every final product requirement. [Acceptance criteria](../../../../docs/acceptance-criteria.md) still control product completion.

## Baseline preconditions

- `entry` uses fresh migrated storage, no session, no provider credentials and a new browser context. The executable helper owns launch and teardown.
- Other recipes use existing suites and their own seeded users, sessions and draft records. Run one locked profile at a time. Do not replace their seeds with `pnpm local:seed`, which creates no usable sessions.
- `/auth/entry` resolves incomplete owners into the account shell and entered owners to `/editor`, which also remains a shell. Editor controls, shared image crop/upload controls, social/contact links, and private iframe routes exist in the handoff fixture. Phase 20 provider suggestions and photo import run through these controls. Phase 25 adds manifest-authorized public serving and commit. Phase 26 exposes local Publish and withdrawal through the editor handoff fixture. The required guide and production editor activation remain pending.
- An unmet precondition is a failed or blocked journey with its reason, never permission to omit an entry point or weaken the assertion.

## Driving and proof conventions

Use roles/accessible names and existing stable attributes. Report which entry points were exercised. Every claimed mutation needs an observable persisted result as well as its UI state. Read the trace or ordered action log alongside screenshots. Provider fixtures and internal-controller assertions must be identified in coverage claims. Keep routine evidence ignored under `.wrangler`; preserve selected consequential failure evidence according to repository policy.

The initial deliverable proves only `entry` end to end. The other recipes route to existing suites; creating this map does not rerun or newly certify their full coverage.

## Features

| Feature | Entry points and executable recipe | Current boundary |
| --- | --- | --- |
| [Entry and signed-out navigation](entry.md) | `/`, `Start building`, `Back to home`, direct `/editor`; skill helper | Real built application |
| [Sign-in and private account](account.md) | Both provider buttons, returning sign-in, `/auth/entry`, direct-editor guards, shell retry and sign-out; auth profile | Provider consent/HTTP fixtures; real auth and owner APIs |
| [Draft saving and recovery](recovery.md) | Recovery controls, reload, `/auth/recovery` and `/auth/recovery/error`; drafts and auth profiles | Isolated editing fixtures plus real callback route |
| [Editor and private live preview](editor-preview.md) | Profile/component controls, preview selection, desktop/mobile; editor profile | Handoff fixture only |
| [Private uploads](uploads.md) | `PUT /api/assets`, `GET /api/assets/{id}`; uploads profile for transport, editor profile for controls | Production web handler with real D1/R2, signed-cookie fixtures, and shared crop controls in the handoff fixture |
| [Reserved address selection](addresses.md) | Address controls in the editor fixture and explicit owner draft actions; drafts profile | Reusable controls and real owner API; required guide activation remains pending |
| [Publication and readiness](editor-preview.md#publication-checklist) | Checklist and correction controls; editor profile, owner API and D1 boundary checks in full profile | Readiness plus profile-only publication/reopen/republish; full owner-flow activation and deployed withdrawal remain pending |
| [Portfolio rendering and theme](portfolio.md) | Browser preview and static portfolio fixtures, theme toggle; renderer profile | Renderer fixture parity; public serving is covered by publication fixtures, with additional-page controls in later phases |
| [Immutable candidate preparation](publication-candidates.md) | Shared controller admission helper and keyed real D1/R2 dispatch fixture; publication profile, or full for changed shared contracts | Complete artifacts, hashes, failures, retention and local owner publication; production release checks remain pending |
