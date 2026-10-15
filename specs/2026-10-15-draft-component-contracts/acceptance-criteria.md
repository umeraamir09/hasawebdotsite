# Phase 09 acceptance criteria

- [x] Every optional MVP component has a schema, version, defaults, picker requirements, singleton rule and migration contract. The fixed profile has a schema and defaults, migrates with the envelope and cannot be inserted into optional order. Deferred component types fail.
- [x] Complete and incomplete drafts round-trip through JSON and validation without losing text, order, sample markers, social placements, retained Face Reveal images or appearance settings.
- [x] Singleton duplicates, duplicate entry IDs, dangling category/sample references, invalid dates, invalid versions and unknown properties fail with field paths. Multiple text instances and entry ordering pass.
- [x] Rich-text paragraphs, headings, lists and safe links pass. Case-study uploaded images pass. Raw HTML nodes, scripts, CSS, unapproved marks/attributes, unsafe URLs, malformed nesting and text-section images fail.
- [x] Asset references contain IDs and descriptions only. Traversal identifies the correct asset purpose and field path, including private retained images and case-study images, without claiming ownership or readiness checks.
- [x] Stable sample markers survive reordering and can be cleared without mutating the source draft. Unknown and stale markers fail.
- [x] Envelope and component migration fixtures preserve content and ordering without changing the caller's value. Gaps, future versions, invalid input/output and thrown migration failures stop safely.
- [x] The 1 MiB draft cap is measured in UTF-8 bytes. Oversized, deeply nested, cyclic and non-JSON inputs fail safely. Package build/type checks and repository lint/tests pass.

Verification commands and outcomes are recorded in `results.md`. The owner approved roadmap completion on October 15, 2026.
