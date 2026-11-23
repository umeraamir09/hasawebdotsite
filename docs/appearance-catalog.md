# Appearance catalog

The approved themes, fonts, decorations and defaults. The source of truth is [`packages/theme/catalog.json`](../packages/theme/catalog.json), exported as `appearanceCatalog` from `@hasaweb/theme`, with exact token values, asset paths, font weight ranges, provenance and SHA-256 digests. Keep IDs stable once drafts use them and retain referenced asset versions. Unknown stored IDs fail publication validation with an owner correction; they never silently become another appearance.

## Template and defaults

| Setting | Value | Stored as |
| --- | --- | --- |
| Template | Portfolio: fixed profile then stacked optional sections | `portfolio-v1` (no draft field) |
| Theme | Leaf | `appearance.themeId = "leaf"` |
| Font | DM Sans | `appearance.fontId = "dm-sans"` |
| Initial mode | System | `appearance.colorMode = "system"` |
| Custom color | None | `appearance.customColor` omitted |
| Decoration | None | `profile.decorationId` omitted (there is no `none` ID) |
| Face Reveal | Off | `profile.faceReveal.enabled = false`, no second photo |

Themes and fonts never change layout. There is no appearance step in onboarding.

## Themes

| Name, ID | Light | Dark | Reference |
| --- | --- | --- | --- |
| Leaf, `leaf` | Paper `#f7f8f5`, ink `#20241e`, lime `#bdeb70` | Night `#171c16`, text `#eef3e9`, lime `#bdeb70` | Brand and dark foundations |
| Violet, `violet` | Lilac `#eadcfa`, plum `#7934ad` | Plum `#2d1a3d`, lilac `#d19af4` | Geometric profile example |
| Clay, `clay` | Cream `#fff0d6`, terracotta `#c83b20` | Brown `#34211b`, peach `#ffa56b` | Illustrator profile example |
| Matcha, `matcha` | Milk foam `#f9f9e6`, olive `#6b770e` | Deep tea `#171d10`, matcha `#bdca6a` | Figma `269:4` |
| Strawberry, `strawberry` | Vanilla `#fff5e0`, berry `#b10a09` | Berry `#281315`, blush `#f5b8a6` | Figma `269:223` |
| Coffee, `coffee` | Warm milk `#faf5ea`, espresso `#6d3b17` | Espresso `#1c100b`, crema `#e7b272` | Figma `269:442` |

Each mode defines `page`, `surface`, `raised`, `text`, `muted`, `accent`, `onAccent`, `link`, `control`, `border`, `hover`, `pressed`, `focus` and `error`.

- Text, muted text, links and errors reach 4.5:1 on all three surfaces.
- Accent labels use `onAccent` on normal, hover and pressed fills.
- `control` is for control boundaries (including around primary buttons); `focus` is an offset ring against a surface; `border` is a decorative separator, not a control indicator.
- Never use the bright accent as body text on light surfaces.

Matcha, Strawberry and Coffee copy their semantic values exactly from the Figma variable collections. `packages/theme/src/figma-palettes.json` freezes those values and `catalog.test.ts` fails on drift.

System mode follows the visitor's preference. An explicit visitor choice (stored in localStorage) overrides the owner's initial mode on every page of that portfolio.

**Custom colors.** The [OKLCH generator](../packages/theme/README.md#custom-palette-contract) builds paired palettes from a seed, adjusts them to WCAG 2.2 AA and explains each adjustment; without a seed the resolver returns the exact preset. The Style panel's Custom tile starts from the selected preset's accent, shows the generated light and dark pair and lists each adjustment in one line. Choosing a preset, or Reset, removes the seed. The [architecture](architecture.md#7-components-rendering-and-appearance) describes how the generated palette reaches the preview and published pages.

## Fonts

| Name, ID | Variable weights | Fallbacks |
| --- | --- | --- |
| DM Sans, `dm-sans` | 100–1000 | Arial, sans-serif |
| Manrope, `manrope` | 200–800 | Arial, sans-serif |
| Lora, `lora` | 400–700 | Georgia, Times New Roman, serif |

Fonts apply to the whole portfolio, case studies and resume page, independent of theme. Unmodified variable TTFs and their SIL OFL notices are in `packages/theme/assets/fonts/` (from Google's official font repository), frozen by digest. Published pages load content-hashed copies from the platform asset host and each publication retains only its saved font. No third-party font requests. Any later subsetting must record new digests and keep the licenses.

## Decorations

| Name, ID | Implementation |
| --- | --- |
| Ginger cat, `cat` | Cleaned animated WebP (212 × 220, 32 frames, 3,920 ms loop) and a still |
| Hands, `hands` | Inline SVG and CSS: curled, palm and nails poses, hearts and sparkles over six seconds |

The editor chooses a decoration from a gallery that reads this list: "None" first, then each entry in catalog order, every tile showing the owner's banner and avatar wearing that decoration as a still (`PortfolioAvatar` with `still`). An entry may name a `category`. Once the catalog has more than eight entries the gallery adds a search field and one filter chip per category.

Both sit above the portrait and ignore pointer events. Portraits are 124 px on desktop and 104 px at widths up to 760 px. Decorative art is hidden from assistive technology.

**Motion policy.** The selected decoration autoplays, independent of Face Reveal. A separate keyboard-accessible Pause/Play control works with Face Reveal on or off; pausing shows the cat still or stationary hands without switching the portrait, and Play restarts the sequence. Reduced motion shows the stills, hides the control, stops shimmer and skips the reveal wipe, and preference changes apply immediately.

### Source reference component

The cat and hands are a faithful port from the owner's earlier portfolio, kept as a reference in `apps/web/components/` (`profile-avatar.tsx`, its CSS module and image loader, plus `profile-avatar-slot.tsx`). `apps/web/lib/avatar-import.test.ts` checks every imported file against its recorded digest, so do not edit them; only the asset-map import in `profile-avatar.tsx` differs from the source. Their fixed portraits and `Show photo of Umer Aamir` label are review fixtures, never owner defaults. Owner sites use the separate owner-data markup in `packages/components`, generated by `scripts/generate-renderer-avatar.mjs`.

Preview the reference with `pnpm dev:web --port 3000` at `/catalog/avatar-decorations`.

**Regenerating the cat.** `pnpm --filter @hasaweb/web generate:avatar` runs the unchanged source generator (`apps/web/scripts/generate-avatar-decoration.mjs`) through a wrapper that restores the reviewed files on failure. With Node 22.22.1, sharp 0.35.5, libvips 8.18.7 and libwebp 1.6.0, the generator's exact-byte guard fails on RGB changes under fully transparent pixels (zero visible or alpha differences). The checked-in clean assets are the accepted originals. Fixing the guard is a separate tooling change; do not redraw or simplify the art to work around it.
