# Phase 29 safe rich text and text sections

## Scope and acceptance

Implement [Phase 29](../../docs/roadmap.md#phase-29-add-safe-rich-text-and-text-sections), [product section 8](../../docs/product.md#8-about-and-general-text-sections) and [acceptance section 8](../../docs/acceptance-criteria.md#8-about-and-general-text-sections). Add reusable Tiptap headings, paragraphs, lists and safe links to multiple titled text sections. Verify saved and published formatting and hostile paste/submission behavior, editing, ordering and removal.

Prerequisites 09, 17, 27 and integration dependencies 23, 26 are approved and integrated at shared base `859afff`. Branch `feat/29-safe-rich-text`, worktree `.wrangler/worktrees/phase29`. Write boundaries: rich-text controls, editor integration, pinned web dependencies, browser coverage and affected current guidance. No delegated workers.

## Decisions

Reuse the existing strict structured-text contract and controlled renderer. Figma reference `330:371` was inspected read-only for form styling. No design changes.

## Results

Implemented reusable text-section controls in the existing editor adapter. Tiptap supports headings 2–6, paragraphs, nested bullet/numbered lists, selected-text HTTP(S)/mailto links, link removal and undo/redo. The existing registry supplies multiple sections, ordering and confirmed removal. The shared renderer and publication format are unchanged. Unsupported extensions are disabled; link and list attributes match the strict saved schema. Pasted executable nodes, images and arbitrary attributes are omitted. Rejected oversized body edits stay in owner-scoped local recovery and remain editable after reload, while Publish remains blocked. Review/suspension changes editor availability without emitting content edits.

Verification against shared base `859afff` plus these working changes:

- The full local profile passed. Evidence: `.wrangler/verification/2026-10-28T17-23-17.069Z-INQi7y/summary.json`.
- Lint, all 12 package type checks, 467 unit tests across 44 files and all application builds passed. Seven existing CSS specificity warnings remain.
- Passed 27 renderer groups, authentication including 19 browser journeys, 85 persistence/access checks, 11 private upload groups, 43 publication dispatch groups, commit/serving checks, 17 draft API groups, autosave recovery, runtime/restart smoke and 31 local routing boundaries.
- All 45 editor browser groups passed. New proof covers hostile HTML paste, allowed saved structure, durable reload, an oversized body's local recovery and repair, validated link insertion/removal, paragraph/heading/list controls, independent section bodies through reordering and cancelled/confirmed removal. The real local publication journey verifies heading/list/link content and executable-node absence after Publish/republish. Browser evidence and inspected mobile screenshot: the full run's `suite-11/` directory.
- Final check/build refresh passed on the final application source: `.wrangler/verification/2026-10-28T17-27-51.036Z-WiVPhp/summary.json`. The full gate started before the last editor/test refinements; its editor fixture bundled the refined source, and this refresh reran lint, type checks, all 467 unit tests and the web build afterward.
- Focused real HTTP submissions passed: raw script HTML, script nodes, event/style attributes and JavaScript links return 422 and preserve the canonical draft exactly. Evidence: `.wrangler/verification/2026-10-28T17-36-44.578Z-9JtWCA/summary.json`. This adds an eighteenth API group to the 17 covered by the original full run.

Normal diff review covered allowed extensions/attributes, raw-input recovery, stable component scope, disabled-state updates, and unchanged controlled public rendering. Hostile-content review covered paste parsing and server rejection rather than trusting editor filtering alone. Routine evidence stays ignored. Verification uses Chromium, local Workers/D1/R2 and the authenticated handoff fixture; it does not certify deployed capacity, providers or the full activated signup journey. No commit, push or owner completion approval recorded.

## Documentation impact

Changed assumption: text sections now have body-formatting controls in the handoff fixture. Updated the implementation baseline, roadmap record link, controller guide and verification feature recipe. The structured schema and shared-renderer contract remain unchanged. Downstream case-study work can extend the editor in Phase 30 after approval/integration; production activation remains Phase 42E. Changed local links and the final diff were checked.
