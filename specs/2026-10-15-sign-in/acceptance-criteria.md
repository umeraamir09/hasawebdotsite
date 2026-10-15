# Phase 11 acceptance criteria

- [x] Both providers complete sign-up and returning sign-in against the product schema; either order of verified shared emails resolves to the same owner and existing portfolio.
- [x] Missing/unverified provider emails cannot merge accounts; failed/cancelled/malformed/replayed callbacks do not create sessions or change ownership. A fresh retry succeeds.
- [x] Only GitHub `user:email` and Google identity scopes are requested. Password/email-only authentication and unrelated account mutations are unavailable.
- [x] Signed-out, expired, revoked, and deleting sessions cannot access owner identity or protected editor content. Copied cache cookies fail immediately after sign-out.
- [x] Exact apex, mutation Origin/JSON, callback destination, cookie isolation, no-store and noindex boundaries hold. Invalid configuration fails closed.
- [x] The sign-in screen follows the Figma reference on desktop/mobile, supports keyboard use, communicates pending/failure/cancellation, and retries. Authenticated entry and sign-out work.
- [x] Relevant unit/integration tests, lint, typechecks, and build pass. Results distinguish fixture evidence from unverified live provider/deployment behavior.

- [x] Owner-assisted live GitHub/Google sign-in, verified-email linking, returning access, sign-out, and Google cancellation/retry pass in the local runtime, with D1 observations recorded in `live-evidence.json`. Production deployment checks remain separate.
