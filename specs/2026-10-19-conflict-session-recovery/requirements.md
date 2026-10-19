# Phase 15 requirements

Implement the owner-approved October 19, 2026 plan on Phase 14's serialized bounded save controller. Scope is shared controls, a fixed same-tab authentication recovery callback and isolated integration fixtures. The full editor remains Phase 17 and required onboarding routing remains Phase 42E.

Owners choose Load newer version with replacement confirmation, or Keep my edits for review with initially unselected changes. Compare the original base, local work and separately fetched canonical draft. Use stable entry IDs and explicit structural selections. Preserve unrelated newer changes, removed-entry values, unfinished raw input and legacy correction paths/base revisions. Recheck the canonical revision before applying selections.

Checkpoint review decisions and replacements before retiring sources through compare-and-delete. Keep review copies available without blocking resolved flows. Confirm canonical writes through existing bounded patch/staging machinery. Keep revision/attempt conflicts, unknown journals, owner changes and setup closure distinct. Retry must not erase durable conflict blocks.

Persist a versioned tab-scoped continuation containing identifiers/context/controlled flow only before same-tab sign-in. Allow only fixed normal and recovery success/error destinations. The callback checks the uncached owner endpoint before opening recovery. Wrong accounts cannot read, copy or delete the original recovery. Cancellation, failure, reload and Back preserve continuation. Require explicit continuation and receipt verification before saving. Never transfer uncertain staged commands, adopt unknown journals or convert a setup attempt after permanent handoff.

Do not change draft HTTP bodies, D1 schema, save limits, provisioning, publication or permanent handoff. Read Figma through connected MCP without edits. Preserve CPU/quota prerequisites and leave the phase unchecked pending explicit owner approval.
