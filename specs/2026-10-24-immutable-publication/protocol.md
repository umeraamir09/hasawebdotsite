# Immutable candidate delivery

October 27, 2026. This extends the integrated [S-8 dispatcher](../2026-10-24-s8-dispatch-feasibility/protocol.md). [Phase 24 results](results.md) record implementation and verification. The renderer policy is `publication-v1`. This protocol prepares private candidates; Phases 25–26 commit, serve and expose publication operations.

October 27, 2026 supersession: [Phase 25](../2026-10-27-commit-public-serving/results.md) implements the internal commit and manifest-authorized site reads described below. This Phase 24 record still describes what candidate preparation alone exposes. Phase 26 retains the owner-facing operation and withdrawal cleanup.

## Admission and revision

`preparePublication(controller, submit, send)` flushes valid autosave, rejects unfinished input/uploads/recovery, quiesces the existing controller and checks every readiness page at one confirmed revision. The admission adapter runs before releasing that pause. A candidate receipt means `preparing`, never `live`. The supplied adapter is dormant until Phase 26 chooses its authenticated operation and progress protocol.

`publicationTasks.create` authorizes the persisted owner/session, validates the exact portfolio revision and blocks unfinished save attempts. SQLite captures only the included public fields in one statement. Samples, setup/progress, hidden links, disabled Face Reveal images and private contact recipients are absent. Credentials and GitHub calendars are never captured. A private bounded facts ticket covers the current address, recipient verification and GitHub consent/generation. Comparison around validation/capture prevents a stale advisory checklist from authorizing changed facts.

## Artifact preparation

The existing bounded renderer traversal and at-most-sixteen-input streamed assembly preserve Unicode, nested wrappers and every included field. The main, case-study and current resume representation receive the shared `PortfolioLayout`, document shell and vanilla script. This does not activate later case-study, PDF, appearance or interaction capabilities.

The transferring stage retains its original upload copies, then uses a discriminated finalization cursor to perform these resumable tasks:

1. Capture the trusted platform package and copy one selected dependency per invocation. Retain compiled shared CSS, the vanilla script, DM Sans and clean cat loop/still only when selected. Hands CSS/SVG comes from the shared generated stylesheet. Compare every copied dependency with its expected byte count and SHA-256. Missing old package files fail rather than substituting a newer build.
2. Read the sanitized source in 32,768-byte SQLite slices into deterministic R2 parts. Assemble `snapshot.json` with bounded fan-in. No complete draft or snapshot is parsed in the Worker.
3. Stream the assembled markup into complete document copies. Retain a generic 404, robots file and bounded, assembled sitemap for the captured address.
4. Hash each upload/document/snapshot/platform output with `crypto.DigestStream`. Record a fenced, idempotent receipt containing the bucket, candidate key, logical path, content type, byte count and SHA-256. Large JSON files and binary uploads are hashed as streams.
5. Construct the manifest inside SQLite, transfer its bytes in bounded slices and assemble `manifest.json`. Record its own byte count/hash separately to avoid a recursive self-hash. Only a complete expected receipt inventory can advance to readiness.

All artifacts use `candidate/{uuid}/` keys. `manifest.json` has format `hasaweb-candidate-v1`, candidate ID, source revision, renderer version and the file receipts. `snapshot.json` is a retained input for later rerendering, not a visitor route. Intermediate assembly parts are private working objects and are intentionally absent from the manifest.

Logical CSS/script/font/art paths begin with `/platform/` or `/portfolio-platform/`; Phase 25 must map them through the active manifest. Uploaded image/PDF URLs use the configured asset origin and candidate-specific keys. The platform-package binding exists only in the keyed candidate fixture, alongside its inactive Queue/source bindings. The jobs build retains the pack in `dist/platform` for later activation, including Turbo cache restoration. The public server must authorize those keys against the active version and apply the verified withdrawal policy. This phase enables no public artifact endpoint.

## Seal and retention

The final ready checkpoint checks the current lease/sequence, active owner and portfolio, unchanged facts ticket, complete upload receipts and current owned-ready asset purpose/media/size. A changed draft revision does not rewrite the captured source. A revoked recipient/consent/address fact or asset failure prevents sealing. Phase 25 must recheck its mutable commit conditions in the pointer transaction; readiness alone cannot authorize later commit.

Migration `0011` adds optional `publish_version.candidate_id`. A reference accepts only a ready candidate belonging to the same portfolio and cannot be reassigned. It prevents cleanup, expiry and physical deletion while that version is retained. The reference releases private source/facts while keeping artifact receipts and source-asset retention, releasing its preparation slot through migration `0012`. Retained versions do not consume the 128 pending-candidate slots. Phase 25 must create the reference in the same guarded batch as its complete-version pointer change. Existing versions without a reference retain their existing behavior.

Migration `0012_publication_admission.sql` backfills `publication_candidate_pending` with unreferenced candidates. Transactional triggers acquire a slot on candidate insertion, release it when a version references the candidate, and reacquire it when that version is deleted, including owner cascades. Admission counts these slots and checks sources only among their candidate IDs. It preserves one source per portfolio and four globally without scanning retained history. Unreferenced ready candidates, failures and cleanup tombstones all consume pending slots until physical retirement. Deleting many retained versions can temporarily exceed 128 pending slots; new preparation then waits for cleanup. Retained-version storage has a separate launch capacity gate. Phase 25 creates and deletes guarded version references; triggers own slot membership.

Retries reproduce deterministic keys and resume from fenced checkpoints. Cleanup removes only that candidate's output, never draft objects, other versions, the live pointer or address claim. Owner deletion removes version references through the existing cascade while candidate cleanup tickets survive. Tombstones retain the existing late-object and cleanup-failure policy. Later account deletion and collectors must include these records and guards.

## Verification boundary

The publication fixture runs real local workerd, D1/R2, shared React serialization, named web-only private source transfer and platform asset binding. It checks complete document/manifest hashes, maximum and dense inputs, Unicode, selected decorations, enabled/disabled Face assets and full-size copies. Injected write/checkpoint/source/deletion failures must recover or clean without moving the seeded pointer/claim. A retained version must reject cleanup and expiry. Combined fixtures cover 128 current retained portfolios, complete subsequent preparation, the final pending slot under concurrent requests, source limits, cleanup tombstones and restored cleanup accounting after cascaded version deletion. The persistence fixture verifies backfill from migration `0011`.

These are local correctness and operation-counter results. Inspector samples are diagnostic, not native provider CPU acceptance. The [paid-at-launch policy](../../docs/deployment-policy.md) retains native paid CPU/operations/storage and S-9 cache withdrawal as release/dependent-phase gates. The separate boundary review and owner approval are recorded in the results; the capacity follow-up records the verified repair and pending review of its corrective migration/admission change.
