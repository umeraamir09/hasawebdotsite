# Phase 38: Face Reveal interaction and withdrawal

## Scope and acceptance

Requirements: [product section 4](../../docs/product.md) (Face Reveal, avatar decoration and playback), [acceptance criteria 4.6 and 4.11–4.15](../../docs/acceptance-criteria.md#4-required-profile-images-and-social-identity), [architecture 9.4](../../docs/architecture.md#94-face-reveal-and-avatar-decoration), the [catalog playback policy](../../docs/appearance-catalog.md#optional-decorations) and the [Phase 38 roadmap entry](../../docs/roadmap.md#phase-38-add-face-reveal-interaction-and-withdrawal).

Changes:

- An enabled Face Reveal renders the portrait as one native button over both owner images. It has a subtle swap cue and the `Reveal face` / `Show avatar` labels. The source diagonal wipe plays in a stable box; reduced motion switches immediately.
- A selected decoration gets an independent, keyboard-accessible `Pause animation` / `Play animation` control, with Face Reveal on or off.
- The same markup and `installSite` behavior run in the editor preview and on the markup-only published page.
- The bounded publication dispatcher streams the second photo and its description. Disabling Face Reveal and republishing withdraws the public photo, while the private draft keeps it.

The faithful React reference (`apps/web/components/profile-avatar.tsx` and its CSS module) is unchanged.

Acceptance checks (the risks named in the task):

- Every page load starts on the original avatar.
- The preview matches the public behavior.
- Reduced motion gives the correct still states.
- Disabling and republishing removes the second photo from public storage and cache, while keeping the private draft asset.
- No animation work runs while paused.

Prerequisites: Phase 37 (PR #48, `a03c2f6`) and Phases 16, 23–26 are integrated. Shared base: `origin/main` at `a03c2f6`. Branch `feat/38-face-reveal`, worktree `.claude/worktrees/phase-38-face-reveal`. No other worktree was changed.

S-9 status at start (November 7, 2026): **not verified in deployment.** The [S-9 findings](../2026-10-15-workflow-assets/results.md#s-9-live-withdrawal) and the [deployment policy](../../docs/deployment-policy.md) make deployed browser/edge withdrawal a release gate. Phase 26 implemented and tested the local policy: `no-store` on every served file, purge by host and cleanup that waits for observed absence. The roadmap lists verified S-9 under "integration before full completion," not as a start dependency, so local work proceeded. This phase reuses that local policy for the second photo; it does not claim deployed withdrawal.

Write boundaries:

- Display model (`profile.faceReveal`, `profileAssetUrls`, display envelope), `AssetImage` classes, `PortfolioProfile`.
- The generator template for `PortfolioAvatar` (`scripts/generate-renderer-avatar.mjs`) and the regenerated `avatar.tsx`. The generated `avatar.css`, cat art, fonts and manifest are byte-identical.
- New `static/avatar-reveal.css`, imported by `portfolio.css`.
- `installSite` in `site.ts`, shared by `site-entry` and `mountPreview`.
- Fragment renderer (`faceReveal` on the avatar asset part), preparation `image` command (`face` side), dispatcher `image()`, `PUBLICATION_RENDERER_VERSION`.
- Test fixtures: the renderer fixture server, the S-8 publication fixtures (`cat-face` case) and the withdraw-check fixture (reports observed URLs).
- Tests: renderer unit tests, a renderer browser parity check and one new editor browser journey. The Phase 37 journey's comparison now ignores the script-managed `hidden` attribute on the playback control.

The draft schema, migrations, publication validation, upload contract, manifest selection, finalization and the withdrawal/cache code are unchanged.

## Decisions

- **Paused hands (owner decision, November 7).** I asked before choosing because it affects the animation sequences. The owner chose that paused hands use the source reduced-motion still: the stationary manicure pose, with all animations removed. Play restarts the full six-second sequence from 0 s. The cat can only pause by switching to its cleaned still, so its loop also restarts on Play. A frozen mid-gesture frame was rejected: it can show two poses mid-crossfade and leaves paused animations in place.
- **Wipe while paused (owner decision, November 7).** Pause applies only to decorations, so the 620 ms wipe still plays. Only reduced motion skips it. Nothing keeps running after the wipe ends.
- **Labels and state.** The button's accessible name is its `aria-label`, which changes between `Reveal face` and `Show avatar`. There is no `aria-pressed`, because a pressed state on a button whose label changes would announce contradictory state. The source in-progress guard is kept: a second activation during the wipe is ignored. `aria-disabled` is not set during the 620 ms, so the label change is not followed by a "dimmed" announcement. The playback button has both labels as spans, and CSS shows the one for the current `data-playback`. The script never rewrites React-owned text.
- **Reduced motion takes priority.** Under reduced motion the cat's `<picture>` already selects the still, the source CSS removes the hand animations and the wipe is skipped. The playback control is hidden, since nothing can play. The visitor's playing or paused choice is kept and applies again when motion is allowed. A preference change applies at once, and one during a wipe ends it.
- **Pause mechanism.** Pause sets `data-playback="paused"`. The script sets the still `<source>`'s `media` to `all`, so the browser shows the still without a second image, and CSS gives the hands the reduced-motion still. Playback state is not stored and resets on each load.
- **Every load starts on the avatar.** The markup carries `data-photo="false"` and `Reveal face`. A back/forward-cache restore also returns to the avatar. Nothing is persisted.
- **Visual cue and control placement.** The Figma file has no Face Reveal cue or playback control. A read-only MCP check of `Portfolio / Adapted` (`4:79`) and `Portfolio / Profile` (`16:208`) found only the avatar and actions, and the file was not changed. The cue is a 26 px round swap badge at the frame's top-right corner, above the decorations, using `--pf-raised`, `--pf-control` and a `--pf-focus` border on hover or focus. The control uses the existing pill button style beside the avatar, more compact at 760 px and below so it fits at 360 px. Because the cat's fur covers the portrait edge, the frame also shows the focus ring.
- **Progressive enhancement.** The playback control ships `hidden` and the script reveals it, so a page without the script has no dead control. The reveal button needs the script, which every published page loads as a render-blocking platform file.
- **Publication streaming.** The avatar image command now has three sides: `open`, avatar description, `face`, photo description, `close`. Preparation and the dispatcher both require `faceReveal.enabled` and a photo ID in the candidate. The candidate already omits a disabled photo. The fragment renderer rejects `faceReveal` on non-avatar parts and checks both origins.
- **Renderer version.** The avatar markup, platform CSS/script and command format changed, so `PUBLICATION_RENDERER_VERSION` is `publication-v5`. Unfinished `publication-v4` candidates follow the existing renderer-policy rejection.
- **Display envelope.** A third profile image is now possible, so the preview allowance is `floor(1 MiB / 94) + 3` images. The existing transport tests still pass under the new bound.

## Results

Local gate: `pnpm verify --profile=full` passed on November 7, 2026 on base `a03c2f6` plus the uncommitted Phase 38 working changes (run `2026-11-07T14-45-25.675Z-0rjOJB`). The full profile is required because the change touches the shared display model, platform CSS/script, the publication dispatcher and the renderer version. All 14 commands exited 0:

- `pnpm check`: 533 unit tests.
- Renderer browser: 31 groups, including the new Face Reveal parity group. Private uploads: 11. Publication dispatch: 44 S-8 integration groups, including the new `cat-face` case. Publication serving: 4.
- Draft API: 19 groups. Editor browser: 54 groups, including the new journey and the Phase 37 journey.
- Auth (30 checks), persistence (88 checks), autosave, runtime smoke and routing (31 boundaries).

A first full run failed in publication dispatch. The new `cat-face` fixture used a photo ID the harness does not track (`public-face`). It now uses the harness's `private-face` ID, and the second run is the one recorded above. After that run, an incidental one-line formatter change to `scripts/social-links-publish-browser.mjs` was reverted to its base content. Later edits were this record only.

Proof for each named risk:

| Risk | Where it is proven |
| --- | --- |
| Every page load starts on the original avatar | Unit: the markup has `data-photo="false"` and `aria-label="Reveal face"`, with the avatar before the photo. Renderer browser: each published fixture is reloaded after interaction and returns to the avatar, playing. Journey: the published page after a reveal and reload shows `Reveal face`, the avatar and `playing`. |
| Preview matches public behavior | Renderer browser (`face-reveal-renderer-browser.mjs`): the same scripted session runs on the published document and the private preview for none/cat/hands with Face Reveal and cat/hands without it. Each trace is checked, and the preview and public traces must be deep-equal. A preview content update keeps the current portrait and pause state. Journey: the editor preview of a real draft and the real published page give equal traces. S-8: the `face` and new `cat-face` dispatch cases must equal the projected-model rendering byte for byte, including an escaped photo description. |
| Reduced motion gives correct still states | Renderer browser and journey traces. Under reduced motion the cat shows `still.webp`, the hands run no animation with the nails pose at opacity 1, and the control is hidden while `data-playback` stays `playing`. Activation switches immediately with no `portrait-erase`. Allowing motion again resumes the sequence, and a pause made before is kept. A preference change during a wipe ends it. |
| Disabling and republishing withdraws the photo but keeps the draft asset | Journey: the photo is public (200, `no-store`) before any reveal, and warmed in a real browser cache through the unrouted proxy along with a query variant. After disabling and republishing: the page has no reveal, photo ID or description; GET/HEAD of the URL and `?variant=warm` return 404 with `no-store`; both warmed browser URLs return 404; and the public R2 object is gone. The production cleanup path, using the withdraw-check fixture with purge and verification enabled, fails with 503 while a cached copy is served. The URLs it observed are exactly the photo. It completes only after observing absence of the photo and its query variant. The visitor's next load never requests the photo. The draft keeps the same asset ID, the row stays `face`/`ready`, the owner can read it (200), and signed-out and other-owner reads are refused. Re-enabling restores it. |
| No animation work runs while paused | Traces assert that `document.getAnimations()` has no running animation in the avatar while paused, after a wipe completes while paused, and under reduced motion. The cat's `currentSrc` is the single-frame cleaned still, so the animated WebP is not displayed. While playing, all seven source hand keyframe families run and the cat shows the loop. |

Other checks: both images and both image boxes keep the same rectangle at the start, during the wipe and after every toggle. Enter and Space toggle the reveal, and Enter and Space toggle playback. `:focus-visible` matches and the frame shows a solid focus outline. axe finds no WCAG 2.2 AA violations in the published avatar envelope. At 360 px the control stays inside the profile card with no horizontal scroll. Face Reveal off renders no cue, no second image and no reveal button.

Evidence (ignored run directories): `face-reveal-cat.png`, `reveal-cat-360.png` and `reveal-hands-360.png` under the renderer evidence directory, and `face-reveal-published.png` under the editor evidence directory.

Limitations:

- Not run: the deployed S-9 browser/edge withdrawal check and paid-provider checks. Both remain release gates. The cache proof is local: `no-store` responses, purge by host through a fixture and observed absence through `servePublic`.
- The back/forward-cache reset is implemented but not exercised, because routed Playwright pages do not enter the back/forward cache.
- If reduced motion turns on while the playback control has keyboard focus, the control hides and focus returns to the document. This is an uncommon OS-setting change during a visit; Phase 53's focus audit can revisit it.
- Full viewport/palette acceptance (Phase 53) and the Phase 39 full-page preview routes are not in scope.
- `pnpm lint` reports 8 existing warnings in `apps/web/components/editor.css` and `scripts/social-links-publish-browser.mjs`; none are in files this phase changed.
- The owner requested a separate withdrawal-boundary review after this phase; it was not started here.

Approval: the owner approved Phase 38 completion on November 7, 2026, after the local `full` gate, the diff summary and a hands-on check of the fixture pages. The roadmap box is checked in the same change. The owner-requested withdrawal-boundary review remains separate.

## Documentation impact

Changed assumptions: Face Reveal and playback were described as future work; the display model never carried the second photo; the preview envelope allowed two profile images; the renderer version was `publication-v4`.

Updated guidance: the [components README](../../packages/components/README.md) (model, envelope, avatar markup, script behavior, platform CSS, streaming sides and renderer version); [avatar decorations](../../docs/avatar-decorations.md), the [catalog](../../docs/appearance-catalog.md) and [architecture](../../docs/architecture.md) phase notes and pause policy; the [implementation baseline](../../docs/implementation-status.md) (new row, and the Phase 35 row's version note); and the roadmap entry (record link, approval and checked box). Historical Phase 16, 17, 26, 35 and 37 evidence is unchanged.

Unresolved prerequisites: the deployed S-9 withdrawal check and paid-provider verification (release gates); the owner-requested withdrawal-boundary review; Phase 42E activation.
