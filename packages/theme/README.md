# @hasaweb/theme

`@hasaweb/theme` exports `appearanceCatalog`. `@hasaweb/theme/palette` exports `generatePalette`, `resolvePalette` and their types; the separate entry keeps Culori initialization out of catalog-only consumers. See the [appearance catalog](../../docs/appearance-catalog.md) for the IDs, tokens, fonts, decorations and defaults.

`src/catalog.test.ts` checks IDs, draft compatibility, font assets and licenses, decoration digests, declared contrast pairs and drift from the recorded Figma palettes (`src/figma-palettes.json`). `src/renderer-assets.test.ts` checks the generated `themes.css` and shipped fonts against the catalog.

## Custom palette contract

`generatePalette(seed)` accepts exactly one opaque six-digit hex color, such as `#4285fa`. Unsupported input throws `TypeError`. Its result contains the lowercase `seed`, `light` and `dark` palettes, and `adjustments`. Each palette has the catalog's fourteen semantic tokens. No owner CSS or individual token input is accepted.

Culori converts the seed to OKLCH. Surface and ink tones use the seed hue with lower chroma. Button colors use a darker light-mode fill and a lighter dark-mode fill. Neutral seeds remain neutral except for semantic errors. Chroma reduction keeps generated colors inside sRGB while preserving hue. Contrast correction tests the final six-digit hex values after quantization.

Text, muted text, links, and errors meet 4.5:1 against `page`, `surface`, and `raised`. `control` and `focus` meet 3:1 against those surfaces. `onAccent` meets 4.5:1 against `accent`, `hover`, and `pressed`. The `border` token is decorative. Controls need the `control` boundary and an offset `focus` ring, as specified in the catalog. These checks implement the [confirmed WCAG 2.2 AA thresholds](../../docs/acceptance-criteria.md#verification-prerequisites).

Each adjustment has a `kind`, `mode`, affected `tokens`, and a plain-language `message`. Kinds are `accent-lightness`, `gamut`, and `contrast`. Consumers show these explanations alongside the color control. The saved seed remains the owner's original color. Derived palettes do not need persistence.

`resolvePalette({themeId, customColor?})` accepts the corresponding draft appearance fields. It rejects unknown preset IDs, including when a custom seed is present. It returns `source: "custom"` with generated values when the seed is present. Omitting `customColor` returns `source: "preset"` with exact copies of the selected approved palettes and no adjustments. Reset removes the seed while preserving `themeId`, content, fonts, and mode. Neither function mutates the catalog or its inputs. These synchronous functions perform no I/O.

`vitest run packages/theme/src` checks all approved presets, a 17-level sRGB cube, a hue/lightness/chroma sweep, neutral and saturated extremes, deterministic output, seed validation, explanations, and preset reset. The contrast assertions use an independent WCAG calculation.

Presets and fonts reach the preview and every published page type through retained generated CSS (`themes.css`). `PORTFOLIO_TOKENS` maps the ten `--pf-*` properties the portfolio CSS reads to palette tokens. `customPaletteProperties(seed)` returns the 20 `--pf-custom-{light,dark}-*` values for a seed, and `customPaletteCss(seed)` returns them as one `:root` rule. Publication retains that rule as a content-hashed stylesheet; the preview sets the same properties through the CSSOM. The `themes.css` rules for `[data-custom-color]` read them. `scripts/generate-renderer-avatar.mjs` keeps its own copy of the token map, and `renderer-assets.test.ts` checks the two agree.
