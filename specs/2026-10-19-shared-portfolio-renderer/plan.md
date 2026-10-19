# Phase 16 implementation plan

1. `how` over the affected subsystem.
2. `architect` for parallel design exploration.
3. Write the throughput checkpoint as four todo items.
4. Delegate code-writing to a subagent using the configured feature model.
5. Verify on the matching surface.
6. Rebase into small, ordered commits. Stack follow-ups.
   Skip commits and rebasing until requested. Preserve the reviewable working diff.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR**.
   Skip external publication until requested. Deliver the local implementation and evidence.

## Throughput checkpoint

- [x] Blocking first steps. Read the implementation baseline, protocols, product requirements, schema, source avatar and connected Figma reference before choosing the data contract.
- [x] Independent workstreams. Compare two design sketches in separate files, then give one implementation owner the coupled renderer code. Browser evidence and documentation follow the stable contract.
- [x] Shared mutable state. Design candidates own separate output files. One implementation owner writes shared packages. Run local runtime checks sequentially.
- [x] Smallest safe decomposition. One code owner maintains consistent markup, safety and asset rules across preview and snapshot. The lead owns browser verification and documentation.

## Task groups

1. Ground and sketch. Inspect Figma read-only, compare two module/data designs, record selection and define acceptance checks.
2. Implement. Add markup-only profile and ordered component renderers, shared responsive styles, unavailable/incomplete states, headers and small public script. Retain source avatar reference and derive reusable owner-data decoration markup.
3. Verify. Exercise identical fixtures through a browser-rendered private preview and static publish output. Cover empty/partial/hostile content, safe links, asset failures, keyboard controls, responsive widths and reduced motion. Preserve historical evidence.
4. Document. Update affected current guidance and dependent phase prerequisites. Record evidence, limitations and Documentation impact in results.md. Repeat stale-guidance/link/diff checks.
5. Request owner completion approval. Leave Phase 16 unchecked until explicitly approved.

## Acceptance repairs, October 19, 2026

The acceptance audit reproduced two defects in Chromium. The nested avatar image loses two pixels to a generic border, and the theme action label conflicts with its pressed state. The display model and selected renderer architecture remain unchanged.

1. Reproduce it yourself on the matching surface via the control skill.
   The audit already compared the real source and shared image bounds and captured the actual theme accessibility nodes. Retain those failures.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives.
   The source wrapper geometry matches. The extra nested border causes the image mismatch. Both initial markup and shared behavior apply pressed state to a changing action label.
3. Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model with a specific scope.
   The selected architecture remains valid. One implementation owner changes the avatar generator override and removes pressed state from both theme entry points. The lead owns documentation and independent verification.
4. Verify on the same surface. The original repro now passes.
   Add browser assertions for actual image bounds and offsets, loading and error geometry, and theme action semantics after native keyboard activation in both hosts. Capture failures before applying the fixes, then rerun the complete fixture suite.
5. Stage the commits so the failing repro lands before the fix in git history.
   Skip commits until requested. Preserve separate failing and passing evidence in the working diff instead.
6. Run **Opening a PR**.
   Skip external publication until requested. Deliver the local implementation, evidence and owner completion question.

The coupled implementation has one writer. The lead updates only the spec and current guidance while it runs. Serialize workspace runtime checks after browser verification. Repeat the documentation-impact search and link checks before requesting checkoff.
