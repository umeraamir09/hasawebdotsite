# Phase 19 shared upload and crop controls

## Scope and acceptance

Implement [Phase 19](../../docs/roadmap.md#phase-19-add-shared-upload-controls-and-image-cropping), [upload handling](../../docs/product.md#13-upload-handling), [upload acceptance](../../docs/acceptance-criteria.md#13-upload-handling) and [shared profile cropping](../../docs/onboarding.md#provider-suggestions-and-image-handling). Avatar and banner controls share local repositioning, zoom, Reset, Apply crop and Cancel. Uploads expose progress, descriptions and retry. Draft references change only after an owned ready upload. Cancelled and failed replacements preserve the previous reference.

Prerequisites 14, 17 and 18 are owner-approved and integrated into `main` at `7debdbd`. Work runs on `feat/19-crop-controls` in `/home/umer/.codex/worktrees/phase19-crop-controls/hasawebdotsite`. The coordinator owns integration into the editor, shared browser harness, package scripts, verification profiles and current implementation baseline. Phase 21 owns social links and provider email suggestions. This worker owns the shared crop/upload components, browser asset helpers, private preview image adapters, crop acceptance module and this record. The coordinator approved exposing immutable controller identity and adding an optional purpose check to the canonical private GET. Existing GET requests remain compatible. No schema or authentication changes are included.

Throughput checkpoint. Phase 19 can proceed independently of Phase 21 after those approved prerequisites. The existing draft controller owns all durable edits and recovery. The local crop selection and upload attempt are transient UI state, not a second save queue. Heavy verification runs through the shared `pnpm verify` lock after coordinator integration.

The coordinator integrated both workers sequentially on `feat/19-21-upload-links` in `/home/umer/hasawebdotsite`. The coordinator completed the remaining crop browser fixes after the Phase 19 worker became unavailable. No replacement worker was added.

## Decisions

The owner pointed out the onboarding crop references during implementation. Read-only Figma MCP inspection covered desktop avatar `330:252`, banner `330:271` and mobile dialog `330:533` on page `325:2`. The implementation uses their DM Sans typography, warm surfaces, lime action, rounded frame, dark excluded regions, native keyboard zoom slider and five downloaded 20-pixel control icons. The avatar frame uses the existing renderer's 212:220 ratio in place of the reference's square frame. Keyboard guidance and the original-file limitation add accessible instructions. Dynamic owner images replace the reference source portrait. Figma remains unchanged.

The crop model stores a zoom and a normalized horizontal/vertical position. A pure source rectangle drives both the dialog preview and the canvas output. The original container signature must match the selected JPEG, PNG or WebP type before decoding. Only the resulting image bytes leave the browser. Reset restores the currently open local selection. Reopening an existing crop cannot recover excluded original pixels.

The preview adapter first uses the shared display projection to collect requested image references, then resolves only those images with at most four concurrent private reads. Samples, disabled photos, SEO images and case-study bodies do not add hidden-file requests. Cancellation interrupts superseded preparation.

The existing imported-SVG lint exception also covers the five unchanged Figma control icons. Only the two private/blob image controls bypass the Next Image lint recommendation. Their images require current owner cookies or local object URLs.

## Results

The integrated `pnpm verify --profile=full` passes at `5ccd750`, with the documentation working changes captured in its source record. All 12 commands pass. This includes lint, type checks, 372 unit tests, all application builds, renderer/authentication/persistence/upload/draft/recovery suites, 26 editor browser groups, runtime smoke, and routing. Local evidence lives under `.wrangler/verification/2026-10-22T17-57-07.588Z-IKLWJf`, with the gate in `summary.json` and editor actions/results in `suite-9/editor-results.json`.

The four crop groups drive production components through real private upload routes, signed sessions, D1, R2, and the preview iframe. They verify saved crop dimensions and source pixels, descriptions, reload, exact-purpose reads, keyboard repositioning/zoom/Reset, dialog focus, mobile layout, retry, upload/read cancellation, removal, preserved earlier asset bytes, foreign/signed-out denial, and unsupported/oversized/undecodable/disguised source rejection. The coordinator inspected the desktop and mobile dialog screenshots against Figma.

The first browser run reproduced focus loss after reopening and cancelling an uploaded crop. [Selected failing proof](proof/crop-focus-before.json) preserves that result. The fix retains the invoking control before asynchronous preparation and restores it after cancellation. Explicit Tab wrapping keeps keyboard focus in the modal. The final gate passes both assertions and verifies the pill action geometry after resolving the editor stylesheet override.

The coordinator performed a separate self-review of upload readiness, exact-purpose private reads, stale callbacks, controller replacement, immutable replacement/removal, and source retention. No unresolved implementation defects remain from that review. Provider import, production editor/onboarding activation, publication, jobs source transfer, and deployed CPU/browser release coverage remain their existing prerequisites. This local gate proves no deployed publication behavior. Owner phase completion approval remains pending.

## Documentation impact

The change replaces the previous editor assumption that all asset references are unavailable with owner-authorized ready image display. Private-assets, renderer/draft-client guidance, the implementation baseline, onboarding guidance, verification recipes, and root README now describe the controls and their handoff-only integration. UI direction records the newer Figma onboarding page and crop references. Roadmap links point to this record without checking off the phase. Historical evidence, the original-file limitation, and production activation gates remain intact.
