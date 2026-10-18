# Phase 13 requirements

Started October 17, 2026. Implement the owner-approved Phase 13 plan against roadmap dependencies 11A, 11B and 12.

- Reuse the measured bounded-save repository and the production staging tables from migration 0003. Add only forward migrations.
- Serve consistent private draft/progress reads without full-document Worker parsing. Preserve initialization and owner-status contracts.
- Save content/progress atomically under the shared revision. Setup saves stop permanently at first editor entry; content saves preserve progress/milestone. Attempt context cannot change through continuation requests.
- Retain 1,048,576 document bytes, 8,192 wire bytes, 5,120 change bytes, 4,096 piece bytes, 512 pieces, one attempt per owner, one-hour expiry, and explicit cleanup in batches of at most 32 pieces.
- Resolve identity through Better Auth and recheck persisted session/ownership/deletion inside SQL. Preserve exact origin, JSON media type, no-store and noindex guards.
- Validate legacy content through server-controlled, sequence-bound staged traversal with at most 16 nodes and 4 KiB validation data per call. Never trust a version alone, truncate data, or expose the offline full-document validator over HTTP.
- Permit explicit correction of invalid destinations and retain raw owner-only recovery. Commit only fully validated staging under revision CAS.
- Preserve publication state, claims, public assets and connected services. No client milestone or validation-generation writes.
- No UI/Figma changes, autosave orchestration, local recovery UI, conflict dialogs, guide activation or production deployment.
- The owner selected local checks plus temporary isolated Cloudflare Workers/D1 measurement and cleanup. Keep existing Free targets and record evidence honestly.
