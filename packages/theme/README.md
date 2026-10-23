# Approved appearance catalog

`@hasaweb/theme` exports `appearanceCatalog`. `@hasaweb/theme/palette` exports `generatePalette`, `resolvePalette`, and their types. The separate entry keeps Culori initialization out of catalog-only consumers. The owner approved the catalog and defaults on October 17, 2026. See [the catalog decision](../../docs/appearance-catalog.md) for the approved IDs, tokens, self-hosted font assets, decorations, defaults and phase boundaries.

The approved catalog contains six themes with twelve paired mode palettes, three fonts, and the imported Ginger cat/Hands pair. Matcha, Strawberry and Coffee match the reference-derived Figma collections; tests compare their values with the recorded export. The catalog also records the approved production motion policy, whose independent pause/play control belongs to Phase 38.

Generate the review with `node scripts/appearance-catalog-review.mjs` from the repository root. Add `--serve` to open it at `http://127.0.0.1:8791`; the server exposes only that review and its listed assets. The readable HTML/JS/CSS source is [review.template.html](review.template.html). The generated HTML embeds the manifest and uses local relative font URLs, so the palette/font review also opens from disk. Decoration rendering requires the linked React review server.

With the review server running, `node scripts/appearance-catalog-browser.mjs` checks each theme/font/mode combination at the three required widths in Chromium and records screenshots and browser evidence. The decoration cards link to the actual imported React component at `http://127.0.0.1:3000/catalog/avatar-decorations`; run the web development server and `npm run test:avatar:browser` for its animation and interaction checks. `vitest run packages/theme/src/catalog.test.ts` verifies IDs, draft compatibility, font assets/licenses, imported decoration file digests and the declared contrast pairs. These checks cover the catalog specimens and source import, not later public rendering or all release browsers.

## Custom palette contract

`generatePalette(seed)` accepts exactly one opaque six-digit hex color, such as `#4285fa`. Unsupported input throws `TypeError`. Its result contains the lowercase `seed`, `light` and `dark` palettes, and `adjustments`. Each palette has the catalog's fourteen semantic tokens. No owner CSS or individual token input is accepted.

Culori converts the seed to OKLCH. Surface and ink tones use the seed hue with lower chroma. Button colors use a darker light-mode fill and a lighter dark-mode fill. Neutral seeds remain neutral except for semantic errors. Chroma reduction keeps generated colors inside sRGB while preserving hue. Contrast correction tests the final six-digit hex values after quantization.

Text, muted text, links, and errors meet 4.5:1 against `page`, `surface`, and `raised`. `control` and `focus` meet 3:1 against those surfaces. `onAccent` meets 4.5:1 against `accent`, `hover`, and `pressed`. The `border` token is decorative. Controls need the `control` boundary and an offset `focus` ring, as specified in the catalog. These checks implement the [confirmed WCAG 2.2 AA thresholds](../../docs/acceptance-criteria.md#verification-prerequisites).

Each adjustment has a `kind`, `mode`, affected `tokens`, and a plain-language `message`. Kinds are `accent-lightness`, `gamut`, and `contrast`. Consumers show these explanations alongside the color control. The saved seed remains the owner's original color. Derived palettes do not need persistence.

`resolvePalette({themeId, customColor?})` accepts the corresponding draft appearance fields. It rejects unknown preset IDs, including when a custom seed is present. It returns `source: "custom"` with generated values when the seed is present. Omitting `customColor` returns `source: "preset"` with exact copies of the selected approved palettes and no adjustments. Reset removes the seed while preserving `themeId`, content, fonts, and mode. Neither function mutates the catalog or its inputs. These synchronous functions perform no I/O.

`vitest run packages/theme/src` checks all approved presets, a 17-level sRGB cube, a hue/lightness/chroma sweep, neutral and saturated extremes, deterministic output, seed validation, explanations, and preset reset. The contrast assertions use an independent WCAG calculation.

The [Phase 36 results](../../specs/2026-10-23-custom-colors/results.md) cover this pure generator increment. Owner controls and immediate iframe updates await Phase 35. Publication validation, all page types, retained generated CSS, final CSP delivery, and rendered axe checks await Phases 23 through 25 and 35. The renderer still uses its existing default-only display contract. No inline style or script exception is introduced. Importing this package does not activate appearance controls.
