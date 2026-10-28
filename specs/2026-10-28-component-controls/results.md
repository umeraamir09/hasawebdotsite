# Phase 27. Component picker and ordering controls

## Scope and acceptance

Implements [Phase 27](../../docs/roadmap.md#phase-27-add-the-component-picker-and-ordering-controls) and [editor acceptance 3.2–3.6](../../docs/acceptance-criteria.md#3-edit-arrange-and-preview-the-portfolio). Registry-driven additions explain requirements, preserve singleton limits, allow multiple text sections and keep Profile first. Component and entry ordering supports pointer drag, keyboard sorting and mobile Move up/down buttons. Confirmed removal clears component content, local input and sample markers; cancellation preserves them.

Prerequisites 09, 13–15 and 17 are owner-approved and integrated into shared base `d38d75a`. Branch `feat/27-component-controls`; worktree `.wrangler/worktrees/phase27`. Write boundaries are editor controls/helpers, focused tests, web drag dependencies and affected guidance. The existing Phase 36 worktree was clean at inspection. No parallel implementation was requested. Appearance, publication services and GitHub consent remain outside this phase.

## Decisions

Use the architecture's dnd-kit pointer and keyboard sensors with dedicated handles and Move buttons. Keyboard scrolling uses `auto`, and sorting has no transition animation. All removals ask for confirmation, including empty components and the existing publication-correction shortcut. Private GitHub removal is refused by both paths until Phase 41 supplies authoritative access withdrawal. Draft deletion must not pretend to revoke private access.

Read-only Figma MCP inspected `330:371` on October 28 for surface, field and button direction. No Figma edits or static assets were needed.

## Results

The picker uses empty registry defaults and never inserts samples. Existing schema validation and publication requirements remain authoritative. Stable IDs retain selection and raw fields during section, project/work/skill entry and skill-category ordering. Entry edits clear matching legacy sample markers. Removal preserves shared links and private asset records. Both removal paths share a modal and cleanup helper, including stable-selector and numeric-index correction input cleanup. Controls remain reusable by guided content adapters through the existing draft controller.

Local verification covers the full profile across the initial run and affected reruns:

- `.wrangler/verification/2026-10-28T03-27-26.761Z-QH3ug5`: checks, all application builds, renderer, auth, persistence, uploads, publication dispatch/serving, draft API and autosave passed. Its editor stage exposed the new-section selection defect below; the gate stopped there.
- `.wrangler/verification/2026-10-28T04-01-03.839Z-363LS8`: all three focused component browser groups and both production API preconditions passed. Coverage includes singleton limits, multiple text sections, pointer/keyboard sorting, mobile buttons, durable save/reload, Cancel/Escape, confirmed removal, entry/category order and private GitHub refusal.
- `.wrangler/verification/2026-10-28T04-02-21.941Z-YjQrnb`: checks, affected builds, 42 editor browser groups, runtime integration, runtime correctness smoke and all 31 local routing boundaries passed through the shared-lock runner.
- `.wrangler/verification/2026-10-28T04-11-14.044Z-oP0sk9`: final `pnpm verify --profile=editor` passed after the publication-correction shortcut fix. This includes lint/typechecking, all 465 unit tests, web/jobs builds, 42 editor browser groups and both API preconditions. Seven non-failing CSS specificity warnings remain.

Reproduction and repair: on an empty draft, Add component then Add Text section inserted the section but never opened Section title. Selection checked its captured pre-insertion render draft and rejected the newly added ID. It now reads the controller's current working draft. The browser scenario preserves this regression proof. Keyboard drag and reload assertions also needed to wait for observable drag/preview acknowledgements rather than sending the next action too early. The final audit found publication correction bypassed confirmation; its browser test now cancels, verifies unfinished input survives, then confirms scoped cleanup.

Normal diff and React review checked controller replacement, disabled recovery state, stable identities, modal cancellation/focus, input/sample cleanup and private GitHub refusal. Inspected the 390 px mobile screenshot in the focused run: controls and fields fit, with 44 px minimum targets for new controls. Updated documentation links and final whitespace checks pass.

No commit, push or roadmap checkoff is authorized. Owner completion approval is pending. Verification uses local Workers/D1 and fixture provider authority. Production editor/guide activation remains Phase 42E; private GitHub withdrawal remains Phase 41. Paid-provider and release checks remain separate.

## Documentation impact

The [editor contract](../../apps/web/lib/draft/README.md) documents reusable controls, both removal paths, cleanup and deferred integrations. The [implementation baseline](../../docs/implementation-status.md) records the verified capability with owner approval pending. Product requirements and schema contracts do not change. Phase 41 withdrawal and Phase 42E activation remain unresolved prerequisites for those integrations.
