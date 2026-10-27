# Inactive publication preparation and dispatch

October 27, 2026: the [paid-at-launch policy](../../docs/deployment-policy.md) authorizes this tested `s8-v3` scaffold as the S-8 local development milestone. Integrate and check it before local Phase 24. Final native paid verification and production activation are release gates; upgrading the account is deferred until launch preparation.

October 27 implementation update: [Phase 24](../2026-10-24-immutable-publication/protocol.md) supersedes the scaffold-only artifact and `s8-v3` policy descriptions below. Migration `0012` also supersedes the global 128-record admission rule with 128 pending-candidate slots; retained-version references release their slots and deleted references reacquire cleanup slots. Historical measurements still describe the tested S-8 scaffold.

This is the S-8 prerequisite implementation, not a publication endpoint or a live version commit. The owner has authorized local reuse under the paid-at-launch policy; Phase 24 consumes the milestone after integration and applicable local checks. The public site Worker and existing live pointer remain unchanged.

## Accepted source and renderer units

Candidate creation verifies the uncached owner session, saved revision, structural generation and existing publication requirements. A single guarded SQLite statement captures a private source at that revision and returns only its ID. This seals the source atomically; later draft edits cannot alter it. No whole-draft parse or serialization occurs in a Worker. The private source omits setup/progress, untouched component samples, hidden links, disabled Face Reveal images and the private contact recipient.

A single private index row per sealed candidate records deduplicated typed asset references and page paths. Preparation uses array positions rather than repeated tree scans or OFFSET traversal. It does not persist a row per component. The index and source are deleted during cleanup.

The source stores links once. Preparation reads their two visibility projections through bounded SQL lookups. This avoids duplicating a near-limit link collection inside a D1 row.

Preparation maintains a bounded command stack and reads bounded JSON-encoded byte slices through hex transport. SQLite can encode escaped lone UTF-16 surrogates as CESU-8; converting those sequences to exactly one replacement scalar before UTF-8 decoding preserves the shared renderer's normalization. Byte cursors retain complete escape/scalar boundaries, including real replacement characters and astral Unicode. It preserves escape boundaries, UTF-16 surrogate pairs, CRLF normalization and the renderer's display normalization. Input strings retain their saved values. Controlled open/close frames preserve nested list and section wrappers while oversized text and descriptions span units. Adjacent text reads share at most one 32 KiB encoded SQL window within an invocation. Fragment strings and byte cursors remain bounded. Small components use grouped calls to the actual shared component renderer; small project entries reuse the same project-card view; text, frames and image units use the same renderFragment entry and shared views. The offline renderer is only the independent test oracle.

The first page prepares the shared profile once. Later pages stream its retained bounded parts before their own content. Profile receipts and reused-part cursors use the same fencing and exact-output checks. Each private probe page has its own ordered chunks and D1 completion record. Portfolio, case-study rich text and the current resume representation share the actual profile, text and image views. These private probe pages do not establish final serving, resume controls, public case-study routing or a complete production manifest. Final delivery integrations must repeat measurements when they change the work.

## Dispatch and recovery

Queue packets contain a candidate UUID only. D1 owns the immutable revision, execution policy, command or assembly cursor, page records, transfer records, sequence, lease token, due time, attempts and status. A successful lease claim consumes an attempt, including when the invocation crashes before recording an error. A successful checkpoint resets the consecutive-attempt counter.

Every checkpoint checks the candidate, sequence, current phase, lease token, lease expiry and active owner. Candidate policy pins the renderer version, logical batch size and exact asset origin. The current policy is `s8-v3`. A new renderer version must reject unsupported unfinished candidates rather than mix serialization policies; cleanup may remove old formats.

Private R2 keys have a server-generated candidate prefix, page number, assembly level and ordered index. Retries reproduce the same bytes at the same keys. Assembly streams at most sixteen inputs into one object, with the same idle/total byte-transfer deadlines as private asset copies. It marks each complete page before moving to the next; asset transfer cannot report ready while a page remains incomplete.

Continuation messages are wake-ups for D1 state. Unknown send acknowledgements and duplicate deliveries cannot choose a source revision or restore an old cursor. Sweeping re-drives due work and expired leases. Four consecutive failed or crashed claims or the one-hour work deadline terminate an attempt. An active fourth claim may finish; sweeping must not cancel it merely because its counter reached four.

## Private asset boundary

The draft bucket remains bound only to web. Jobs calls the named PublicationAssets service entry through an explicit binding. The default web HTTP handler does not route requests to that entry.

Requests contain the candidate, current lease token, asset ID and exact purpose. The service derives identity and object keys from persisted candidate/transfer records. It checks reachability, active owner and portfolio, readiness, purpose, media type, size and lease before reading R2, then repeats the authorization after the read. It streams private/no-store bytes with the expected length. Jobs bounds idle and total transfer time, counts bytes, and rechecks the current lease and owned asset metadata before recording completion.

The deployed measurement buckets have public access disabled. Neither a source URL nor private bucket credentials enter a Queue message, preview, page or public manifest. Accepted background work survives ordinary session expiry but account/portfolio deletion prevents a ready checkpoint.

## Cleanup, measurements and approval

Cleanup touches only the candidate's private output prefixes, retains draft sources and keeps failures retryable. Cleanup also runs after owner deletion, so its sweep guard deliberately differs from active preparation. Admission permits at most one source per portfolio, four sources globally, and 128 candidate records. Ready private probes expire after one hour. Cleaned tombstones are rechecked for late objects and physically removed after at least 24 hours and an empty two-bucket check. Sweeps process bounded groups, so physical deletion can lag the minimum retention window. Cleanup clears source/index and owner identifiers; storage failure keeps a retryable cleanup ticket. Four consecutive cleanup failures scrub its private source, reference index and owner identifiers while retaining the prefix ticket for explicit retry; they do not redeliver forever. The reusable `publicationRetainsAsset` guard conservatively protects all assets in a portfolio before its source index exists, then protects indexed references even before transfer rows exist. A future collector must combine it with draft/live-version reachability. General account asset storage and permanent cleanup failure remain separate feasibility concerns.

Quota instrumentation records jobs and source-service D1 counters separately and counts R2 and Queue calls. It is disabled for native provider CPU runs. The consumer is a separate deployed Worker so fixture HTTP polling cannot dilute its CPU statistics. Provider fixtures seed synthetic records outside the measured path. Their keyed SQL and fault endpoints are absent from product handlers.

The completion record must link local verification, native warm/cold samples, instrumented provider counters, shared daily/monthly forecasts, storage assumptions and the focused boundary review. Historical S-8/S-9 failures remain intact. Passing local output parity is not approval of Free feasibility, integration, publication activation or the unresolved S-9 withdrawal policy.
