# Phase 11C acceptance criteria

- The public-baseline adapter classifies every outcome exactly: fresh success with no restricted contributions is `available`; `restrictedContributionsCount > 0` is `unavailable`; HTTP 401, rate limits, server failures, network/timeout failures, and GraphQL partial errors are platform `retry`; non-empty or absent `X-OAuth-Scopes`, a viewer equal to the selected account, and malformed payloads are `invalid`. Unit tests cover each branch, and a platform credential failure never maps to an owner-facing reconnect.
- The existing S-6 fixture matrix and `specs/2026-10-15-github-permissions/evidence.json` remain reproducible and unchanged.
- A live fetch with a dedicated classic PAT (zero scopes, separate account, present-and-empty `X-OAuth-Scopes`) produces an accepted, sanitized observation that matches owner-known public contributions while the contribution account's private contributions are not displayed.
- The visibility-on case follows the documented rule with no private leak, or the run stops for an owner decision when live signals cannot establish safe separation. Either outcome is recorded with sanitized evidence.
- An invalid platform credential is live-classified as platform retry (no owner reconnect, no substitution with sign-in or activity tokens) and recorded.
- The failure/retry contract for dependent graph work is documented with evidence links, and the harness platform step works without any owner sign-in session.
- `pnpm check`, the default S-6 fixture run, and the Chromium harness regression pass. No secret, username, stable ID, or raw provider payload appears in any committed file or evidence artifact.
- Phase 06 historical files show no diff. The roadmap checkbox stays unchanged until the owner explicitly approves completion.
