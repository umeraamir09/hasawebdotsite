# Phase 33: Separate social links component

## Scope and acceptance

Requirements: [product section 4](../../docs/product.md#4-required-profile-images-and-social-identity), [acceptance 4.5](../../docs/acceptance-criteria.md#4-required-profile-images-and-social-identity), and the [Phase 33 roadmap entry](../../docs/roadmap.md#phase-33-add-the-separate-social-links-component).

Acceptance: editing one link updates both selected placements after Publish without duplicate entry, and the component follows the Phase 27 ordering and removal rules.

Prerequisites 21, 27, 23 and 26 are complete. Shared base: `main` at `87d2290`. Branch `claude/social-links-component-b29ab6`, worktree `.claude/worktrees/social-links-component-b29ab6`. Write boundaries: one new editor browser journey and guidance. No source, schema or migration changes.

## Decisions

Inspection found the component already in place from Phases 21, 23, 26 and 27: the registry singleton, `Draft.links` placement flags, the display projection, renderer and dispatcher output, the publication rules and the shared editor control. The missing piece was proof of the published behavior, so this phase adds that journey and changes no source.

## Results

New editor browser group `social links component publishes shared links, ordering and removal` (`scripts/social-links-publish-browser.mjs`) runs against the real owner API, publication dispatcher and site serving fixture. It checks:

- The picker adds the component without re-entering links.
- One link appears in both the profile and the component after Publish.
- Editing that link's destination changes only the draft until Publish; afterwards both placements show it, and the draft keeps one record.
- Profile-only and component-only placements are independent.
- Reordering changes the shared order.
- A component with no selected link blocks Publish.
- Confirmed removal keeps both link records, keeps the profile links and removes the section after Publish.

`pnpm verify --profile=editor` passed at the working tree on the base `87d2290` (run `2026-11-06T12-27-27.782Z-ZDq0Eu`): lint, typechecking, unit tests, web/jobs builds, 48 editor browser groups and 2 production API groups. The editor profile covers the change because it adds only an editor browser test.

Limitations:

- The no-link block shows the existing "Complete your profile link" issue, because the component and the profile share the issue path `links`. Distinct wording is not part of this phase.
- Local fixtures only. Phase 42E activation and S-9 deployed checks remain.
- Approval: the owner approved completion on November 6, 2026.

## Documentation impact

No assumption changed. The implementation baseline and roadmap now link this record. The roadmap checkbox stays unchecked until the owner approves.
