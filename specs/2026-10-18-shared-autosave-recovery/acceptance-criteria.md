# Phase 14 acceptance criteria

1. Coalesced direct and staged saves restore exact valid content/progress across sessions. In-flight input survives older acknowledgements. Invalid raw input never reports Saved.
2. Reload, failure, offline, lost replies and interrupted commands retain owner-scoped recovery. Resume/discard is explicit. Missing/mismatched journals cannot commit unknown staging.
3. Two tabs/sessions cannot silently overwrite newer content, switch account destinations, or reset handoff. Missing/mismatched expected-owner headers reject privately before draft work.
4. Planner commands obey all encoded byte/count/depth limits and preserve schema validity, references, samples and Unicode across all component types. Ordinary edits do not restage/read entire drafts.
5. Bounded legacy validation/correction and canonical recovery work without arbitrary repairs or an HTTP whole-document validator.
6. Shared controls pass keyboard/focus/status and responsive checks at 360, 768 and 1280 px. Fixture routes and failure injection are absent from production artifacts.
7. Workspace/build/API/auth/persistence checks pass. New request/D1 and provider CPU evidence preserves earlier receipts and records capacity limits accurately.
8. Documentation impact is recorded, affected guidance/dependencies are consistent and links resolve. Phase 14 remains unchecked until explicit owner implementation approval.

October 18, 2026 completion record: the owner explicitly approved the implemented phase and requested a pull request. Phase 14 is now checked in the roadmap; the approval requirement above describes the original implementation gate.
