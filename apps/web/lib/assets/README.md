# Private assets

The web Worker dispatches `/api/assets` before OpenNext. `DRAFT_BUCKET` remains web-only. Shared upload/crop controls and the private editor preview use these routes. Production editor/guide routing and source-transfer RPC activation remain separate work. Phase 20 adds private provider-photo retrieval for the shared crop controls.

## Upload contract

`PUT /api/assets` accepts a binary body with these headers:

| Header | Value |
| --- | --- |
| `Origin` | The exact application origin. |
| `X-Expected-Owner-Id` | The authenticated owner's expected ID. This is a precondition, never an identity source. |
| `X-Asset-Purpose` | `avatar`, `banner`, `face`, `project`, `case_study`, `resume` or `og`. |
| `Content-Type` | `image/jpeg`, `image/png`, `image/webp` or `application/pdf`. |
| `X-Asset-Bytes` | Decimal `File.size` or `Blob.size`. Required when the browser/runtime does not supply `Content-Length`. When both exist, they must agree. |

Only `resume` accepts PDF. Other purposes accept JPEG, PNG and WebP. The image limit is 5,242,880 bytes. The PDF limit is 10,485,760 bytes. Clients set `X-Asset-Bytes` from the finished crop or PDF. Browsers control `Content-Length` themselves.

The handler checks magic bytes across chunk boundaries and counts the complete request independently. It rejects unsupported types and purposes, oversized bodies, missing framing, declared/actual mismatch and incomplete signatures. Signature checks identify the supported media container. They do not decode or re-encode the file. The shared crop controls decode and re-encode the selected crop in the browser before sending this request.

Reads have a five-second idle deadline and transfers have a thirty-second total deadline. Writes use a `FixedLengthStream` and await backpressure. Failed consumed transfers cancel their input and storage streams. The HTTP runtime disposes unread rejected bodies. Explicitly canceling those bodies can reset the connection before the rejection reaches the client. Every request uses uncached Better Auth identity and persisted session, account deletion and portfolio deletion predicates. Authorization repeats during pending creation, ready finalization and private reads.

A successful upload returns HTTP 201 and `{id,purpose,contentType,bytes,status:"ready"}`. The server generates the ID and `draft/{portfolioId}/{id}` key. Requests cannot select an identity, portfolio, ID, key or status. Every retry allocates a new asset. Store the new draft reference only after success. Existing ready assets remain unchanged.

The lifecycle is `pending` to `ready` after successful R2 storage and conditional D1 finalization, or `pending` to `failed` after rejection. An uncertain D1 finalization is reread before cleanup. Cleanup cannot change a ready row to failed. Unavailable reconciliation leaves a private pending row/object. Failed R2 cleanup can leave a private failed object. Phase 51 upload collection (below) removes both after a day.

## Private reads and readiness

`GET /api/assets/{id}` returns the current owner's ready object only. An optional `?purpose=avatar` query requires that exact stored purpose. An invalid or mismatching purpose returns the same empty 404. Reads without the query retain their existing behavior. Browser preview checks send `X-Expected-Owner-Id` before resolving the canonical image URL. Signed-out, foreign, revoked, expired, deleting, pending, failed, absent and inconsistent-size objects return an empty 404. Responses use private/no-store, nosniff, same-origin Cross-Origin-Resource-Policy and `Vary: Cookie`. PDF responses use an attachment filename supplied by the server. `GET /api/assets/{id}/view?purpose=resume` is the inline variant for the full-page preview's embedded viewer. It requires the `resume` purpose and a stored PDF, repeats every check above and returns `Content-Disposition: inline`, `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`; any other purpose or media type returns the same empty 404.

`resolvePrivateAsset(env, identity, id, purpose)` is the reusable owned-ready-purpose check for future setup and publication validation. The identity must come from the authentication library. The resolver repeats persisted authorization, requires the exact purpose and checks R2 existence and byte size. It returns a private R2 body, which callers must consume or cancel. It does not grant jobs access to the draft bucket and does not produce a public URL.

The inactive S-8 `PublicationAssets` named Worker entry supplies the candidate transfer contract. It accepts a candidate/lease/asset/purpose ticket through a service binding only, derives the private key from D1, and checks persisted ownership, deletion, reachability, readiness, purpose and bytes before streaming. The default HTTP handler does not expose this entry. No production jobs binding is configured. Jobs never receives `DRAFT_BUCKET`.

The paid-at-launch decision authorizes local reuse of the integrated S-8 milestone. Historical Free failures and final paid-provider verification remain recorded; native capacity checks are release gates, not a requirement to upgrade during local development. Upload collection uses the database `publicationRetains` guard in addition to draft, staging, transfer and source references. It conservatively protects the portfolio before candidate indexing, then protects sealed references even before transfer-row discovery and after removal from the current draft. Account deletion must revoke transfer before cleaning both candidate records/objects and draft objects. Passing local upload tests does not establish deployed transfer CPU or shared capacity.

## Upload collection (Phase 51)

`collectUploads(env, now)` (`collection.ts`) is one bounded pass, reached only through the `PublicationAssets` entry's `POST /upload-collection`, which the jobs cron calls every fifth minute. It takes no input. It deletes the objects of the rows `collectAbandonedUploads` removed (see [`packages/db`](../../../../packages/db/README.md#operator-controls-and-cleanup-phase-51) for what is never eligible: unfinished setup, draft, staged and sealed-candidate references), then lists one page of `draft/` from a stored cursor and deletes objects older than a day that no asset row or unfinished account deletion accounts for. Rows go before objects, so a failed object delete only leaves an orphan for a later pass.

## Verification

`pnpm e2e --project=api -g uploads` runs the upload suite after `pnpm build`. The dedicated integration entry imports the production web Worker and uses real local D1/R2, signed Better Auth cookies and Chromium File fetch/XMLHttpRequest requests. Controlled failures exist only in the integration entry. Tests also send real HTTP chunked bodies, exercise idle and total deadlines, abort before and during transfer, delay storage past the deadline, and revoke a session during private lookup. Routine evidence stays under ignored `.wrangler` directories.

## Shared crop controls

`ProfileImages({controller, disabled})` adapts avatar and banner controls to the existing draft controller. Each upload control is keyed by controller scope and purpose so a recovery replacement releases the old selection and cancels its upload. Direct `ImageUpload` callers must give each owner/controller/purpose lifetime its own React key. Valid descriptions, successful ready references and explicit removals use the same controller and recovery journal as other fields. Upload selection, canvas work and retry blobs remain transient browser state. They are not a second save queue.

The source image's container signature must match its selected media type before browser decoding. A GIF renamed as PNG is rejected before re-encoding. The crop dialog uses the renderer's 212:220 avatar and 10:3 banner geometry, and the 1200×630 (1.91:1) card shape for the `og` sharing image. Pointer dragging and keyboard arrows reposition the image. A native range input and zoom buttons control zoom. Reset restores the currently open selection. Apply re-encodes to WebP, falling back to the browser's PNG encoder when WebP encoding is unavailable, then uploads only those finished bytes. The modal uses the read-only Figma onboarding reference. Its avatar ratio intentionally matches the existing renderer rather than the reference's square frame.

Only HTTP 201 with a matching ready receipt can replace a reference. Cancellation, network failure, unsupported/oversize/undecodable files and failed encoding retain the previous reference. Retry resends the prepared crop to a new immutable asset. Reopening Crop fetches only the saved crop. Recovering excluded pixels requires selecting the original file again. Source files and crop coordinates do not enter draft JSON, IndexedDB journals or private storage.

`resolvePreviewImages` checks owner, purpose, readiness and existence through private GET before returning trusted same-origin URLs to the display projection. The preview iframe reauthorizes its owner before mounting and after browser restoration. Publication still requires its separate readiness validation, immutable promotion and serving contracts.

`ProjectControls` also reuses `ImageUpload` with purpose `project`, keyed by controller scope, component and entry ID. It validates and decodes the local JPEG/PNG/WebP, then uploads the supplied bytes without a forced crop. Replacement, removal, description, pending-publication flags and retry use the same private asset/controller boundary. Only a matching ready receipt replaces the previous reference. Project sources and retry blobs remain transient. Avatar/banner crop geometry and encoding remain unchanged. Phase 30 case-study images use the same uncropped path with purpose `case_study`, and the upload's ready asset ID is the only way an image node enters a case-study body.

`SharingControls` (the editor's Sharing panel) reuses `ImageUpload` with purpose `og`, keyed by controller scope, and the cropped 1200×630 image. A ready receipt sets `seo.ogImage`; removal deletes it so the generated profile card applies again. It has no description field, and a pending upload holds the `og` pending-image flag. Its sharing card shows the upload through `/api/assets/{id}?purpose=og`, or draws the generated card with `SharingCard` from the banner and avatar at `?purpose=banner` and `?purpose=avatar`, never a public URL.

Phase 34 `ResumeUpload` (in `resume-controls.tsx`) uploads one PDF with purpose `resume` through `uploadResume`. `resumeFile` checks the PDF type or `.pdf` name, size up to 10,485,760 bytes and the `%PDF-` signature before sending. A ready receipt replaces `components[resume].data.file`, and removal deletes that reference. A failed or cancelled upload keeps the current reference and holds a `resume:{componentId}` pending-publication flag until retry or cancel. The editor section and the publication correction panel reuse the same control. `resolvePreviewImages` resolves a resume only from an `application/pdf` private response.

## Provider photo import

`GET /api/assets/provider-photo` accepts no caller URL, asset ID or purpose. It uses the authenticated account's stored sign-in image. `X-Expected-Owner-Id` is mandatory. Before and after retrieval, the repository requires a live persisted session, an account outside deletion, and an owned portfolio outside deletion. Unavailable, foreign, expired, revoked and malformed requests return the same empty private 404. Responses retain the private image cache, origin and content-type headers.

Only HTTPS on exact hosts `avatars.githubusercontent.com`, `lh3.googleusercontent.com`, `lh4.googleusercontent.com`, `lh5.googleusercontent.com` and `lh6.googleusercontent.com` is permitted. URLs with credentials, fragments or nondefault ports are rejected. Redirects are refused. The outbound request sends only an image Accept header and omits credentials. Other stored hosts require manual upload. No request value can select a remote target.

Retrieval has a fifteen-second total abort deadline. The handler accepts JPEG, PNG and WebP, counts actual streamed bytes against 5,242,880 bytes, validates any declared Content-Length and checks container signatures. The browser must also decode the image through `openLocalImage`. A valid signature alone cannot prove decodability. This route creates no asset metadata or R2 object and returns no remote URL.

`ProfileControls` requests private account suggestions only after Check my account suggestions. Use my account photo appears only when a supported photo is reported. It repeats the owner/portfolio-scoped lookup before retrieval. The downloaded source enters the same crop dialog as local selection. Apply crop encodes and uploads through `PUT /api/assets`; only the matching ready receipt can replace the avatar and clear its sample marker. Cancel, a failed import or upload, controller replacement and suspension preserve the previous reference. Failed imports offer retry or manual upload. Neither sources nor suggestions enter draft JSON or recovery journals. Account email remains a separate deliberate public-link choice.

Reimporting retrieves the current account photo again. It does not restore a retained original, a previous provider image or earlier crop coordinates.

The editor browser suite drives these controls with production authentication, D1/R2, retrieval validation and cropping. Its isolated gateway replaces external provider image HTTP with fixtures and refuses unexpected egress. It does not prove live provider availability or deployed CPU limits.

Phase 22A's web setup handler calls `resolvePrivateAsset` for required avatar/banner objects before permanent handoff. It cancels the returned bodies after checking metadata, purpose, ownership, existence and byte size. D1 rechecks ready metadata and active access at the milestone write. Jobs receives no private-bucket binding. Cleanup must preserve immutable objects referenced by active drafts; account deletion revokes access before cleanup.
