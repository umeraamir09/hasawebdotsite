# Recovery coordinator protocol

The draft HTTP contract, D1 migrations and byte/sequence limits stay unchanged. The coordinator replaces browser scopes; the Phase 14 controller remains the only mutation executor.

## Review

1. Stop edits/timers and new batch commands. Set `suspended` for field adapters. Settle the in-flight response and persist the resulting base/working/input checkpoint. Acknowledgement can advance the base; later local input stays separate.
2. Pending staging requires journal recovery or explicit discard. Do not infer content or a lost begin identity from metadata. Discard intent still pins attempt identity, survives lost replies and clears staging before retaining a changed-base block. Legacy validation restores its matching journal before bounded correction.
3. Fetch canonical content separately with expected-owner/portfolio checks. Create a durable review copy before compare-and-delete of the source. If an auth continuation points to that source, checkpoint its new review ID before retirement. A concurrent source update remains untouched. Reviewing an archived record keeps the active scope's own recoverable checkpoint as a separate preserved recovery; only a clean active checkpoint is retired.
4. Compare original/local/current values. Emit only local changes. Use stable IDs for collections and explicit add/remove/order or schema-coupled structural selections. A remotely removed changed entry remains nonselectable. Raw field values and legacy path/base-bound correction text are review input, never inferred valid changes.
5. Persist checkbox decisions. Load newer version requires confirmation; Keep my edits for review starts unselected. Before application fetch canonical again, including its milestone. A changed revision/milestone refreshes the comparison and clears selections.
6. Persist a fresh replacement record against the reviewed base. Persist a prepared checkpoint linking its ID, then install the fresh controller, retain the original as resolved review-only and save the selected result through bounded patch/staging. CAS protects the gap after recheck. Canonical acknowledgement controls Saved; active raw input remains Unsaved input.
7. Reload exposes unfinished review and prepared replacements explicitly. Prepared continuation restores its replacement before retiring the review. Resolved copies remain available without blocking active initialization; explicit dismissal uses compare-and-delete. Storage failure preserves durable sources and memory edits.

After permanent handoff, a setup record contributes only selected content to a fresh content controller. Canonical progress/milestone remain fixed. Never replay setup progress, convert a prepared setup attempt, provision again or reset setup. Existing attempts require original-journal recovery/discard first.

## Authentication

Normal sign-in keeps `/editor` and its fixed provider error destination. Recovery uses `/auth/recovery` and `/auth/recovery/error` only. No arbitrary return URL or mixed callback pair is accepted.

Before same-tab navigation persist the quiesced recovery record and a strict version-1 sessionStorage continuation containing only owner/portfolio/record IDs, setup/content context and controlled flow. If durable storage or continuation storage fails, do not leave. A failed sign-in start releases the pause while preserving the typed error and local input.

The callback calls uncached owner status before reading local records. Owner and portfolio must match. Wrong accounts cannot open, copy or delete the original range. Missing/stale continuation offers ordinary account entry; cancelled/failed consent and reload/Back retain continuation for retry. The callback mounts shared controls; Continue preserved edits restores exact journals and verifies receipts before saving. It never automatically transfers an uncertain command or adopts unknown validation/staging. Changed-base/setup-closed recovery enters review.

Continue preserved edits quiesces the active controller before source lookup and keeps fields suspended throughout restoration, including storage waits and source retirement. Release the pause after restoration before receipt verification/saving. Restore-only validation/discard paths and failures release it through the coordinator's finalizer. Existing active edits remain checkpointed and the controller rejects restoration over dirty values.

The callback is a shared recovery entry only. Phase 17 supplies full editor fields and Phase 42E activates required guide routing through Phase 22A's future authoritative handoff/resolver.

Continuation retirement follows replacement persistence. Restoration updates a matching tab continuation to the durable replacement record before deleting the original source. Callback reload can therefore offer remaining unfinished input without repeating a confirmed write. A changed-base staging discard checkpoints its original `reviewBase` and durable block before cleanup clears the journal, preserving the three-way comparison through a crash.

Structural application preserves unrelated newer fields inside selected objects. Coupled link kind/destination and work-date values still move together; rich text stays atomic and nested collections use stable IDs. Clean replacement checkpoints contain no unfinished work and do not block reload. Successful no-write replacement also removes its empty active record after retaining the review copy. Quiescence gates every subsequent controller command, including legacy validation, while recording the current acknowledgement.

A committed terminal receipt can remain after a lost cleanup reply. It is distinct from unfinished unknown staging. Before retiring it, persist the local review copy and link a fresh content controller's explicit cleanup journal to that review. The fresh controller reads canonical content and retires only the pinned terminal receipt through the existing serialized discard/cleanup machinery. It never replays or transfers the source command and does not acknowledge its local target as saved. Lost replies/reload resume the linked cleanup intent before application. An intent that observed no attempt pins that absence and rejects a newly appeared attempt.

Reopening prepared replacements uses a fresh browser record ID and checkpoints the updated link before conditional source retirement. Unexecuted replacements recheck canonical revision and milestone on return. Changed canonical state preserves the prepared target as review-only, refreshes the original comparison and requires selection again. Existing execution journals retain receipt verification. A missing prepared record safely returns to fresh review of the retained original instead of activating an unverifiable replacement.
