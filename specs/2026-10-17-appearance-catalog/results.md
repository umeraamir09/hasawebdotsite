# Phase 11E results

The owner-requested catalog revision is implemented on `feat/appearance-catalog`, October 17, 2026. The approved catalog contains six themes with twelve light/dark palettes, three fonts and two imported animated decorations. Product, acceptance criteria, architecture, onboarding, UI direction and dependent roadmap phases now use that scope. The owner approved the catalog, defaults, playback policy, documented generator exception and phase completion on October 17, 2026. Phase 11E is checked off.

## Approved decision

[The catalog decision](../../docs/appearance-catalog.md) records Leaf, Violet, Clay, Matcha, Strawberry and Coffee; DM Sans, Manrope and Lora; and only Ginger cat (`cat`) and Hands (`hands`). The static Leaf/Orbit/Frame decoration proposals and files are removed. Defaults remain `portfolio-v1`, `leaf`, `dm-sans`, `system`, no custom color or decoration, Face Reveal off and empty owner fields. Template identity is catalog metadata, not a new draft schema field. No provisioning endpoint consumes these approved defaults yet.

[`catalog.json`](../../packages/theme/catalog.json) freezes the semantic values, local font assets/licenses, decoration runtime/source paths, geometry, timing and digests. The three added themes retain their reference image filenames, extracted anchor colors and Figma collection/board IDs. The [Figma palette export](figma-palettes.json) records their resolved Light/Dark values, re-read through connected MCP. Every added semantic value matches that read. There were no Figma writes during this integration. The earlier palette-board creation was separately requested by the owner.

The [faithful avatar import](../2026-10-17-avatar-decoration-import/results.md) remains unchanged. Its cat uses the original cleaned 212 × 220 WebP, 32 frames, infinite loop and 3,920 ms cycle; hands retains all six-second poses, flourishes, hearts and sparkles. The approved production policy is autoplay with reduced-motion still states and a separate keyboard-accessible pause/play control, independent of Face Reveal. That control is assigned to Phase 38 and is not claimed as implemented in the source review.

## Current verification status

The catalog, faithful import, documentation alignment and evidence-formatting repair are implemented. Final technical verification passed on October 17, 2026, after regenerating both browser evidence files. The earlier lint failure is resolved. The owner subsequently approved the catalog, defaults, playback policy, documented generator exception and completion; the catalog is approved and Phase 11E is checked off.

- `node scripts/appearance-catalog-browser.mjs` passes all 162 combinations and writes the twelve-specimen evidence and refreshed screenshots.
- `node scripts/avatar-decoration-browser.mjs` passes all eight scenario groups. The compositor captured 152 painted frames, with 21 and 27 distinct cat states across the two loop windows. Both wipe directions, hands choreography, keyboard behavior, skeleton states and reduced motion pass.
- Both scripts save their JSON through `scripts/lib/write-json-evidence.mjs`, which uses the installed Biome CLI and repository configuration before writing. The generated evidence passes lint without a separate manual formatting step.
- `pnpm check` passes Biome across 300 files, all 12 workspace typecheck tasks and all 218 unit tests across 20 files. Eleven typecheck tasks use valid cached results; the theme task runs again.
- `pnpm build` succeeds for all 12 tasks. Eleven use valid cached results, including the unchanged web build; the theme task runs again. No deployment occurred.
- `npm run generate:avatar` reproduces the exact documented guard failure and exits nonzero. Its safe wrapper restores both clean outputs; all 11 imported-file digests match afterward. This remains the narrow documented exception, not a passing regeneration run.

The technical closure changes verification tooling and evidence only. Catalog values, defaults, source components, generator, assets and production scope remain unchanged. The earlier read-only audit also independently confirmed source parity, all 84 added values against live Figma, all 252 contrast pairs, 54 actual-schema empty-draft combinations and 108 decoration selections. All 14 TypeScript configurations passed in that audit. Its full Vitest run was blocked by the no-file-write restriction; the subsequently authorized normal run above now verifies all 218 tests.

## Recorded implementation verification

- The original implementation's `pnpm check` run passed all 218 unit tests before the audit identified the later generated-evidence formatting failure. The final run above now passes after evidence generation. The catalog contributes 22 tests, including six additional contrast cases and Figma-token parity. Empty-draft checks cover every theme/font/mode and both optional decoration IDs without inserted identity, content, photos or defaults. Source-import tests cover the preserved component/assets and metadata.
- The original implementation build passed all 12 tasks, including fresh theme and Next.js/OpenNext builds, with ten other tasks cached. The final run above reuses the unchanged web build. The actual avatar review route is prerendered. No deployment occurred.
- [`browser-results.json`](browser-results.json) records Chromium `154.0.8037.57`, all twelve palette specimens and 162 combinations: six themes × three fonts × three initial modes × three widths, 360, 768 and 1280 px. Every rendered semantic token matches the selected catalog palette. Fonts load locally, system mode responds to a preference change, and keyboard focus is visible. There is no horizontal overflow or browser error.
- Current [desktop](review-desktop.png), [mobile Strawberry](review-mobile.png), [Matcha](review-matcha.png) and [Coffee](review-coffee.png) screenshots cover the expanded review. Matcha's full matrix and the mobile Strawberry specimen were visually inspected. The review has no storage integration and serves only its HTML and listed fonts. An unlisted repository file returns 404.
- The source-import [browser evidence](../2026-10-17-avatar-decoration-import/browser-results.json) was refreshed during final technical verification. It records both portrait wipe directions for both variants, two on-screen cat loops, all hands animation families, keyboard behavior, motion-preference changes, loading/cached/error images and responsive geometry. Decoration checks use the actual React component at port 3000 rather than a static reimplementation. The source, wrapper and assets remain unchanged.

The measured minima below use exact sRGB luminance. All declared normal text pairs meet 4.5:1; control/focus indicators meet 3:1. Soft separator borders are decorative. Primary controls use the declared control boundary.

| Theme/mode | Lowest text pair | Ratio | Lowest control pair | Ratio |
| --- | --- | --- | --- | --- |
| Leaf light | muted/surface | 5.76:1 | control/surface | 3.43:1 |
| Leaf dark | muted/raised | 6.41:1 | control/raised | 3.92:1 |
| Violet light | muted/surface | 4.72:1 | control/surface | 3.55:1 |
| Violet dark | link/raised | 6.11:1 | control/raised | 4.55:1 |
| Clay light | onAccent/accent | 4.89:1 | control/surface | 3.12:1 |
| Clay dark | link/raised | 6.54:1 | control/raised | 4.27:1 |
| Matcha light | onAccent/accent | 4.81:1 | control/surface | 3.47:1 |
| Matcha dark | muted/raised | 6.64:1 | control/raised | 3.98:1 |
| Strawberry light | muted/surface | 5.04:1 | control/surface | 3.31:1 |
| Strawberry dark | muted/raised | 7.39:1 | control/raised | 4.07:1 |
| Coffee light | error/surface | 6.08:1 | control/surface | 3.36:1 |
| Coffee dark | muted/raised | 7.58:1 | control/raised | 4.02:1 |

## Scope carried into later phases

The catalog decision assigns the required work to existing phases: provisioning in 12, shared owner-data markup and envelope/assets in 16, approved-ID membership validation in 23, retained clean animation/still or hands CSS/SVG assets in 24–25, six preset controls/fonts/modes in 35, custom-color generation in 36, gallery and Face Reveal setup in 37, and production animation playback/reveal/withdrawal in 38. Full browser/viewport acceptance remains Phase 53. Criterion 4.15 now explicitly covers independent decoration playback. No additional template, onboarding appearance step, owner SVG/CSS upload or schema migration is introduced.

The public renderer must preserve the art/choreography through shared markup, CSS and vanilla behavior with zero React hydration. It uses each owner's accepted images and the product's accessible labels. The source's Umer portraits/labels remain review fixtures. Raw cat regeneration inputs, tooling and source portrait fixtures are excluded from owner publication manifests. Defaults, fonts and the single-template contract are unchanged by the three additions.

## Regeneration exception

The verbatim generator still fails its exact-byte guard on Node `22.22.1`, sharp `0.35.5`, libvips `8.18.7` and libwebp `1.6.0`. The diagnostic found hidden RGB-byte changes beneath transparent pixels, zero alpha or visible RGB differences, and unchanged frame count, delays and loop flag. This is a documented failure, not a passing regeneration result. The safe package command restores both original clean assets on failure, and source-digest checks pass. [The import guide](../../docs/avatar-decorations.md#observed-environment-limitation) records the exact problem and workflow.

The requested import explicitly permits documenting an environment problem. The proposal can therefore freeze the verified source assets with this exception. Repairing the generator guard is a separate tooling change and is not silently folded into a faithful source port.

## Reproduce and approve

Run `node scripts/appearance-catalog-review.mjs --serve` for [the palette/font catalog](http://127.0.0.1:8791), and `pnpm dev:web --port 3000` for [the actual decorations](http://127.0.0.1:3000/catalog/avatar-decorations). Run `node scripts/appearance-catalog-browser.mjs` to refresh the expanded catalog evidence. The generated [review.html](review.html) also opens from disk with relative local font assets. WSL's default `pnpm` resolves to an incomplete Windows engine here; verification used `npm exec --yes --package=pnpm@12.11.2 -- pnpm ...`.

These are catalog and source-import checks in Chromium, not full release coverage or implementation of future appearance controls. Acceptance criteria 1 through 5 have implementation and verification evidence, including final passing checks after the formatting repair. Criterion 6 is satisfied by the owner's explicit approval below. Phase 12 can consume the approved defaults; later appearance controls remain in their existing phases.

The original three-theme/static-decoration review's 324 combinations and 204 unit tests are superseded by the current evidence above. The intermediate import review's 81 palette/font combinations are likewise superseded by the 162-combination six-theme run. Source-import animation evidence remains separate and was refreshed during final verification.

## Owner approval

On October 17, 2026, after technical verification and discussion of the generator limitation, the owner said: "okay, check off 11 e and open a pr". This approves the six themes/twelve palettes, three fonts, cat/hands geometry and playback policy, configured defaults and the narrow documented generator exception, and explicitly authorizes Phase 11E completion.

The approval is recorded in `packages/theme/catalog.json`. The catalog is exported as `appearanceCatalog`, the review shows its approved status, and the roadmap checkbox is checked. Provisioning, the public renderer, appearance controls and generator repair remain separate work; this approval does not implement them.
