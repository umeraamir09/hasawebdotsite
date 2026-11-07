# Phase 35: Preset appearance controls across pages

## Scope and acceptance

Requirements: [product section 12](../../docs/product.md#12-themes-custom-color-fonts-and-lightdark-mode), [acceptance criteria 12.1, 12.2, 12.6 and 12.7](../../docs/acceptance-criteria.md#12-themes-custom-color-fonts-and-lightdark-mode), [acceptance 16.3](../../docs/acceptance-criteria.md#16-public-visitor-experience) and the [Phase 35 roadmap entry](../../docs/roadmap.md#phase-35-add-preset-appearance-controls-across-pages).

Changes:

- Owners save exactly six presets (Leaf, Violet, Clay, Matcha, Strawberry, Coffee), three curated self-hosted fonts (DM Sans, Manrope, Lora) and an initial light, dark or system mode.
- The saved appearance applies in the preview and on every real public page type (portfolio, `/projects/{slug}`, `/resume`) without changing content, order or template.
- Theme and mode are correct from the first painted frame under the existing CSP. There is no owner CSS and no inline script.

The catalog is the Phase 11E decision, reused unchanged. Out of scope: custom-color controls and generated-token delivery (Phase 36 integration), decorations and Face Reveal (37–38), full-page draft navigation (39) and production activation (42E).

Prerequisites: Phases 11E, 16, 17, 25, 30 and 34 are owner-approved and on `main`. Shared base: `main` at `64f548c`. Branch `feat/35-preset-appearance`, worktree `.claude/worktrees/phase-35-preset-appearance`. No delegated workers.

Write boundaries:

- Components: the display-model `appearance` field, the new `appearance.ts`, the visitor-mode script, the preview mount and the generated `themes.css`, fonts and manifest.
- Renderer `documentShell`.
- Publication finalization (page shells and the retained font) and the renderer version.
- Editor `AppearanceControls` in the Customization panel.
- The asset generator, tests and browser journeys.

The draft schema, migrations, publication validation SQL, site serving and CSP are unchanged.

## Decisions

- **First-paint initialization.** On November 7, 2026 the owner chose a render-blocking platform script over an inline script with a reviewed CSP hash. Saved theme, font and owner initial mode need no script: `documentShell` writes `data-theme`, `data-font` and `data-initial-mode` on `<html>`, and the generated CSS reads them. The visitor's stored light/dark choice is the only state that needs script before paint. The existing content-hashed `/platform/*.js` file now loads without `defer` in `<head>`, after the stylesheet. Its first statement copies a stored `hasaweb-color-mode` to `data-color-mode` before `<body>` exists. Controls attach at `DOMContentLoaded`. This adds no request, no CSP change and no inline code. HTML parsing waits for that small script, which downloads in parallel with the already render-blocking stylesheet.
- **Mode precedence.** The visitor's explicit choice wins. Otherwise the owner's light or dark applies; system follows `prefers-color-scheme`. CSS implements the same rule, so it holds even before or without the script. Storage is per origin, so a choice follows the visitor across one portfolio's pages.
- **Preview.** `mountPreview` applies the model's appearance to the iframe document. Its toggle uses an in-memory store: the choice survives content edits, resets when the saved mode changes, and is never stored.
- **Display model.** `PortfolioModel.appearance` is optional (absent means defaults) and strict to catalog IDs. The projection drops `customColor`. For an unknown historical ID, the preview shows the defaults. Publication validation (Phase 23) rejects that ID with a correction; finalization's strict parse fails the candidate rather than publish a different appearance.
- **Fonts.** All three faces are in the platform package and declared in `themes.css`. Each candidate retains only its saved font file, the same rule as the cat art. A browser downloads only the family that `data-font` selects.
- **Renderer version.** An in-flight candidate could pair an old platform script, which runs `installSite` immediately, with the new blocking shell, and its toggle would never attach. `PUBLICATION_RENDERER_VERSION` is therefore `publication-v4`, so unfinished `publication-v3` candidates follow the existing renderer-policy rejection.
- **Controls.** The Customization panel has native radio groups for Theme (six, with light/accent/dark swatches), Font and Starting mode, written through `controller.update`. Custom color and decorations keep a note that they come later. No Figma frame for this panel is recorded in [the UI direction](../../docs/ui-direction.md), so the controls reuse the existing editor field styles.

## Results

Defects found and fixed during testing:

- **Every Publish failed.** Finalization rejected the platform pack as "Incomplete" because it now held three fonts, while the check requires exactly one. The S-8 dispatch case reproduced it. Fixed by retaining only the saved font, as described above.
- **Stale editor assertion.** The first full gate run (`2026-11-07T08-33-01.120Z-TiwIH6`) failed in the editor group `stable selection, unfinished raw input and sample acceptance`. Every suite before it passed: 523 unit tests, renderer (30 groups), auth, persistence, uploads, publication dispatch (43) and serving, draft API and autosave. The group still asserted the old "Leaf palette" placeholder. Its fixture draft stores non-catalog IDs (`fixture-theme`). The assertion now checks that six presets are listed and that the panel says the saved theme is no longer available.
- **Fixture script.** The renderer fixture bundled its own `portfolio-site.ts`, which would break once loaded as a blocking script. The fixture now bundles the real `site-entry.ts`, so it tests the shipped file.

## Verification

| Risk | Evidence |
| --- | --- |
| No wrong theme or mode on first paint (system, light, dark) | Renderer browser: an init script samples the computed `<html>` background and font in every `requestAnimationFrame` from the first rendering opportunity. The platform script is held for 400 ms. All 18 combinations of owner initial mode × system preference × stored visitor choice (none/light/dark) are covered, rotating through all six presets and three fonts. Every painted frame shows the expected preset color and font. A control with the old `defer` placement does paint the owner's light mode first and then switches, which shows the sampler detects a flash. |
| Same check on real published pages | Editor journey `saved preset, font and initial mode apply…` publishes through the real dispatcher and site Worker. The platform script is held for 300 ms, and the sampler runs on `/`, `/projects/theme-demo` and `/resume`. (1) Strawberry/Lora/dark with a light system setting. (2) After a second Publish, Coffee/Manrope/system with dark and then light system settings. Every frame is correct on every page type. |
| Visitor switching on each page type, surviving navigation | The same journey switches on `/`, follows `Read case study`, switches back, uses `Back to portfolio` and `View resume`, then switches on `/resume`, goes back and reloads. Each page paints the last choice from its first frame, and the button label matches. With system mode, switching works on all three pages. |
| CSP stays strict; no inline script | Unit: `documentShell` emits exactly one `<script src>` with no `defer`/`async`, no inline script or style, and rejects non-catalog values. The public CSP string is unchanged, and public and preview policies contain no `unsafe-`, `sha256-` or `nonce-`. Journey: every published page has one external head script, and its CSP has no hash, nonce or unsafe source. The existing renderer check that inserted inline scripts are blocked still passes. |
| Font and preset parity, preview vs. platform delivery | Unit (`packages/theme/src/renderer-assets.test.ts`): `themes.css` holds the exact catalog tokens for all six presets in both modes. Each shipped font equals the catalog bytes (SHA-256), its manifest path carries that hash, and its OFL notice matches. Renderer browser: preview and public pages for Violet/Lora/dark give identical computed background, font and mode, and only the selected font is fetched and loaded. Journey: the preview loads the self-hosted Lora face. The published site serves Lora and later Manrope with the catalog SHA-256. The published body is byte-identical across the two appearances, apart from candidate-specific asset URLs. |
| Controls | Journey: exactly six theme, three font and three mode radios in catalog order. Arrow-key selection works and updates the preview immediately. The saved draft holds the selection. axe WCAG 2.2 AA finds no violations in the panel. |
| Accessibility of presets | Renderer browser: axe WCAG 2.2 AA passes for all six presets in light and dark. |
| Publication output | S-8 dispatch: documents start with the appearance attributes and end the head with the blocking script. The manifest retains exactly one font. |

Local gate: `pnpm verify --profile=full` (run `2026-11-07T08-49-45.054Z-L1V7FG`, base `64f548c`, uncommitted working tree) was stopped by the owner after 33 minutes, 20 seconds into `test:runtime`. The 11 commands that finished all exited 0:

- `pnpm check`: 523 unit tests.
- `pnpm build`.
- Renderer browser: 30 groups.
- Auth browser: 19 checks.
- Persistence.
- Uploads: 11 groups.
- Publication dispatch: 43 groups.
- Publication serving: 4 groups.
- Draft API: 19 groups.
- Autosave.
- Editor browser: 52 groups, including the new appearance journey.

Not run in this gate: `test:runtime`, `test:runtime:smoke` and `spike:routing`. Only this record changed during the run. On November 7, 2026 the owner chose to skip those three suites rather than run them separately, so they remain unverified for this change.

Not verified:

- No deployed or provider check. Public platform files are `no-store` until S-9, so each navigation re-fetches the blocking script and the font. This is measured locally only; real latency cost is not.
- First paint is checked in headless Chromium only. Other engines are part of the Phase 53 matrix.
- The toggle's label text is set at `DOMContentLoaded`. The page colors are correct from the first frame, but the label is not checked separately at first paint.
- No separate publication boundary review has been run. The change alters published document output and per-version retained files, so the workflow calls for one before release.

## Documentation impact

Changed assumptions:

- The renderer is no longer default-only.
- The document shell carries saved appearance attributes and loads the platform script render-blocking in `<head>`.
- `default-theme.css` is replaced by the generated `themes.css` (all presets and fonts).
- Each publication retains its saved font.
- The renderer version is `publication-v4`.
- The custom color is ignored until Phase 36 integration.

Updated guidance:

- [Architecture](../../docs/architecture.md) section 9.3.
- [Appearance catalog](../../docs/appearance-catalog.md).
- [Components README](../../packages/components/README.md), [render README](../../packages/render/README.md) and [theme README](../../packages/theme/README.md).
- [Implementation status](../../docs/implementation-status.md) and the [roadmap](../../docs/roadmap.md) record link (unchecked).

Historical specs (Phases 11E, 16, 30, 34, 36) keep their original statements.

Unresolved prerequisites: owner completion approval, custom-color integration (Phase 36), S-9 deployed cache behavior, and Phase 42E activation.
