# Owner draft API

The HTTP contract for reading and saving the private draft. The browser side lives in [`apps/web/lib/draft`](../../apps/web/lib/draft/README.md); the server side is the named jobs `OwnerApi`, reached through the web Worker's forwarding adapter before OpenNext. The jobs default HTTP entry does not expose these routes.

## Common rules

- Better Auth resolves identity with cookie caching disabled. Every database operation rechecks the persisted session, ownership and deletion state. Draft/progress actions use a direct persisted-session precheck instead of building unused owner repositories.
- Every request sends `X-Expected-Owner-Id`. The server compares it with the authenticated identity before any draft work: missing returns 400 `invalid_input`, mismatch returns 409 `owner_changed`. It is a stale-account check, not authorization. Clients verify the returned portfolio ID.
- Mutations require the exact application `Origin` and a JSON media type.
- Every response is `private, no-store`, `noindex` and `Vary: Cookie`.
- Missing portfolios return 404 on reads and writes. No route provisions a portfolio.

## Reads

- `GET /api/owner/draft` returns `{ portfolioId, draft, revision, progress, firstEditorEnteredAt }`. D1 builds the JSON in one consistent snapshot query and returns text chunks of at most 65,536 code points (surrogate pairs preserved). The Worker streams the chunks without parsing, revalidating or reserializing the draft. Validated version 1 envelopes project as version 2; persistence upgrades on save. Requires validation generation 2: unvalidated content returns 409 `validation_required`, unsupported envelopes 409 `unsupported_version`.
- `GET /api/owner/progress` returns the same metadata without `draft`. Progress is `{ schemaVersion: 1, step }`; it is navigation, never proof of required completion.
- `GET /api/owner/draft/recovery` returns an attachment with the original canonical draft and metadata, including unvalidated or unsupported content. It is a recovery download, not a validated read, and does not expose staging.

## Writes

`POST /api/owner/draft/:action` with a strict JSON body.

Limits: 8,192 wire bytes per request, 5,120 serialized change bytes, 4,096 bytes per appended batch or string piece (including JSON quoting), 512 pieces, a 1,048,576-byte canonical or staged document, one attempt per owner, one-hour attempt expiry. UTF-8 decoding is fatal and bytes are counted while streaming, so `Content-Length` cannot bypass the limit.

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

A `change` is `{ op: "set", path, value }`, `{ op: "append", path, values }` or `{ op: "remove", path }`. Paths are schema-bound string/index arrays, never SQL identifiers or storage keys. Changing a discriminator or a link's kind/value replaces the containing object. Build large arrays and trees from bounded changes; use string pieces only for free text. Cross-document invariants are enforced inside D1.

Semantics:

- Setup writes save content and progress together and increment the shared revision once. Content writes preserve private progress. `progress` is a real CAS on its own.
- No save hands off to the editor, publishes, uploads, changes connected services, or reserves an address. Address reservation has its own explicit confirmation command (see [architecture](../architecture.md#address-reservation-and-claim)).
- Attempts persist their context; continuations cannot change it. After first editor entry, setup writes (including prepared attempts) are rejected with `setup_closed`; progress and the milestone are frozen. Content stays writable.
- `patch`, `progress` and `commit` return `{ revision }`; `begin` returns `{ id, sequence }`; staged commands return `{ sequence }`. Retrying the immediately previous identical staged command returns `replayed: true`. Old or mutated sequences conflict. Commit retries return the original revision, including a committed setup receipt after handoff.
- A lost direct-patch response requires a canonical read and reconciliation before retrying.

## Attempts and recovery

`pending`, `status` and `resume` expose only attempt ID, base revision, sequence, state, context, expiry, piece count, string path, resume requirement and validation status/issue. They never expose session IDs, retry hashes, cursor internals, drafts or pieces. `pending` may reveal that another session owns an attempt; `status` requires its own session. `resume` transfers an open attempt to the current session and invalidates old sequence/retry state.

Client obligations (enforced in `apps/web/lib/draft`, not by payload shape):

- Sequence advancement alone does not prove which command ran. Replay the identical command to verify its server hash. A commit receipt confirms a batch only when every command was acknowledged and the final sequence matches; otherwise reconcile canonical content.
- A lost `begin` reply has no verifiable attempt ID: explicitly discard staging and rebuild from preserved local input.
- Verify uncertain commands before `resume`, since resume clears replay hashes. Transfers require exactly the expected sequence increment.
- Discard journals pin the displayed attempt ID and survive lost abort/cleanup replies.
- A known newer canonical snapshot is never replaced by an older receipt.

`abort` discards staging. `cleanup` deletes at most 32 piece rows per call, then eligible empty attempts (terminal, expired, or created by a revoked session). Expiry blocks writes immediately but does not delete rows. Do not clean up a committed receipt before recording its revision. The jobs cron also collects dormant staging: attempts expired for a week whose owner has no live session (see [`packages/db`](../../packages/db/README.md#operator-controls-and-cleanup-phase-51)).

## Legacy validation

Content with a validation generation below 2 must be validated before ordinary saves. The offline whole-document validator is never exposed over HTTP.

- `validation-begin` clones an unvalidated supported draft into the owner's single attempt slot and projects the version 1 upgrade inside D1. Unsupported or malformed envelopes stay available through the recovery download.
- Each `validation-step` advances a server-owned cursor over at most four fresh nodes (two when the cursor path is deeper than 24), within the approved ceiling of 16 nodes and 4 KiB of validation data. It returns `{ sequence, complete, issue, examined, validationBytes }`. The first failure returns a bounded `{ path, code }` issue. Identical retries return the recorded outcome. Clients cannot submit cursors or flags.
- Destination values are read only within their bound: 254 bytes for email links, 2,048 for URLs. Over-limit values produce a field issue without loading the value into Worker memory.
- `validation-correct` can only replace the currently rejected destination, checks the resulting size in D1, stays private in staging and restarts traversal. Structural problems remain blocked for explicit recovery.
- `commit` requires finished validation, no issue, the original base revision and an active session. It installs the content, generation 2 and the next revision atomically and preserves progress and the milestone.
- Clients keep raw correction text separately, bound to its issue path and base revision, and only drop it once the exact validated revision is fetched. Unfinished validation without its matching browser journal needs the original browser or an explicit discard.

Schema or refinement changes must update incremental validation, generation policy and its equivalence tests together.

## Errors

Business errors return `{ error }` with one of `owner_changed`, `revision_conflict`, `attempt_conflict`, `attempt_unavailable`, `setup_closed`, `validation_required`, `unsupported_version`, `invalid_input`, `byte_limit`, `save_rejected`, `storage_unavailable`, `unauthorized`, `not_found`.

Status codes: malformed JSON/UTF-8 400; byte limits 413; invalid schema or path 422; stale or blocked writes 409 (including final size/reference rejections as `save_rejected`); storage failures 503. Conflict responses never include a newer document; fetch and reconcile separately. Error bodies exclude exception messages, submitted content and SQL.

## Tests

`e2e/draft-api.spec.mjs` sends real requests through the built web Worker and jobs router with synthetic sessions signed by the real Better Auth algorithm. Fixture SQL and failure injection exist only in the separately built integration entries under `apps/*/integration`, never in production imports.
