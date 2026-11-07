# Approved appearance catalog

The owner approved this catalog and Phase 11E completion on October 17, 2026, including the defaults, playback policy and documented generator exception. [Roadmap Phase 11E](roadmap.md#phase-11e-approve-catalog-identifiers-and-portfolio-defaults) is complete. Production provisioning and appearance controls remain in their scheduled phases.

The versioned source of truth is [catalog.json](../packages/theme/catalog.json), also exported as `appearanceCatalog` by `@hasaweb/theme`. It contains the actual token values, asset paths, font weight ranges, provenance and SHA-256 digests. Production provisioning does not import it. Existing opaque draft IDs remain compatible; approval does not rewrite stored drafts.

## Review the approved catalog

Run `node scripts/appearance-catalog-review.mjs --serve` and open [the local review](http://127.0.0.1:8791). The command also writes [review.html](../specs/2026-10-17-appearance-catalog/review.html), which can open directly from disk with its relative local font assets. It shows all six themes as twelve light/dark palette specimens and each actual font. Its decoration cards link to the [actual imported component review](http://127.0.0.1:3000/catalog/avatar-decorations), which requires `pnpm dev:web --port 3000`. Example content has no connection to owner storage.

The review is a catalog specimen, not an implementation or approval of the portfolio renderer, page layouts, appearance controls or onboarding screens. The [Phase 16 renderer](../packages/render/README.md) implemented default Leaf/DM Sans styling and reusable owner-data decoration markup. [Phase 35](../specs/2026-11-07-preset-appearance/results.md) activates the six presets, three fonts and initial mode, with owner controls, in preview and on every published page. [Phase 37](../specs/2026-11-07-decorations-setup/results.md) activates saved cat/hands selection in the preview projection and adds the owner decoration and Face Reveal setup controls. Phase 36 integration and Phase 38 activate custom-color delivery and the public Face Reveal and playback behavior.

## Template and defaults

| Setting | Approved value | Stored representation |
| --- | --- | --- |
| Single template | Portfolio | `portfolio-v1`, a catalog/rendering identifier; no new draft schema field |
| Theme | Leaf | `appearance.themeId = "leaf"` |
| Font | DM Sans | `appearance.fontId = "dm-sans"` |
| Initial mode | System | `appearance.colorMode = "system"` |
| Custom color | None | Omit `appearance.customColor` |
| Avatar decoration | None | Omit `profile.decorationId`; no `none` ID |
| Face Reveal | Off | `profile.faceReveal.enabled = false`; no second photo |

The template means the agreed fixed profile followed by stacked optional sections. Themes and fonts do not select alternative layouts. A new draft has empty owner fields, links and components, no samples, no provider acceptance and no uploaded images. Provisioning those drafts remains Phase 12 using these approved defaults. There is no appearance step in onboarding.

## Exactly six themes

| Name and ID | Light appearance | Dark appearance | Reference |
| --- | --- | --- | --- |
| Leaf, `leaf` | Paper `#f7f8f5`, ink `#20241e`, lime `#bdeb70` | Night `#171c16`, text `#eef3e9`, lime `#bdeb70` | Direction A brand and dark foundations |
| Violet, `violet` | Lilac `#eadcfa`, plum accent `#7934ad` | Plum `#2d1a3d`, lilac accent `#d19af4` | Existing geometric profile example |
| Clay, `clay` | Cream `#fff0d6`, terracotta accent `#c83b20` | Brown `#34211b`, peach accent `#ffa56b` | Existing illustrator profile example |
| Matcha, `matcha` | Milk foam `#f9f9e6`, olive accent `#6b770e` | Deep tea `#171d10`, matcha accent `#bdca6a` | Owner's matcha reference, Figma `269:4` |
| Strawberry, `strawberry` | Vanilla `#fff5e0`, berry accent `#b10a09` | Berry `#281315`, blush accent `#f5b8a6` | Owner's strawberry reference, Figma `269:223` |
| Coffee, `coffee` | Warm milk `#faf5ea`, espresso accent `#6d3b17` | Espresso `#1c100b`, crema accent `#e7b272` | Owner's coffee reference, Figma `269:442` |

The owner approved these names and stable IDs in Phase 11E. The Figma examples supplied visual references; their existence alone did not approve the catalog. Leaf's base colors match the direction; its link and interaction colors extend it. Violet and Clay adapt existing example palettes to complete semantic sets. Muted text and control colors are adjusted where necessary to meet contrast on every permitted surface. The exact approved colors are in the manifest.

The owner requested the three additions before Phase 11E approval. Their semantic values are copied exactly from the three new Figma collections, including interaction and error states. The catalog records their reference image filenames, extracted anchor colors, collection IDs and board IDs. A [read-only Figma export](../specs/2026-10-17-appearance-catalog/figma-palettes.json) freezes the resolved values for drift checks. Fonts, the single template and draft defaults stay as listed above.

Each mode records `page`, `surface`, `raised`, `text`, `muted`, `accent`, `onAccent`, `link`, `control`, `border`, `hover`, `pressed`, `focus` and `error`. Text, muted text, links and errors are valid on all three surfaces at 4.5:1 or higher. Accent labels use `onAccent` on the normal, hover and pressed fills. Use `control` for control boundaries, including around primary buttons, and `focus` for an offset focus ring against a surface. The soft `border` token is a decorative separator, not a control indicator. Do not use the bright accent as body text on light surfaces.

The [OKLCH generator](../packages/theme/README.md#custom-palette-contract) derives coordinated custom palettes with adjustment explanations and final-hex contrast tests. Its preset resolver restores these approved values when the custom seed is absent. Phase 35 delivers the presets themselves to the preview and all page types. Custom-color owner controls and delivery of generated tokens remain Phase 36 integration work. System mode resolves the visitor's preference, and an explicit visitor choice overrides the owner's initial mode on every page of that portfolio.

## Curated fonts

| Name and ID | Normal variable weight range | Fallbacks |
| --- | --- | --- |
| DM Sans, `dm-sans` | 100–1000 | Arial, sans-serif |
| Manrope, `manrope` | 200–800 | Arial, sans-serif |
| Lora, `lora` | 400–700 | Georgia, Times New Roman, serif |

DM Sans follows the brand direction. Manrope and Lora also appear in the existing personal-profile design artifacts and provide a geometric sans and a serif option. These are global family choices across the portfolio, case studies and resume wrapper. They are independent of the chosen theme. The review uses the shipped normal variable faces; browsers can synthesize italic emphasis.

Actual unmodified TTF variable fonts and each SIL Open Font License notice are checked into `packages/theme/assets/fonts/`. Sources are Google's official font repository for [DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans), [Manrope](https://github.com/google/fonts/tree/main/ofl/manrope) and [Lora](https://github.com/google/fonts/tree/main/ofl/lora). The manifest freezes local bytes with SHA-256 digests. Acquisition required external requests; the review and eventual portfolio loading do not request Google Fonts. Phase 35 copies all three files into the renderer platform package with content-hashed paths, and each publication retains only its saved font. The local package paths are not deployed asset URLs. Future conversion/subsetting must record its new bytes and preserve the licenses.

## Optional decorations

| Name and ID | Implementation | Appearance |
| --- | --- | --- |
| Ginger cat, `cat` | Cleaned animated WebP and reduced-motion still | Original ginger cat around the portrait |
| Hands, `hands` | Original inline SVG and CSS module | Curled/palm/nails poses, hearts and sparkles |

The owner explicitly replaced the three static SVG proposals with these two decorations from their existing portfolio. The prior Leaf, Orbit and Frame files are removed. [The faithful import](avatar-decorations.md) records the exact source, asset paths, original animation behavior, wrapper geometry, review commands and regeneration limitation. The catalog distinguishes `animated-webp` from `svg-css`; hands does not have an image URL. Its component/style files have recorded digests.

The source component and reusable slot retain the 124/104 px responsive portrait sizes and original offsets rather than the removed shared 160 × 160 SVG geometry. Both decorations remain above either portrait image and ignore pointer events. Removing a selection still omits the decoration ID. The import's Umer identity is a review fixture; production owner image acceptance, publication/withdrawal and agreed accessible labels remain in their existing phases.

### Approved production motion policy

The selected decoration autoplays independently of Face Reveal. Cat uses the original cleaned 32-frame, 3,920 ms infinite WebP loop; hands keeps the full six-second CSS sequence with all poses, hearts and sparkles. Reduced motion selects the cleaned cat still and stationary hands, stops shimmer and skips the reveal wipe. Preference changes apply immediately.

Phase 38 must add an independent, keyboard-accessible visitor pause/play control. Pausing selects the cat still or stops the hands without switching the portrait. Playing resumes the original sequence when reduced motion is off. Reduced motion takes priority over play. Playback control works with Face Reveal off as well as on and uses shared behavior in preview/public output. Decorative art stays hidden from screen readers. The source review already verifies the original animations and reduced motion; production pause/play is scheduled work, not an implemented source feature.

The owner accepted the preserved original clean assets with the documented generator environment exception. Regeneration currently fails its exact-byte guard on the recorded toolchain; the safe command restores both reviewed outputs. Repairing that guard is a separate tooling change, not a reason to redraw or simplify the decoration. See [the import guide](avatar-decorations.md#observed-environment-limitation).

## Figma provenance

Connected Figma MCP returned code context and screenshots on October 17, 2026 for the [brand board at 8:2](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=8-2), [authentication at 12:48](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=12-48), [dark foundations at 8:159](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=8-159), [violet example at 74:377](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=74-377) and [clay example at 74:236](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=74-236). Foundations metadata at `4:76` confirms the warm surfaces, DM Sans, frame/leaf language and system mode direction. That original inspection was read-only.

The owner then explicitly requested new reference-derived palette boards: [Matcha](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=269-4), [Strawberry](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=269-223) and [Coffee](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=269-442). Those authorized additions created separate Light/Dark variable collections and preserved existing designs. This catalog integration re-read their resolved variables through connected MCP without further writes. No temporary Figma asset URL is used by the catalog or review.

## Approval and later integration

Approval covers the six theme names/IDs and twelve exact palettes, three font families/assets, both imported decorations and their playback policy/geometry, the documented regeneration exception, and the defaults above. The manifest records the owner's approval and date. Keep stable IDs once used by drafts and retain referenced asset versions. Subsequent phases use this approved catalog rather than choose new identifiers. Phase 11E approval does not implement provisioning or later controls.

Final technical checks now pass after the evidence-formatting repair: 218 unit tests, workspace checks, 12 build tasks, 162 catalog browser combinations and eight avatar scenario groups. The generator's narrow documented exception remains. See [current verification](../specs/2026-10-17-appearance-catalog/results.md#current-verification-status). The owner approved the catalog and Phase 11E completion on October 17, 2026.

| Phase | Work consuming this decision |
| --- | --- |
| 12 | Provision approved defaults into empty private drafts; no appearance step |
| 16 | Shared owner-data markup, responsive envelope, tokens/assets and loading geometry; preserve source reference and zero public React hydration |
| 23 | Validate approved theme/font/decoration IDs with actionable corrections; no draft schema migration |
| 24–25 | Retain selected content-hashed clean cat animation/still or hands CSS/SVG on the asset host; exclude source portrait fixtures and raw regeneration inputs from owner publications |
| 35–36 | Six preset choices, existing fonts and modes across pages; custom-color generation and reset |
| 37 | Cat/hands selection/change/remove and owner Face Reveal setup; no default decoration or custom upload |
| 38 | Original choreography with owner images, independent pause/play, reduced motion, accessible reveal and photo withdrawal |
| 53 | Full browser/viewport acceptance for all palettes, both decorations, playback, reduced motion, focus and flashing limits |

Phase 23 implements publication membership validation and explicit catalog corrections in the reusable editor checklist. Unknown historical IDs must fail that validation with an actionable owner correction, rather than silently become a different published appearance. Draft structural parsing stays backward compatible and does not treat an opaque ID as proof of membership.
