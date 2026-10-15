# Phase 07 acceptance criteria

- [x] Verification, contact, and failure-notice messages use the fixed sender and one recipient; contact uses visitor Reply-To; hostile input remains plain text.
- [x] Workerd fixtures cover provider acceptance, permanent rejection, timeout, network failure, malformed response, daily/monthly quota, rate limits, Retry-After, and idempotent replay/conflict.
- [x] Atomic D1 reservations enforce site/global/test/notice limits under concurrent requests, preserve notice capacity, reuse reservations on retry, and reset at UTC midnight.
- [x] Dispatch guards enforce 100 attempts per UTC day and 3,000 per UTC month independently of acceptance reservations, including cross-day retries.
- [x] Live Resend domain status confirms SPF/DKIM and all three messages reach delivered status. Record acceptance separately and leave incomplete checks pending.
- [x] Lint, TypeScript, unit tests, and the isolated workerd/D1 spike pass; evidence and limitations are recorded without private data.
