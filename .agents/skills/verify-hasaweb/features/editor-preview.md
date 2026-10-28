# Editor and private live preview

Owners select profile or component controls and see valid edits immediately in a private preview with real desktop/mobile iframe widths.

## Sub-features

- `editor-fields` edits fields while preserving unfinished input.
- `editor-selection` selects a component from controls or preview using pointer/keyboard.
- `editor-widths` switches between desktop and mobile preview viewports.
- `editor-private` stops preview display after session/owner changes.
- `editor-images` selects, crops, uploads, describes, replaces, and removes avatar/banner images through the private asset API.
- `editor-profile` edits required profile values, accepts provider names explicitly and imports provider photos through the shared crop workflow.
- `editor-text` edits a section title and Tiptap body with paragraph/heading/list/link controls.
- `editor-links` manages stable link entries, placement, ordering, invalid input, and deliberate public-email acceptance.

## How to get to it (user POV)

- Enter the authenticated handoff fixture and choose `Profile`, `Text section` or a component in preview.
- Choose `Customization` to inspect the currently available panel.
- On narrow screens choose `View preview`; choose `Desktop` or `Mobile`.
- Focus a preview component and press Enter to open its controls.

## Driving it with Playwright

Preconditions: `pnpm verify --profile=editor` checks/builds web/jobs and runs `scripts/owner-draft-api.mjs --editor`. It starts the real owner API at 8824 and the handoff fixture at 8826, seeds a matching owner/portfolio with its handoff milestone and opens a fresh browser. No other suite may own those ports or `.wrangler/owner-draft-api`/`.wrangler/editor-browser`.

- The existing `scripts/editor-browser.mjs` recipe fills `page.getByLabel("Name", { exact: true })` with `Immediate owner`. Require the preview iframe's `h1` to change before the delayed autosave request completes, then verify eventual persistence separately.
- Click `Desktop` and `Mobile`. Require iframe `innerWidth` to equal 1120 and 390 respectively at parent widths 1500 and 520. Use `View preview` at the narrow width. Preserve the four `editor-<parent-width>-<mode>.png` artifacts alongside `editor-results.json`.
- Click preview `[data-component-id="projects-1"]` or focus `[data-component-id="skills-1"]` and press Enter. Require regions `Projects controls` or `Skills and technologies controls`. Use the `Text section` button, labeled `Section title` and `Section body` textbox for text editing. The [text-control checks](../../../../scripts/text-controls-browser.mjs) drive formatting, safe link insertion/removal, hostile HTML paste and persisted reload. The publication journey checks the resulting formatted public HTML. Shared component checks cover multiple sections, ordering and cancelled/confirmed removal.
- Run the suite's changed-session/owner checks and require the prior owner's preview content to disappear and unauthorized private preview reads to return 401. Fixture session changes establish the test condition; they do not prove a user sign-out path. Use the account recipe for that path.
- The [shared link checks](../../../../scripts/social-links-browser.mjs) drive `Add link`, `Link label`, `Link type`, `Destination URL` or `Email address`, both placement checkboxes, and ordering/removal controls. `Suggest account email` only reads the suggestion. `Use email as public link` is the separate draft mutation. Require matching D1 entries and preview destinations, with raw invalid input preserved after reload.

## Gotchas

- `/editor` is still the account shell. It cannot reach these controls. Report that production entry as unavailable until the complete setup activation lands; do not replace it with a fixture and claim production coverage.
- The fixture seeds real initial draft state and uses some direct controller assertions for boundary tests. Only actual control interactions prove those UI paths.
- Shared upload/crop and link controls use the real owner and private asset APIs in the handoff fixture. Provider-photo HTTP uses controlled external fixtures. Full component tools and saved appearance controls remain later work. Phase 26 adds publication through this fixture. The limited Customization panel is not proof of those capabilities.

## Publication checklist

The editor fixture exposes `Check publication readiness`. The editor suite drives issue buttons to profile/image/link/address controls at desktop and mobile widths, checks that subsequent edits invalidate results, selects an approved catalog correction, and removes an incomplete edited section while preserving untouched samples. It also removes a section with unfinished input, preserves unrelated Address input, then repairs the reservation without restarting setup. It reads D1 to verify saved corrections, the unchanged editor-entry milestone and the absence of public publication state. The owner API suite exercises `/api/owner/publication/check` through the real web Worker with local D1/R2. A separate Phase 26 browser group drives Publish, reload, Retry, Open/Copy and republish through the real local operation, Queue, D1 and R2. It injects lost acknowledgements and cleanup failure, checks unchanged old output before commit, verifies removed public-object absence, and reopens warmed plain/query image URLs in a browser context without request routing. Deployed provider/runtime and edge-cache verification remain release gates.
