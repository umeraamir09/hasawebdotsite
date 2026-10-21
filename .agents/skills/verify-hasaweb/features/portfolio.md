# Portfolio rendering and theme

Visitors read rendered portfolio content and use a theme toggle. The implemented shared renderer supplies both browser preview and static documents.

## Sub-features

- `portfolio-content` shows profile and ordered components with matching display text.
- `portfolio-states` covers complete, incomplete, empty and long portfolio fixtures.
- `portfolio-theme` toggles light/dark presentation and follows explicit/system preference.
- `portfolio-images` preserves avatar geometry and loading/error states.

## How to get to it (user POV)

- Open a rendered portfolio in the renderer fixture server at `/published`.
- View the same content through `/private/host` inside the fixture preview iframe at `/private/preview`.
- Focus or click the visible theme button, selected by `[data-theme-toggle]`.

## Driving it with Playwright

Preconditions: `pnpm verify --profile=renderer` runs checks, web/jobs builds, `scripts/portfolio-renderer-browser.mjs` and the editor suite sequentially. The renderer owns an ephemeral HTTP port and fixture content; no public publication is required or created.

- The suite compares `/published?fixture=complete` and `/private/host?fixture=complete`, then repeats with `incomplete`, `empty` and `long` at 360, 768 and 1280 px. Its fixture-owner session is required for private routes. Read `browser-results.json` and paired `*-preview.png`/`*-snapshot.png` artifacts for matching text/markup.
- Click or focus `page.locator("[data-theme-toggle]")` in both static output and preview. Assert the resulting mode and the accessible action name for the next toggle. Reload and test system-preference changes through the existing suite recipe.
- Inspect the suite's image/portrait assertions, `acceptance-regressions.json` and decoration screenshots. Require actual rendered image geometry and observed load/error behavior rather than container dimensions alone.
- Preserve source/request and assertion context with screenshots. A newly added user interaction should capture its before/action/after sequence; existing final screenshots alone cannot prove an unrecorded action.

## Gotchas

- The site Worker currently returns unavailable outside local probes. These documents are renderer fixtures, not publicly served published portfolios. A real public URL needs publication/storage/routing work that remains pending.
- Case-study and resume pages remain pending. A resume component or omitted private case-study text in a portfolio fixture does not prove a standalone page.
- Only the current default styles and implemented interactions count. Saved palette/font/decoration selectors and independent visitor playback remain later phases.
- Offline snapshot parity does not establish hot publication CPU feasibility, withdrawal/cache behavior, deployment security or the full confirmed browser matrix.
