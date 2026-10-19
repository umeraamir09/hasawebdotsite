# Phase 14 requirements

The owner approved the October 18 plan. Phase 13's production protocol and measured CPU/D1 limits control the implementation. Shared browser state must distinguish canonical content, valid working edits, unfinished raw input, staging and confirmed receipts.

- Use a controller-scoped Zustand store, IndexedDB via idb-keyval, explicit fetch and injected dependencies. Preserve invalid input locally, scoped to owner/portfolio/base revision. Do not retain source files or authentication secrets.
- Debounce valid changes for two seconds. Serialize bounded commands, freeze batches and retain edits arriving during requests. Only canonical acknowledgement permits Saved. Avoid full reads after normal saves.
- Preserve setup/content contexts, permanent handoff, stable entry identities, exact Unicode and existing transport/document limits. Use bounded staged changes for large/structural edits.
- Require X-Expected-Owner-Id on draft/progress APIs, compared to authenticated identity, never used as authority. Stop stale-account writes.
- Persist checkpoints before commands. Reconcile ambiguous direct replies and staged receipts. Explicitly restore/resume/discard; never silently discard staging or replay changed-base recovery.
- Pending metadata contains no staged content. An unfinished attempt without its local journal cannot safely be reconstructed or committed. Retain it for the original browser or explicit discard.
- Share status/recovery controls and a separately built browser fixture. Keep /editor unchanged. Full conflict choices/reauthentication remain Phase 15, editor Phase 17 and onboarding routing Phase 42E.
- Preserve publication, claims, assets and connected services. Revalidate costs, document limitations and affected guidance. Production deployment and phase approval are excluded.

October 19, 2026 scope update: [Phase 15](../2026-10-19-conflict-session-recovery/results.md) implements shared selected-change review and fixed same-tab reauthentication recovery. The Phase 14 scope and historical verification above remain unchanged. Full editor/guide adapters and deployment CPU prerequisites remain in their owning phases.
