# Phase 19 shared upload and crop controls

## Scope and acceptance

Implement [Phase 19](../../docs/roadmap.md#phase-19-add-shared-upload-controls-and-image-cropping), [upload handling](../../docs/product.md#13-upload-handling), [upload acceptance](../../docs/acceptance-criteria.md#13-upload-handling) and [shared profile cropping](../../docs/onboarding.md#provider-suggestions-and-image-handling). Avatar and banner controls share local repositioning, zoom, Reset, Apply crop and Cancel. Uploads expose progress, descriptions and retry. Draft references change only after an owned ready upload. Cancelled and failed replacements preserve the previous reference.

Prerequisites 14, 17 and 18 are owner-approved and integrated into `main` at `7debdbd`. Work runs on `feat/19-crop-controls` in `/home/umer/.codex/worktrees/phase19-crop-controls/hasawebdotsite`. The coordinator owns integration into the editor, shared browser harness, package scripts, verification profiles and current implementation baseline. Phase 21 owns social links and provider email suggestions. This worker owns the shared crop/upload components, browser asset helpers, private preview image adapters, crop acceptance module and this record. The coordinator approved exposing immutable controller identity and adding an optional purpose check to the canonical private GET. Existing GET requests remain compatible. No schema or authentication changes are included.

Throughput checkpoint. Phase 19 can proceed independently of Phase 21 after those approved prerequisites. The existing draft controller owns all durable edits and recovery. The local crop selection and upload attempt are transient UI state, not a second save queue. Heavy verification runs through the shared `pnpm verify` lock after coordinator integration.

## Decisions

The owner pointed out the onboarding crop references during implementation. Read-only Figma MCP inspection covered desktop avatar `330:252`, banner `330:271` and mobile dialog `330:533` on page `325:2`. The implementation uses their DM Sans typography, warm surfaces, lime action, rounded frame, dark excluded regions, native keyboard zoom slider and five downloaded 20-pixel control icons. The avatar frame uses the existing renderer's 212:220 ratio in place of the reference's square frame. Keyboard guidance and the original-file limitation add accessible instructions. Dynamic owner images replace the reference source portrait. Figma remains unchanged.

The crop model stores a zoom and a normalized horizontal/vertical position. A pure source rectangle drives both the dialog preview and the canvas output. Only the resulting image bytes leave the browser. Reset restores the currently open local selection. Reopening an existing crop cannot recover excluded original pixels.

The preview adapter first uses the shared display projection to collect requested image references, then resolves only those images with at most four concurrent private reads. Samples, disabled photos, SEO images and case-study bodies do not add hidden-file requests. Cancellation interrupts superseded preparation.

## Results

Focused TypeScript checking and nine geometry/file-boundary/display-preparation tests pass. The browser acceptance module drives production components and the real private upload routes through the shared editor harness. Commands run locally were `tsc --noEmit -p apps/web/tsconfig.json`, focused Biome checks and `vitest run apps/web/lib/assets/crop.test.ts apps/web/lib/assets/browser.test.ts`. Integrated browser execution and the applicable local gate are pending with the coordinator. Owner phase approval remains pending.

## Documentation impact

The change replaces the previous editor assumption that all asset references are unavailable with owner-authorized ready image display. Updated private-assets guidance describes the new controls and exact-purpose private reads. The coordinator owns shared renderer/draft-client guidance, implementation baseline and UI-reference reconciliation. The original-file limitation and production activation gates remain unchanged.
