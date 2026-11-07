# Phase 37: Decorations and Face Reveal setup

## Scope and acceptance

Requirements: [product section 4](../../docs/product.md) (avatar decoration and Face Reveal), [acceptance criteria 4.6 and 4.8–4.14](../../docs/acceptance-criteria.md#4-required-profile-images-and-social-identity), upload rules in [acceptance section 13](../../docs/acceptance-criteria.md#13-upload-handling), the [catalog decision](../../docs/appearance-catalog.md) and the [Phase 37 roadmap entry](../../docs/roadmap.md#phase-37-add-decorations-and-face-reveal-setup).

Changes:

- Owners select, change and remove the approved Ginger cat (`cat`) or Hands (`hands`) decoration. A new draft has none.
- Owners turn the optional Face Reveal second photo on and off, and upload, crop, replace, remove and describe it. A note says the published photo is publicly accessible.
- The display projection carries the saved decoration, so the preview avatar matches the published avatar.

Out of scope: onboarding controls, custom decoration uploads, the reveal interaction, the public pause/play control and public second-photo withdrawal proof (Phase 38).

Acceptance checks (the risks named in the task):

- Removal omits `decorationId`; it is never `null`.
- New drafts have no decoration and Face Reveal off.
- An enabled but incomplete Face Reveal blocks publication.
- Disabling Face Reveal retains the ready second photo privately.
- The saved selection equals the preview and the published avatar.

Prerequisites: Phase 35 (PR #47, `4d41f4a`) and Phases 11E, 16, 19, 23–26 are integrated. Phase 36's generation work is approved; its preview controls are not required here. Shared base: `origin/main` at `4d41f4a`. Branch `feat/37-decorations-setup`, worktree `.claude/worktrees/phase-37-decorations-setup`. No other worktree was changed.

Write boundaries:

- Display projection (`profile.decoration`), `PortfolioProfile` and the component README.
- Editor-only `AvatarExtrasControls` and `lib/editor/avatar-extras.ts`.
- The `face` crop purpose, which reuses the avatar crop size.
- The offline publication fixture's expected profile markup.
- Tests: a unit file, a render test and one new editor browser journey.

The draft schema, migrations, publication validation SQL, upload HTTP contract, dispatcher, finalization and `PUBLICATION_RENDERER_VERSION` are unchanged.

## Decisions

- **Existing publication rules already match.** Validation (Phase 23) already rejects an enabled Face Reveal without an image and an unknown decoration ID, and the asset check includes the `face` asset only while enabled. The candidate (Phase 24) already omits a disabled second photo, the dispatcher already renders the saved decoration into the avatar, and finalization already retains the cat art only when selected. No enabled-image rule conflicts with the product text, so nothing needed an owner decision. Activating selection therefore changed the display projection, not the manifest. The manifest side is proven by the new journey (the cat art and the second photo are public after Publish and 404 after the selection changes).
- **Projection.** `profile.decoration` is `none | cat | hands`. An absent key and an unknown historical ID both display `none` in preview, like `displayAppearance`. Publication validation still rejects the unknown ID with a correction. The field defaults to `none` when a fragment omits it. A unit test keeps the enum equal to the catalog. The Face Reveal image is not added to the projection, because Phase 38 owns its rendering.
- **Because the projection changed, the dispatcher output is unchanged.** The offline publication fixture swapped decorations into the expected profile by string replacement; it now renders the projected model directly, which is the same bytes.
- **Placement.** One "Avatar extras" section in the editor profile view, after the profile controls. `ProfileControls` and `ProfileImages` are untouched, so Phase 42 onboarding reuses them without these controls. The Customization panel's note now points to Profile.
- **Decoration choice uses native radios** ("No decoration", Ginger cat, Hands) instead of thumbnails. The source specimens carry the owner's review portraits and a fixed label, so the preview shows the real, animated result instead. Removal is the "No decoration" radio.
- **Face crop.** The second photo uses the avatar crop shape (848 × 880), so both images swap in place. `ImageUpload` takes the existing `face` upload purpose and the crop button reads `Crop {noun}`.
- **Retained photo.** Disabling keeps `faceReveal.image` in the draft. The section says it is saved privately. Re-enabling restores it.
- **Preview assets.** The preview references the cat art at `/portfolio-platform/{hash}-…webp`, the same retained platform path as the fonts. The editor harness serves it. This phase does not change how the deployed web app serves that path.

## Results

Local gate: `pnpm verify --profile=full` passed on November 7, 2026 on base `4d41f4a` plus the uncommitted Phase 37 working changes (run `2026-11-07T13-07-12.858Z-iwyz2t`; later edits were this record only). The `full` profile is required because the change touches the shared display model, the publication fixture and the editor. All 14 commands exited 0:

- `pnpm check`: 531 unit tests.
- Renderer browser: 30 groups. Private uploads: 11. Publication dispatch: 43 S-8 integration groups. Publication serving: 4.
- Draft API: 19 groups. Editor browser: 53, including the new journey.
- Auth, persistence (88 checks), autosave, runtime smoke and routing (31 boundaries).

Proof for each named risk:

| Risk | Where it is proven |
| --- | --- |
| Removal omits `decorationId`, never `null` | Unit (`avatar-extras.test.ts`): the key is absent and the serialized draft has no `decorationId`. A `null` value fails the draft schema. Journey: after cat → hands → No decoration, the stored draft JSON text contains no `decorationId`. |
| New drafts have no decoration and Face Reveal off | Unit on `createEmptyDraft`. Journey: the stored draft has no key, `faceReveal` is `{enabled:false}`, "No decoration" is checked, the checkbox is unchecked and no second-photo input exists. |
| Enabled but incomplete upload blocks publication | Journey: turning it on shows the error beside the input, Publish lists "Complete your Face Reveal image" and nothing is published (the site returns 404). Uploading a cropped photo clears the error. Removing it brings the error back. Existing publication SQL covers the server rule. |
| Disabling retains the ready photo privately | Unit and journey: the draft keeps the same asset ID, the asset row stays `ready`, and re-enabling restores it without a new upload. After republishing, the former public URL returns 404. |
| Saved selection equals preview and manifest | Unit: the projected profile contains the shared decorated avatar markup. Journey: the canonical avatar tree of the preview equals the published one for cat, hands and none. The cat art URL serves after publishing the cat and returns 404 after switching to hands. The 43 S-8 groups still pass with the simplified expected markup. |

Other journey checks: the crop is 848 × 880; arrow keys move the decoration radios; axe finds no WCAG 2.2 AA violations in the new section; the second photo is fetchable only after it is published.

Limitations:

- The reveal interaction, the visitor pause/play control, reduced-motion stills in public and deployed withdrawal of the second photo are Phase 38. This phase only proves the setup and the stored/published assets.
- Not run: the S-9 deployed check, mobile-width screenshots of the new section and a Figma comparison. The Avatar extras section reuses the Phase 35 radio styles. No Figma frame for it was consulted, and the Figma file was not changed.
- `pnpm lint` reports existing warnings (for example `scripts/social-links-publish-browser.mjs`); none are in files this phase added.
- No separate high-risk review was requested. The change is an ordinary one: editor controls and a display-only projection. The publication boundary itself is unchanged.

Approval: the owner approved Phase 37 completion on November 7, 2026, after the local `full` gate and the diff summary. The roadmap box is checked in the same change.

## Documentation impact

Changed assumption: the display projection never carried a decoration, so the preview could not show a saved selection and the fixture patched markup. Updated: the [components README](../../packages/components/README.md), the [catalog doc](../../docs/appearance-catalog.md) phase note, the [implementation baseline](../../docs/implementation-status.md) (new row, and the appearance row no longer says selection is inactive) and the roadmap entry (record link only; the box stays unchecked). Historical Phase 16 and 24 evidence is unchanged.

Unresolved prerequisites: Phase 38 for the reveal interaction, pause/play and deployed withdrawal; the deployed web app's serving of `/portfolio-platform/*` for the preview, which fonts already rely on; Phase 42E activation.
