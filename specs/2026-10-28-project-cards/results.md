# Phase 28 project cards

## Scope and acceptance

Implement [Phase 28](../../docs/roadmap.md#phase-28-add-project-cards) and the project-card subset of [product section 5](../../docs/product.md#5-projects-and-case-studies) and [acceptance section 5](../../docs/acceptance-criteria.md#5-projects-and-case-studies). Case studies remain Phase 30. Shared controls must preserve stable IDs, partial entries and invalid local input; title/summary and invalid destinations block Publish. Verify actual saved and published content/order, optional-field omission, images and removal.

Prerequisites 19, 27, 23 and 26 are owner-approved and integrated in shared base `8e7cf72`. Branch `feat/28-project-cards`, worktree `.wrangler/worktrees/phase28`. Write boundaries: project controls/helpers, existing shared field/upload adapters, editor integration, affected browser coverage and current guidance. No other worker delegated.

## Decisions

Reuse the existing private upload component for project images without forced cropping. Avatar/banner cropping remains unchanged. Read-only Figma reference `330:252` supplies the existing control language. The page node `325:2` did not return context; its concrete crop child did.

## Results

Implemented reusable `ProjectControls` and stable-ID add/remove helpers in the existing editor adapter. Entries start empty, preserve incomplete title/summary in saved drafts, keep invalid destinations in owner-scoped local recovery, and support contribution, line-based technologies, optional code/demo URLs and private images. Ordering reuses Phase 27 controls. Removal confirms intent and clears only the removed entry's raw inputs. Project uploads validate/decode the supplied image and retain its bytes without forced cropping. Only ready immutable uploads replace references; pending/retry state uses the existing publication guard. Avatar/banner cropping remains unchanged.

The shared card and bounded publication fallback omit absent link rows. A browser finding exposed ambiguous image/entry removal labels; the image action now says `Remove project image`. The real publication journey exercises both actions.

Verification on base `8e7cf72` plus these uncommitted changes:

- `pnpm check`: 467 tests across 44 files, all type checks and lint passed. Seven existing CSS specificity warnings remain.
- All application builds passed. Wrangler build steps use dry-run delivery.
- The full-profile run passed 27 renderer browser groups, authentication and its 19 browser journeys, 85 persistence/access checks, 11 private upload groups, 43 publication-dispatch groups, public commit/serving checks, and the draft API groups through restart persistence.
- Interrupted groups resumed through the existing `runVerification` shared-lock runner, with filters selecting unfinished groups and no weakened assertions. Across the resumed runs, 44 unique editor browser groups passed, including project partial saving, raw recovery after reload, stable ordering, cancelled/confirmed removal, required title/summary blockers, image replacement failure/Retry/removal, exact published content/order/links/image delivery, and project removal/asset withdrawal only after another Publish. The interrupted setup/handoff/publication API group passed on retry. Final new project browser evidence is under `.wrangler/verification/2026-10-28T12-15-47.351Z-5qagyD/suite-3`.
- Autosave recovery, three-Worker/D1/R2/Queue/Workflow restart persistence, runtime correctness smoke and 31 host/path/method routing boundaries passed. The resumed completion run `.wrangler/verification/2026-10-28T12-15-47.351Z-5qagyD/summary.json` reports `passed`. The full local verification set is covered across the original run and the resumed runs; the original full command itself stopped on local proxy transport failures. No deployed CPU/capacity claim is made.

Local Wrangler proxy connection losses interrupted unrelated D1 fixture and address/cleanup requests. No conflicting Worker process remained. Failed evidence is retained in ignored verification directories; clean filtered reruns preserve prior passing groups. Browser proof is Chromium in the handoff fixture with real local APIs/D1/R2, not an activated production editor or a live-provider measurement. Mobile project-control screenshot inspected; fields fit without clipping.

Normal diff review covers stable entry paths, scoped raw-input cleanup, upload readiness/cancellation, empty optional output and bounded-renderer parity. No authentication, schema, migration, dependency or publication authorization contract changed. No completion approval, commit or push recorded.

### PR 39 CI follow-up, October 28, 2026

CI run `40691531099` failed at `pnpm check`: commit `b11de0c` changed the raw-input recovery wait to a predicate whose single-line formatting violates Biome. Reproduced with `pnpm exec biome check scripts/project-controls-browser.mjs`, then applied Biome's required line wrapping without changing the predicate or its assertions. The seven CSS specificity warnings were nonfatal and unrelated.

`pnpm verify --profile=checks` passed lint, all 12 package type checks and 467 tests across 44 files on `b11de0c` plus this formatting fix. Evidence: `.wrangler/verification/2026-10-28T13-35-16.087Z-VhBG65/summary.json`. The checks profile covers this test-formatting-only change; shipped code and browser behavior are unchanged. Final diff review confirms only formatting and this record changed.

## Documentation impact

The CI follow-up changes no product or workflow assumptions; existing verification guidance already requires `pnpm check`, so no guidance changes are needed.


Changed assumption: project editing is available in the handoff fixture, and cards without supplied code/demo URLs have no empty link row. Updated the implementation baseline, roadmap record link, editor controller guide, private upload guide and component rendering contract. Downstream onboarding guidance already requires shared project controls and needs no scope change. Changed relative links and the final diff were checked. Production onboarding/editor activation remains Phase 42E; case studies remain Phase 30. Owner completion approval and shared-base integration remain pending. Paid-provider and deployed withdrawal checks remain release gates.
