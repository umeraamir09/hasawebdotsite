# Private assets

The web Worker dispatches `/api/assets` before OpenNext. `DRAFT_BUCKET` remains web-only. No editor route, preview resolver, provider import, crop control or source-transfer RPC is activated here.

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

The handler checks magic bytes across chunk boundaries and counts the complete request independently. It rejects unsupported types and purposes, oversized bodies, missing framing, declared/actual mismatch and incomplete signatures. Signature checks identify the supported media container. They do not decode or re-encode the file. Client crop/re-encoding remains Phase 19.

Reads have a five-second idle deadline and transfers have a thirty-second total deadline. Writes use a `FixedLengthStream` and await backpressure. Failed consumed transfers cancel their input and storage streams. The HTTP runtime disposes unread rejected bodies. Explicitly canceling those bodies can reset the connection before the rejection reaches the client. Every request uses uncached Better Auth identity and persisted session, account deletion and portfolio deletion predicates. Authorization repeats during pending creation, ready finalization and private reads.

A successful upload returns HTTP 201 and `{id,purpose,contentType,bytes,status:"ready"}`. The server generates the ID and `draft/{portfolioId}/{id}` key. Requests cannot select an identity, portfolio, ID, key or status. Every retry allocates a new asset. Store the new draft reference only after success. Existing ready assets remain unchanged.

The lifecycle is `pending` to `ready` after successful R2 storage and conditional D1 finalization, or `pending` to `failed` after rejection. An uncertain D1 finalization is reread before cleanup. Cleanup cannot change a ready row to failed. Unavailable reconciliation leaves a private pending row/object. Failed R2 cleanup can leave a private failed object. A later lifecycle reconciler must retry these cases. This phase adds no orphan sweep or durable retry queue.

## Private reads and readiness

`GET /api/assets/{id}` returns the current owner's ready object only. Signed-out, foreign, revoked, expired, deleting, pending, failed, absent and inconsistent-size objects return an empty 404. Responses use private/no-store, nosniff, same-origin Cross-Origin-Resource-Policy and `Vary: Cookie`. PDF responses use an attachment filename supplied by the server.

`resolvePrivateAsset(env, identity, id, purpose)` is the reusable owned-ready-purpose check for future setup and publication validation. The identity must come from the authentication library. The resolver repeats persisted authorization, requires the exact purpose and checks R2 existence and byte size. It returns a private R2 body, which callers must consume or cancel. It does not grant jobs access to the draft bucket and does not produce a public URL.

Jobs promotion and lifecycle deletion still require a specified and measured authorized source-transfer contract. Passing local upload tests does not establish provider CPU or source-transfer feasibility.

## Verification

`pnpm verify --profile=uploads --build=web` runs the repository checks, web build and `test:uploads` through the shared resource lock. The dedicated integration entry imports the production web Worker and uses real local D1/R2, signed Better Auth cookies and Chromium File fetch/XMLHttpRequest requests. Controlled failures exist only in the integration entry. Tests also send real HTTP chunked bodies, exercise idle and total deadlines, abort before and during transfer, delay storage past the deadline, and revoke a session during private lookup. Routine evidence stays under ignored `.wrangler` directories.
