# Bounded owner saves

Historical October 16 measurement contract. The [Phase 13 production protocol](../2026-10-17-revision-aware-drafts/protocol.md) now specifies the shipped portfolio/progress mapping, tracked staging migration extensions, reads, contexts and bounded legacy validation. The fixture progress shape below remains isolated measurement data.

October 18 recovery clarification: the historical begin guidance below does not authorize adopting an attempt from pending metadata alone. The [Phase 14 client contract](../../apps/web/lib/draft/README.md) requires explicit discard/rebuild when a lost begin reply leaves no verifiable attempt ID or captured progress. Sequence advancement requires identical-command receipt verification, and unknown partial work is never committed.

The owner approved implementation and isolated testing on October 16, 2026, then explicitly approved a 2,048 UTF-8 byte limit for each URL and 254 UTF-8 bytes for each email address. Free text and the complete draft retain the 1,048,576-byte ceiling. This changes version 1 validation for unusually long destinations. Existing stored values beyond those limits require an explicit correction during later integration, never truncation or silent replacement.

## Requests and storage

`boundedSaves` in `packages/db/src/bounded-save.ts` is the reusable repository. Its caller supplies a freshly checked Better Auth identity, trusted table/column configuration and validated private progress. No caller may derive the identity or SQL identifiers from submitted JSON. The integration Worker supplies a strict progress fixture. The permanent progress schema, portfolio mapping and migration belong to Phases 11B/13.

The web Worker forwards the original request to the named jobs entry before OpenNext conversion. The integration endpoint accepts at most 8,192 wire bytes, parses fatal UTF-8 and validates strict action bodies. Submitted changes are bounded to 5,120 serialized UTF-8 bytes including their paths. Individual appended batches and string pieces are at most 4,096 bytes. Larger trees use several small validated changes inside one attempt. Larger free-text strings use ordered pieces. The Worker never reads the assembled string or the canonical 1 MiB document.

| Operation | Behavior |
| --- | --- |
| `patch` | Validate a small set/append/remove operation using the stored discriminator and shared schema. D1 checks complete-document references/size and writes content, progress and the incremented revision together under compare-and-swap. |
| `begin` | Clone the confirmed canonical revision into a private, session-bound attempt inside D1. Record proposed private progress and a random attempt ID. One attempt per owner. Recover a lost response through `pending`. |
| `change` | Apply one validated bounded operation to an attempt at its exact sequence number. Canonical content and progress remain unchanged. |
| `string-start` | Check that the selected path is free text, lock the attempt into string mode and clear previous retained string pieces. Constrained URLs/emails/IDs use ordinary validated replacements. |
| `piece` | Append canonical JSON string interiors in sequence. The server bounds encoded size, rejects reordered/mutated retries and prevents a surrogate pair from straddling pieces. A string has at most 512 pieces and 1 MiB of encoded content. Pack pieces close to 4 KiB without splitting surrogate pairs; every permitted 1 MiB string fits these transport bounds. |
| `string-finish` | Assemble the string inside D1 and check minimum length, total document size and cross-document invariants. Canonical content remains unchanged. |
| `commit` | Atomically compare the base revision, recheck active ownership/session/deletion and preserve the permanent milestone. Update canonical content and private progress, increment revision once and retain a small committed receipt. |
| `pending`, `status` | Read only the authenticated owner's bounded attempt metadata, never its draft or pieces. `status` requires the attempt's current session. |
| `resume` | Explicitly transfer an unfinished attempt to another active session of the same owner. Increment sequence and clear the last retry digest so the old session cannot write. Repeating resume from the new session is safe. |
| `abort`, `cleanup` | Explicitly discard staging and delete at most 32 piece rows per cleanup call. Cleanup also handles expired, terminal and revoked-creating-session attempts. Canonical content never changes. |

Active attempts expire after one hour. Expiry denies continuations and commits; it does not physically delete rows. Cleanup is owner scoped, authenticated and repeatable. Later garbage collection must sweep dormant owners in bounded batches. The one-attempt, 512-piece and byte bounds cap abandoned storage while that integration is pending. Clear committed receipts only after the client records the confirmed revision, because cleanup intentionally removes commit-retry evidence.

## Validation and retries

Every write checks persisted session expiry, ownership and `user.deleting_at`, in addition to the real Better Auth middleware. Only configuration is cached. SQL conditions prevent revocation between authentication and mutation from allowing a write. Each staged mutation uses a sequence compare-and-swap. Repeating the immediately preceding identical command returns its acknowledgement; an older or mutated command conflicts. Commit receipts return the original confirmed revision until expiry/cleanup. Direct patches use revision conflicts. After a lost direct-patch response, the client must read/reconcile the canonical revision before retrying.

Shared Zod schemas validate each submitted subtree or leaf. SQL additionally enforces document bytes, component/link/entry/category ID uniqueness, singleton types, case-study slug uniqueness, skill category references, sample-marker targets and work-date order. The server never accepts a client validation flag. A link kind/value pair changes together by replacing the link object. Construct large trees from small valid objects with empty text/arrays, then append or stage their contents. Use an attempt when intermediate edits must stay private.

Canonical drafts must already have passed the complete shared schema. The repository incrementally validates changes; it cannot repair arbitrary corrupted rows. Product integration must retain the validated migration/read path and fail closed for unsupported versions. Future schema refinements must update both the path resolver and SQL cross-document checks, with equivalence tests. Discriminator fields cannot change independently; replace their containing component/node instead.

For supported stored versions, product reads should check small version/ownership metadata and return the already validated canonical JSON without rerunning full-document Zod parsing in one request. Full-size revalidation or future nontrivial migrations need their own bounded execution path and measurements. The standalone complete-schema/migration helpers remain the reference contract; importing them does not make a maximum-size synchronous HTTP validation Free compatible.

The approved destination limits narrow the original version 1 validator without rewriting existing data. A version 1 marker alone therefore does not prove that a legacy row satisfies this new contract. Before enabling incremental saves on legacy rows, product integration must establish a validation generation through bounded validation and explicit owner correction of longer destinations. Do not mark a row validated or truncate its data just because the envelope version matches. This experiment creates current-valid fixtures and adds no production backfill or migration.

## Integration and tradeoffs

Only the isolated integration entry exposes these actions today. Product routing remains the shared authenticated owner entry. Do not ship the failed full-body experiment as a Free-tier save route. Phase 13 should map this repository to permanent portfolio/progress columns, migrate the integration tables, expose strict product action schemas and retain private error responses. Phase 14 supplies orchestration, pending/resume/discard decisions, conflicts and local invalid-input recovery. No editor or Figma changes are part of this increment.

Small edits use one request and one canonical row write. A full replacement uses hundreds of serial requests, extra rows and cleanup. High round-trip latency can make it slow. Clients should send changed fields and coalesce keystrokes instead of restaging the complete document after each edit. One attempt per owner requires coordination between tabs/devices. Reference changes can require several ordered operations in an attempt. D1 performs more work and may become the throughput bottleneck even when Worker CPU passes. Provider p95 measurements do not guarantee every invocation, cold request or future dependency version stays below 10 ms.

The integration SQL remains outside production migrations. The experiment changes no production data or routes. Focused Git commits retain the baseline, optimization and bounded protocol separately. See the results for measured quotas and rollback instructions.
