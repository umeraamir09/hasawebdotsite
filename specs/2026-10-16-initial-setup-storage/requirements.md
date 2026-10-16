# Phase 11B requirements

Implement the contract and persistence prerequisites in roadmap Phase 11B using the agreed onboarding specification, architecture sections 5 and 13, and acceptance checks ON-02, ON-13, ON-14 and ON-16 at the storage level.

- Upgrade draft envelopes to version 2 with an optional, format-validated `requestedSubdomain`. It is a private, non-reserving candidate. Keep claimed addresses and permanent claims separate.
- Read version 1 documents without losing content, stable IDs or sample markers. Upgrade in memory and on the next successful save. Do not rewrite historical snapshots or fixtures.
- Store versioned navigation progress outside the canonical draft. It describes the last visited screen, not proof of required completion.
- Share one revision across content, progress and permanent first-editor entry. Setup writes must stop after entry, including already prepared saves. Keep the milestone out of client-editable data.
- Gate incremental saves with a persisted validation generation. Existing version 1 content may predate the approved destination limits; validate it before accepting bounded edits, without truncation or assuming its version proves safety. Keep the full-document reference validator for offline maintenance and defer bounded HTTP validation/correction to Phase 13.
- Reuse the measured bounded-save repository and promote its staging tables into tracked migrations. Do not introduce a full-body owner save endpoint.
- Provide an internal, revision-checked milestone operation for the later authoritative handoff service. Required-content/asset validation, route activation, provisioning, autosave UI and availability checks remain in their assigned phases.
- Provide an explicit public-content projection excluding the candidate and all private setup metadata. Publication filtering and rendering remain later work.

There is no UI change in this phase, so Figma inspection is not needed. The appearance catalog remains unapproved. Phase completion requires the owner's explicit approval after implementation.
