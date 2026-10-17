# Approved appearance catalog

`@hasaweb/theme` currently exports only `appearanceCatalog`. The owner approved the catalog and defaults on October 17, 2026. Provisioning and production controls remain in their scheduled phases. See [the catalog decision](../../docs/appearance-catalog.md) for the approved IDs, tokens, self-hosted font assets, decorations, defaults and phase boundaries.

The approved catalog contains six themes with twelve paired mode palettes, three fonts, and the imported Ginger cat/Hands pair. Matcha, Strawberry and Coffee match the reference-derived Figma collections; tests compare their values with the recorded export. The catalog also records the approved production motion policy, whose independent pause/play control belongs to Phase 38.

Generate the review with `node scripts/appearance-catalog-review.mjs` from the repository root. Add `--serve` to open it at `http://127.0.0.1:8791`; the server exposes only that review and its listed assets. The readable HTML/JS/CSS source is [review.template.html](review.template.html). The generated HTML embeds the manifest and uses local relative font URLs, so the palette/font review also opens from disk. Decoration rendering requires the linked React review server.

With the review server running, `node scripts/appearance-catalog-browser.mjs` checks each theme/font/mode combination at the three required widths in Chromium and records screenshots and browser evidence. The decoration cards link to the actual imported React component at `http://127.0.0.1:3000/catalog/avatar-decorations`; run the web development server and `npm run test:avatar:browser` for its animation and interaction checks. `vitest run packages/theme/src/catalog.test.ts` verifies IDs, draft compatibility, font assets/licenses, imported decoration file digests and the declared contrast pairs. These checks cover the catalog specimens and source import, not later public rendering or all release browsers.

`generatePalette`, CSS delivery, asset hosting, provisioning, appearance controls and publication membership checks remain in their scheduled phases. Importing the catalog does not provision a draft or activate appearance controls.
