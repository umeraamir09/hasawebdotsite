# S-6 results

October 15, 2026. The fixture suite and core live permission, visibility, and revocation checks pass. The separate no-scope platform credential has not been exercised live. The owner explicitly approved Phase 06 completion on October 15, 2026, with the platform credential check recorded as untested. The roadmap checkbox is now checked. This approval does not claim that the platform check passed.

## Local evidence

Run `pnpm spike:github` to reproduce [evidence.json](evidence.json). The isolated loopback-only Worker runs 40 checks in workerd with local D1 and Web Crypto. `pnpm test` also exercises the provider/policy matrix in Vitest. Production workers and provider accounts are unchanged.

Final pre-PR validation passed: 40 workerd checks, all 13 Vitest tests across 5 files, repository Biome checks, all 11 workspace TypeScript configurations, the additional spike TypeScript configuration, and `git diff --check`. Workspace type checks ran directly through the local TypeScript executable because Turbo selected a Windows pnpm executable that cannot use the WSL checkout path. No repository package-manager settings were changed.

- Explicit consent, exact stable ID, case-insensitive matching login, and a narrow `read:user` scope are required. Sign-in scope stays `user:email`.
- Authorized fixtures project only day/count data. Zero counts succeed. Extra provider fields and raw errors do not enter public output.
- Invalid tokens, scope loss, and identity mismatch remove private data. Transient failures preserve the successful calendar and fetch date. Local disconnect falls back to a safe baseline or an unavailable response without Publish.
- An injected clock exercises the confirmed six-hour visit TTL and daily private sweep interval. This tests eligibility and recovery policy, not a deployed scheduler.
- AES-GCM uses a random IV and binds ciphertext to the portfolio/grant. Wrong binding/key fail. D1 accepts a current-generation refresh and rejects an old-generation refresh after grant withdrawal.
- Responses use `Cache-Control: no-store`. No CDN purge integration is installed by this spike.

## Candidate implementation decisions

Use separate sign-in and activity OAuth applications. GitHub grant deletion removes all tokens for the application/user pair, so sharing an application complicates independent activity disconnect. Product callbacks still need authenticated owner checks, one-use state, PKCE, encryption, and durable grant-deletion retries. The fixture adapter starts after authorization and does not prove these browser flows.

Keep a public baseline and a separately authorized calendar. Select a whole calendar at read time while the grant is enabled; do not add both calendars or infer private daily counts by subtracting independently fetched totals. The authorized calendar can contain both public and private counts.

Treat the no-scope platform calendar conservatively. Restricted counts imply it may contain anonymized activity that must disappear after activity revocation. Return unavailable for that baseline until safe separation is demonstrated. Require a separate platform identity and an explicitly empty scope header. These checks cannot establish real GitHub visibility semantics by themselves.

Advance the connection generation when withdrawing, changing usernames, or authorizing a new grant. Condition refresh writes on the captured generation. Product persistence must make the generation and private-data changes atomic. A provider error from an old job must not withdraw a newly authorized grant either.

## Initial live observations

The real sign-in app completed matching-account authorization with S256 PKCE and exactly `user:email`. A successful GraphQL response covered 366 days, with 817 total contributions and `restrictedContributionsCount` of 392. Sanitized observations are recorded in [live-evidence.json](live-evidence.json).

This demonstrates that an identity/email-only token can obtain a calendar containing anonymized restricted contributions for this account and visibility configuration. Scope restriction alone cannot establish a public-only baseline. The conservative baseline rejection remains necessary. This observation does not prove the separate platform account's behavior or exact private daily counts.

After correcting the registered activity callback, the real activity app completed matching-account authorization with S256 PKCE and exactly `read:user`. Its GraphQL calendar request succeeded with 366 days and 817 total contributions, and the adapter accepted the response. Both tokens returned exactly the same calendar hash. The authorized response had `restrictedContributionsCount` of zero, compared with 392 for the sign-in token.

GitHub defines restricted contributions relative to what the viewer can access. Zero restricted contributions is not proof that a calendar contains no private contributions. In this observation it accompanies an unchanged calendar after matching-account authorization. Never use the authorized token's restricted count as a public-only classification or add the two calendars together. Known fixture accuracy and the alternate profile-visibility setting still require verification.

The initial `redirect_uri` registration error is resolved. The harness uses `http://localhost:3000/api/github/callback` for activity and `http://localhost:3000/api/auth/callback/github` for sign-in.

Local disconnect removed the authorized calendar/token from the active session before deleting the activity grant at GitHub. Provider deletion returned 204; the old activity token then returned 401, and the separate sign-in identity check passed. A subsequent sign-in calendar fetch still returned 200 with the same 817 total and 392 restricted contributions. This verifies grant deletion and sign-in independence for the two real test apps. The remaining sign-in calendar is diagnostic output, not a safe public graph fallback.

Reauthorization later succeeded for both apps. Both calendars now contained 818 contributions with the same hash, while restricted counts were 393 for sign-in and zero for activity. After the owner revoked only the activity app directly on GitHub, a subsequent manual refresh returned 401 for activity and removed its private data. Sign-in still returned 200. The saved event `external_activity_revocation: detected_401_private_data_removed` verifies the real revoked-token recovery path. This is a manually triggered local refresh; production six-hour visit refresh and daily sweep scheduling remain later-phase work.

The owner then disabled publicly displayed private contributions on GitHub and reauthorized activity. The sign-in token returned 425 contributions and zero restricted contributions; the authorized activity token still returned 818 contributions and zero restricted contributions, with its prior calendar hash unchanged. Both requests succeeded over the same 366-day window, and the adapter accepted the authorized projection. The 393-contribution difference matches the earlier restricted aggregate. This proves retrieval of activity hidden from the public profile with the matching account's explicit `read:user` authorization. It also demonstrates a real public-only visibility fixture on the same account. The owner may restore their preferred GitHub profile visibility setting.

## Acceptance evidence

| Phase check | Evidence |
| --- | --- |
| Separate sign-in and explicit activity authorization | Real separate apps grant exactly `user:email` and `read:user`; browser consent binds S256 PKCE and one-use state to the local owner. |
| Matching-account access | Live matching identity succeeds; wrong username/stable ID and missing consent are rejected by fixtures. |
| Public and anonymized authorized counts | Visibility-off live fixture returns 425 versus 818; authorized output projects only username, profile URL, date/count entries, availability, and fetch date. Zero and malformed responses are covered by fixtures. |
| Disconnect and external revoke | Real grant deletion returns 204 and old token returns 401; external revoke is detected on manual refresh and removes private data. Separate sign-in remains functional. |
| Failure and stale-job recovery | Fixture checks retain last good graph/date for transient failures and reject old grant generations in D1 after withdrawal. |
| Token handling and local runtime | Forty workerd/D1/Web Crypto checks pass, including AES-GCM binding and conditional persistence. |
| Remaining provider limitation | Production no-scope platform identity has not been exercised live. The public-only live fixture uses the owner's narrow sign-in token, not the future shared platform credential. |

## Remaining evidence

The local harness is available through `pnpm spike:github:live`. Its callback boundary has three automated tests for one-use state/S256 PKCE, owner/provider/session binding and expiry, and Origin/content-type/CSRF checks. An HTTP smoke check also verified headers, the real authorization URL's scope/callback/PKCE parameters, the sign-in prerequisite for activity, and the missing-session callback guard. These tests do not claim that GitHub has granted either application access. Live observations appear separately in `live-evidence.json` only after browser authorization and fetch actions.

A real Chromium form test reproduced an initial `Origin: null` failure caused by the harness's `no-referrer` response policy. The policy now uses `same-origin`, and `node scripts/github-live-browser.mjs` confirms that the browser sends the exact local Origin and reaches an intercepted GitHub authorization destination. GitHub is intercepted before any authorization request leaves this regression-test browser. The strict Origin and CSRF checks remain enabled. The expanded Vitest suite passes all 12 tests across 5 files.

After a subsequent server restart, activity reauthorization reported the combined `token_exchange_or_scope_failed` message. The harness now distinguishes allowlisted provider error codes, HTTP failures, missing tokens, and scope mismatches. A fourth callback test verifies that these diagnostics never echo raw provider payloads or token values. All four callback tests and the real Chromium form regression pass. Reauthorization succeeded on retry; the earlier generic message does not establish that transient failure's cause. Previously saved observations survive server restarts.

Matching-account `read:user` authorization, both private-profile visibility settings, GraphQL scope headers/calendar projection, provider grant deletion, old-token rejection, independent sign-in, and detection of externally revoked access on refresh now have live evidence. The separate no-scope platform identity remains unverified. The 425/818/393 comparison verifies consistent provider counts, not an independent repository-by-repository accounting of contribution history. The spike does not claim a complete product acceptance review. Public-only scope reduction is not an accepted MVP fallback.

Phases 40 through 42 and 47 still own the product graph, UI, persistence, refresh queues, cron, endpoint integration, and provider disconnect behavior. Phase 06 records tested candidate policies for those phases; it does not ship those features.
