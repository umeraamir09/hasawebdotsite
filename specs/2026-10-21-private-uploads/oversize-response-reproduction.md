# Oversized upload response failure

Observed October 21 and reproduced October 22, 2026 on base `89acb72831bf8c05b22b39cdf350245dfdf87a5b` with the uncommitted Phase 18 implementation.

`pnpm test:uploads` first passed Chromium File fetch and XMLHttpRequest uploads, then failed in the exact-limit group. The PNG request contained 5,242,881 bytes and expected HTTP 413. The October 21 run instead received HTTP 500 with `Error: Network connection lost`. The October 22 reproduction received a client `fetch failed` error with `write ECONNRESET` after an oversized response on the reused connection.

The production handler canceled unread request bodies in its outer `finally`. The failing checks keep the same asserted HTTP 413 response. Routine logs and randomly generated fixture credentials stay in ignored run directories.

Original run `.wrangler/verification/2026-10-21T15-21-52.939Z-HskBoA` included a passing production web build. Reproduction run `.wrangler/verification/2026-10-22T03-04-29.411Z-r7wPnX` ran the upload suite under the shared resource lock.

Removing only the outer eager cancellation lets the same exact-limit group pass for JPEG, PNG, WebP and PDF in `.wrangler/verification/2026-10-22T03-05-33.908Z-phOOJQ`. That group also sends actual HTTP chunked oversized bodies with the declared-size fallback, preserving the HTTP 413 assertion. Streamed transfers still count bytes, enforce deadlines and cancel on failure. The HTTP runtime owns unread rejected transport bodies. All 11 upload groups pass after the abort cleanup and fixture correction in `.wrangler/verification/2026-10-22T03-20-44.617Z-u9oMcM`. The exact-limit and oversized-response assertions remain unchanged.
