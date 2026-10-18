# Production draft API

All routes use the existing web Worker forwarding adapter and named jobs `OwnerApi`. The jobs HTTP default entry does not expose them. Better Auth resolves identity with cookie caching disabled, and each repository query rechecks the persisted session, ownership and deletion state. The large draft read uses read-only session lookup and performs its access check in the consistent content query, avoiding unused cookie-refresh work and a redundant repository-construction query. Existing authentication/status refresh behavior remains intact. Mutations require the exact application Origin and JSON media type. Every response is private/no-store, noindex and varies by Cookie.

## Reads

- `GET /api/owner/draft` returns `{ portfolioId, draft, revision, progress, firstEditorEnteredAt }`. D1 builds the response JSON in one materialized snapshot query and returns text chunks of at most 16,384 Unicode code points. Worker JavaScript encodes each chunk into a response stream without parsing/revalidating/serializing the full draft or allocating another complete document buffer. SQL character boundaries preserve surrogate pairs. Supported validated version 1 envelopes project as version 2; persistence upgrades on save. A stored validation generation of 2 is required.
- `GET /api/owner/progress` returns the same metadata without `draft`, loading no content. The progress contract is `{ schemaVersion: 1, step }`; navigation never proves required completion.
- `GET /api/owner/draft/recovery` returns an attachment with the original canonical draft and its metadata, including unvalidated or unsupported content. This is an owner recovery download, not a validated content read. It does not expose staging.

Missing portfolios return 404. Normal draft reads return 409 `validation_required` for unvalidated content and 409 `unsupported_version` for unsupported envelopes. Neither read provisions a portfolio. The existing owner-status and initialization contracts remain unchanged.

## Writes and recovery

Send `POST /api/owner/draft/:action` with a strict JSON body. Limits remain 8,192 wire bytes, 5,120 serialized change bytes, 4,096 bytes per appended batch/string piece, 512 pieces, a 1,048,576-byte canonical/staged document, one attempt per owner and one-hour expiry. UTF-8 decoding is fatal; Content-Length cannot bypass streamed byte counting. A piece's limit includes JSON string quoting/escaping.

| Action | Body |
| --- | --- |
| `patch` | `{ context: "setup", revision, progress, change }` or `{ context: "content", revision, change }` |
| `progress` | `{ revision, progress }` |
| `begin` | `{ context: "setup", revision, progress }` or `{ context: "content", revision }` |
| `change` | `{ id, sequence, change }` |
| `string-start` | `{ id, sequence, path }` |
| `piece` | `{ id, sequence, text }` |
| `string-finish`, `commit` | `{ id, sequence }` |
| `pending`, `cleanup` | `{}` |
| `status`, `resume`, `abort` | `{ id }` |
| `validation-begin` | `{ revision }` |
| `validation-step` | `{ id, sequence }` |
| `validation-correct` | `{ id, sequence, path, value }` |

`change` is one of `{ op: "set", path, value }`, `{ op: "append", path, values }` or `{ op: "remove", path }`. Paths are schema-bound string/index arrays, never SQL identifiers or storage keys. Discriminator and link-kind/value changes require replacing their containing object. Build large arrays/trees with bounded valid changes; use string pieces only for free text. The original measured protocol's cross-document invariants remain enforced inside D1.

Setup writes atomically save content/progress and increment the shared revision once. Content writes preserve private progress, including after first entry. Progress-only saves have a real CAS operation. Every successful canonical write updates `updated_at`. No save calls the handoff service, publishes, claims an address, uploads assets or changes connected services.

Attempts persist their context. A continuation cannot submit a new context; the handler selects the repository from the stored context. First editor entry permanently rejects setup writes, including prepared attempts. Content remains writable and recovery/cleanup remain available. Progress and the milestone remain frozen after entry.

Patch/progress/commit return `{ revision }`; begin returns `{ id, sequence }`; staged changes return `{ sequence }`. Retrying the immediately previous identical staged command returns `replayed: true`. Old/mutated sequences conflict. Commit retries return the original confirmed revision, including a committed setup receipt after handoff. A lost direct-patch response requires a canonical read and reconciliation before retrying.

Pending/status/resume expose only attempt ID, base revision, sequence, state, context, expiry, piece count, string path, resume requirement and validation status/issue. They exclude session IDs, retry hashes, cursor internals, drafts and pieces. `pending` may reveal that another session owns an attempt. `status` requires its current session. `resume` explicitly transfers open/string attempts and invalidates old sequence/retry state; a repeat in the new session is safe. Receipt recovery after a different session expires may require canonical revision reconciliation.

Abort explicitly discards staging. Cleanup deletes at most 32 piece rows per call, then eligible empty attempts. Expiry denies writes immediately without physically deleting rows. Cleanup handles terminal, expired and revoked-creating-session attempts, including after handoff. Do not call cleanup on a committed receipt before recording its confirmed revision. Dormant-owner scheduled garbage collection remains Phase 51.

## Legacy validation

Validation never calls the offline whole-document validator over HTTP. `validation-begin` clones an unvalidated supported draft into the same single-owner attempt slot, projects the known version 1 upgrade inside D1, and preserves canonical content/progress/milestones. Unsupported versions and malformed legacy envelopes stay available through raw recovery.

Each step reads a server-owned cursor and validates bounded nodes with the shared schema definitions. The cursor stores one path, child positions and checked ancestor discriminators/container lengths. Returning from a child does not reread its parent. The production batch is at most four fresh nodes, or two when the starting cursor path has more than 24 elements. Both stay within the approved ceiling of 16 and at most 4 KiB of cursor/metadata/scalar validation data. Containers check strict keys, duplicates, required/optional fields, discriminators, array and tuple constraints. Free text uses SQL type and empty/nonempty metadata, including embedded NUL and astral text. Constrained scalars use the shared validators within their byte limits. D1 checks cross-document uniqueness, sample targets, categories, slugs, dates and total size at completion.

The SQL descriptor reads a destination value only within its approved bound. Email links use their stored kind and a 254-byte bound; URL destinations use 2,048 bytes. An over-limit value produces a field issue without loading that value into Worker JavaScript.

A step returns `{ sequence, complete, issue, examined, validationBytes }`. The first failed field returns a bounded `{ path, code }` issue. An identical immediately preceding step retry returns the recorded outcome. The client cannot submit a cursor or validation flag. A correction can only replace the currently rejected destination, uses its stored link kind where applicable, checks the resulting document byte limit in D1, stays private in staging, and restarts traversal. Invalid structures/references remain blocked for explicit maintenance/recovery; this phase adds no repair UI or arbitrary legacy rewrite.

Commit requires finished validation, no issue, the original base revision, and an active session. It installs the validated staged content, generation 2, timestamp and next revision atomically while retaining progress/milestones. A concurrent save/handoff makes it conflict. Corrections, partial validation, failures and abort never change canonical data. Future schema/refinement changes must update incremental validation and its equivalence tests together.

## Errors and the Phase 14 boundary

Business errors return `{ error }` with `revision_conflict`, `attempt_conflict`, `attempt_unavailable`, `setup_closed`, `validation_required`, `unsupported_version`, `invalid_input`, `byte_limit`, `save_rejected`, `storage_unavailable`, `unauthorized` or `not_found`. Malformed JSON/UTF-8 returns 400; byte limits return 413; invalid submitted schema/path content returns 422; stale/blocked writes return 409; storage failures return 503. Existing authentication/origin/media-type/method guard responses retain their previous private contracts. Error responses exclude exception messages, submitted content and SQL. Final document-size/reference rejections can return 409 `save_rejected`; they never acknowledge a revision.

Phase 14 supplies changed-field coalescing, local invalid-input recovery, cross-tab coordination, pending/resume/discard orchestration and save-state UI. Phase 15 supplies conflict/reauthentication interaction. No autosave client, editor UI, setup routing or Figma change is included here.

## Reproduction

After `pnpm build`, run `pnpm test:draft-api`. `--benchmark --benchmark-only --samples=2` runs a short local endpoint/quota pass. `DRAFT_API_EVIDENCE` selects an evidence directory. The script uses synthetic sessions signed with the real Better Auth cookie algorithm and sends actual requests through the built web Worker and real jobs owner router. Fixture SQL, failure/revocation injection and measurement wrappers exist only in separately built integration entries.

For the isolated Cloudflare run, use the existing owner-runtime preparation/deployment/cleanup script with `--draft-api`, then run `scripts/owner-draft-api.mjs --remote --benchmark`. Keep the test database and workers.dev Workers isolated. Fixed-state preparation in benchmark requests runs before the actual handler; its CPU is included conservatively, while request-scoped row/query counters describe authentication plus the actual product handler. No fixture headers or preparation routes exist in production imports. Record provider analytics separately from elapsed client time, then delete both temporary Workers, the test database and local test secrets.
