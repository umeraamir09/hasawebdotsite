# Editor and private live preview

Owners select profile or component controls and see valid edits immediately in a private preview with real desktop/mobile iframe widths.

## Sub-features

- `editor-fields` edits fields while preserving unfinished input.
- `editor-selection` selects a component from controls or preview using pointer/keyboard.
- `editor-widths` switches between desktop and mobile preview viewports.
- `editor-private` stops preview display after session/owner changes.

## How to get to it (user POV)

- Enter the authenticated handoff fixture and choose `Profile`, `Text section` or a component in preview.
- Choose `Customization` to inspect the currently available panel.
- On narrow screens choose `View preview`; choose `Desktop` or `Mobile`.
- Focus a preview component and press Enter to open its controls.

## Driving it with Playwright

Preconditions: `pnpm verify --profile=editor` checks/builds web/jobs and runs `scripts/owner-draft-api.mjs --editor`. It starts the real owner API at 8824 and the handoff fixture at 8826, seeds a matching owner/portfolio with its handoff milestone and opens a fresh browser. No other suite may own those ports or `.wrangler/owner-draft-api`/`.wrangler/editor-browser`.

- The existing `scripts/editor-browser.mjs` recipe fills `page.getByLabel("Name", { exact: true })` with `Immediate owner`. Require the preview iframe's `h1` to change before the delayed autosave request completes, then verify eventual persistence separately.
- Click `Desktop` and `Mobile`. Require iframe `innerWidth` to equal 1120 and 390 respectively at parent widths 1500 and 520. Use `View preview` at the narrow width. Preserve the four `editor-<parent-width>-<mode>.png` artifacts alongside `editor-results.json`.
- Click preview `[data-component-id="projects-1"]` or focus `[data-component-id="skills-1"]` and press Enter. Require regions `Projects controls` or `Skills and technologies controls`. Use the `Text section` button and labeled `Section title` for text editing.
- Run the suite's changed-session/owner checks and require the prior owner's preview content to disappear and unauthorized private preview reads to return 401. Fixture session changes establish the test condition; they do not prove a user sign-out path. Use the account recipe for that path.

## Gotchas

- `/editor` is still the account shell. It cannot reach these controls. Report that production entry as unavailable until the complete setup activation lands; do not replace it with a fixture and claim production coverage.
- The fixture seeds real initial draft state and uses some direct controller assertions for boundary tests. Only actual control interactions prove those UI paths.
- Ready asset uploads, full component tools, saved appearance controls and publication remain later phases. The limited Customization panel is not proof of those capabilities.
