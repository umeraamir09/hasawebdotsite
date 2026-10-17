# Avatar decoration import results

The faithful component import is implemented on October 17, 2026. Both variants work in the independent review. The unchanged source generator has the environment limitation below, which the owner's definition of done explicitly permits documenting. The owner subsequently approved the integrated revised catalog and Phase 11E completion on October 17, 2026, accepting the generator exception.

## Source fidelity and integration

The [source manifest](source-manifest.json) records the working files copied from `umers-portfolio-website` at commit `88a9dc7d5128d361164243932e8bacb7cdf52730`. The 208-line avatar component differs only in its asset-map import. Its 382-line CSS module, 63-line image loader, 91-line regeneration script and all seven listed image/mask assets match source hashes exactly. The user's support-file list contains seven assets plus the generator; all eight named support files are included.

The web app already runs React 19.3 with CSS Modules. A separate `ProfileAvatarSlot` supplies the original variable values and enough space around the absolute source frame. The global skeleton contract is copied verbatim. The two-entry asset map is local, and running the component does not access the source checkout. The source fonts, Tailwind configuration and profile-page layout were not copied.

The approved decoration catalog contains `cat` and `hands`. The three old static SVG proposals have been removed. Image animation and SVG/CSS implementations have separate catalog metadata and file digests. The palette review links to the actual React component rather than simulating it. Portfolio defaults remain no decoration and Face Reveal off. Umer's pictures are explicit public review fixtures, never provisioned owner data.

## Verification

The unit/build/runtime entries and the 81 palette combinations below are historical import-time results from before the six-theme revision. The browser JSON and screenshots were refreshed during final Phase 11E verification; the browser observations below describe that new run. The [current Phase 11E results](../2026-10-17-appearance-catalog/results.md#current-verification-status) record the final passing 218-test workspace check and 162 catalog combinations.

- `pnpm check` passes lint, all 12 workspace typechecks and all 211 unit tests across 20 files. Source/hash checks cover every imported file and the one allowed import substitution. Asset checks verify 212 × 220, 32 frames, identical raw/clean delays, loop `0`, a 3,920 ms cycle, and the one-frame reduced-motion still.
- `pnpm build` passes all 12 package builds, including Next.js/OpenNext and Worker dry runs. The new `/catalog/avatar-decorations` route is statically prerendered. No deployment occurred.
- `pnpm test:runtime` passes the three-Worker smoke test, D1, three R2 buckets, services, Queue, Workflow and restart persistence. Its normal local fixtures were seeded; no production data was touched.
- [Browser evidence](browser-results.json) records Chromium `154.0.8037.57` and eight successful scenario groups. Delayed images show skeletons, loading preserves wrapper/button bounds, cached images recover, and blocked photos retain their error skeletons. Both variants pass click/wipe tests in both directions, the in-progress click guard, hidden-image states and stable image bounds. Enter/Space and visible focus work. Reduced motion selects the cleaned still, stops hands/shimmer and skips new wipes. Switching motion preference during a wipe releases the source guard.
- The refreshed compositor check observed 152 painted frames over two full cat cycles. The isolated cat region had 21 distinct states in the first observation window and 27 in the second, with no clicks, DOM mutations, forced screenshots or live CSS filter. All seven hands animation families retain their six-second infinite choreography. The 360/768/1280 checks confirm the source 104/124 px responsive buttons and no page overflow.
- [Desktop](desktop.png) and [mobile](mobile.png) review screenshots were visually inspected. The complete cat and hands remain visible with the source geometry. There are no browser exceptions, and component resources stay on the local host.
- The separate palette/font review passes its revised 81 combinations at the required three widths, with no browser errors or third-party asset requests. Decoration animation checks now run against the actual component rather than static palette specimens.

The source browser test's canvas sampling method was investigated before adapting it. Canvas `drawImage` uses an animated image's default/first frame by the [HTML standard](https://html.spec.whatwg.org/multipage/canvas.html). Chromium followed that rule, so a constant canvas sample was not evidence of a frozen on-screen cat. The committed test observes compositor frames instead and crops only the cat region after recording; it does not alter the component or animation.

## Regeneration limitation and recovery

`npm run generate:avatar` runs the unchanged generator with sharp `0.35.5`. On Node `22.22.1`, libvips `8.18.7` and libwebp `1.6.0`, its exact-byte guard exits with `Encoding changed the cleaned frames or animation timing.` This is recorded as a failure, not a passing regeneration check.

A diagnostic copy restricted its outputs to temporary files. It showed the same 32 frames, every delay and loop `0`. There were 1,021,531 RGB-byte differences beneath fully transparent pixels, zero alpha differences and zero visible RGB differences. The checked-in generator was neither edited nor bypassed.

The original cleaned source files were restored. A separate safe integration wrapper now backs up both outputs before invoking the original generator and restores them on failure. Its failed invocation was exercised, followed by passing source-digest tests. Thus a package-script failure preserves the actual reviewed assets and reports a nonzero exit. [The usage guide](../../docs/avatar-decorations.md) gives both package commands and the unwrapped source command.

## Remaining phase boundaries

The exact source component retains its Umer-specific asset map and fixed accessible button name. Its pressed/title/hidden-image behavior is preserved. The import does not claim general owner identity handling, the product's later `Reveal face`/`Show avatar` labels, production markup-only portfolio rendering, owner selection controls, publication/withdrawal, full release browser coverage or production pause/play controls. Those remain in their existing phases. The playback policy is recorded in the catalog decision and was approved in Phase 11E.

At the time of this import, Matcha, Strawberry and Coffee were separate Figma palette proposals. The subsequent [Phase 11E catalog reconciliation](../2026-10-17-appearance-catalog/results.md) integrates their exact values, records the production playback policy and updates scope. The owner subsequently approved the final catalog and Phase 11E completion on October 17, 2026. No Figma file was modified by this import.
