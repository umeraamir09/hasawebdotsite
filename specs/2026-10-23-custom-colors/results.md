# Phase 36 custom colors

## Scope and acceptance

Implement the startable palette-generation increment from [Phase 36](../../docs/roadmap.md#phase-36-generate-coordinated-custom-colors). [Acceptance criteria 12.3 through 12.5](../../docs/acceptance-criteria.md#12-themes-custom-color-fonts-and-lightdark-mode) require paired palettes, adjustment explanations, preset reset, and WCAG 2.2 AA contrast. The approved catalog defines fourteen semantic tokens and their permitted contrast pairs.

Phases 11E and 16 are owner-approved and integrated in shared base `598d3a5`. Work uses branch `feat/36-custom-colors` in `.wrangler/worktrees/phase36`. Write boundaries are the theme package, its dependency lock, focused verification, and affected guidance. No schema, renderer projection, editor activation, or publication change belongs to this increment.

Workflow steps are contract tracing, API design, implementation, self-review, local verification, and documentation review. The owner authorized committing, pushing, and opening a PR on October 23, 2026. The owner approved Phase 36 completion for PR #30 on October 23, 2026. Deployment remains separate.

Throughput checkpoint. Generation and contrast verification can proceed with approved prerequisites. Preset controls and preview activation depend on Phase 35. Final validation, page delivery, and CSP integration depend on Phases 23 through 25. Generation, contrast checks, and reset resolution run sequentially in this session. The catalog and lockfile have one writer.

## Decisions

`generatePalette(seed)` accepts the existing six-digit opaque hex seed format and returns paired catalog-shaped palettes and structured adjustment explanations. `resolvePalette({themeId, customColor?})` returns the selected preset when the custom color is absent. The catalog remains immutable. OKLCH generation preserves seed hue, reduces chroma into sRGB, and checks contrast after hex quantization. Arbitrary CSS input and individual token editing remain absent.

Export generation through `@hasaweb/theme/palette`. Keep the catalog-only root entry unchanged. Self-review found that a root re-export would initialize Culori in existing database consumers. The separate entry isolates that dependency until consumers deliberately import generation.

Compare two approaches. Independent RGB channel shifts can change hue and do not express perceptual lightness. The architecture's selected Culori OKLCH conversion supports coordinated tones and gamut reduction. Use the latter with final-byte contrast checks.

## Results

The pure generation increment is implemented. The owner explicitly approved Phase 36 completion for [PR #30](https://github.com/umeraamir09/hasawebdotsite/pull/30) on October 23, 2026 and requested roadmap checkoff, commit and push. The roadmap records that approval. The integration checks below remain pending; approval does not establish that preview controls or final page/CSP delivery are implemented.

| Acceptance boundary | Result |
| --- | --- |
| One seed produces all fourteen tokens in both modes | Passed in `packages/theme/src/palette.test.ts`. |
| Approved presets and generated seed sweep meet declared contrast pairs | Passed using independent WCAG luminance checks after hex quantization. |
| Adjustment explanations identify modes and affected tokens | Passed as generator data. Display beside the owner control remains pending Phase 35. |
| Reset restores the selected preset | Passed in the pure resolver for all six themes. The reset control remains pending Phase 35. |
| All tokens update immediately in the owner preview | Pending Phase 35's saved-appearance display model and controls. |
| All public page types and generated CSS under the final CSP | Pending Phases 23 through 25 and 35. No CSP change was made. |

`pnpm exec vitest run packages/theme/src` passed all 43 theme tests. The sweep includes a 17-level sRGB cube, a five-degree hue sweep at three lightness and three chroma values, grayscale, near-black, near-white, and saturated primaries. This is sampled coverage, not exhaustive enumeration of every six-digit seed. Type checking passed. No CPU or interactive-preview performance claim is made.

Normal diff self-review found and removed the root re-export that would initialize Culori in catalog-only database consumers. An esbuild metafile check of the final catalog entry contains only the catalog JSON and root entry, with no Culori modules. Proof is in the ignored `.wrangler/phase36/import-boundary.json`. No new comments narrate the implementation.

The `full` verification profile is required because this increment adds pinned dependencies and changes the shared lockfile. It builds every application and runs the existing browser and Worker regression suites. The first full gate was interrupted to isolate the import boundary. The final `pnpm verify --profile=full` run passed at `.wrangler/verification/2026-10-23T03-58-04.380Z-ThsUGu/summary.json`. It covers base `598d3a5` plus this worktree's implementation changes. Later documentation-only result updates do not change the verified code.

Passing checks include lint, type checking, all 415 unit tests, all twelve build tasks, renderer, authentication, persistence, private uploads, draft API, autosave, editor, runtime, runtime correctness smoke, and host routing. The runtime smoke checks do not establish production CPU or capacity. Existing Chromium fixtures do not establish the full release browser matrix or generated-palette interface accessibility. Generated-palette controls do not exist yet.

Relative file links and anchors resolve in the affected guidance. `git diff --check` passed. The local decision trail is `.wrangler/phase36/decisions.tsv`. Its entries were self-reviewed against this session's actions and evidence. No subagents or separate models were used.

## Documentation impact

The theme package adds pure palette generation through a separate entry while preserving catalog-only imports. Its README, the architecture theme contract, appearance catalog guidance, and implementation baseline now describe that boundary. Historical Phase 11E and Phase 16 evidence remains unchanged. Final CSP delivery, immediate owner preview, all page types, and rendered axe checks remain pending their integration prerequisites.

Approval documentation update, October 23, 2026: recorded the owner approval in the roadmap and implementation baseline while retaining the pending integration boundaries. Documentation-only verification uses the `docs` profile and final diff review.
