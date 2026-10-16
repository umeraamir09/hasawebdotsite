# Phase 11C implementation and verification evidence

October 16, 2026, on `feat/github-platform-credential`. This is the S-6 follow-up that verifies the separate public GitHub credential. Phase 06's historical completion and its original limitations are preserved unchanged; this directory contains the separate follow-up evidence.

Status: implementation and automated verification complete. The owner live protocol in [live-setup.md](live-setup.md) has not run yet; [live-evidence.json](live-evidence.json) will be produced by that run. The roadmap checkbox stays unchanged until the owner approves completion with live evidence.

## Delivered behavior

- `packages/github/spike/permissions.ts` adds `fetchPublicBaseline()`, an explicit classified public baseline for the platform credential. Every failure reason is distinct from an owner token failure, and a platform failure never maps to an owner reconnect:
  - `available` — serve the public baseline and its fetch date.
  - `unavailable` / `restricted` — the baseline contains restricted contributions; serve a clear unavailable state, never a sum or subtraction.
  - `retry` / `credential` — invalid, expired, or revoked platform token; rotate and retry at the platform level, retain the last good baseline or unavailable.
  - `retry` / `rate`, `server`, `network` — bounded retry with backoff; retain the last good graph and date.
  - `invalid` / `scope`, `identity`, `payload` — misconfigured or unsupported provider behavior; fail closed, serve no baseline from this credential, alert the operator.
- Existing `fetchCalendar()` behavior and the 40-check fixture matrix are unchanged, so `specs/2026-10-15-github-permissions/evidence.json` still reproduces byte-for-byte.
- `scripts/github-live-oauth.mjs` adds a platform step that needs no owner sign-in: it fetches the public baseline for `GITHUB_TEST_USERNAME` with the separate credential, records the scope-header state, viewer separation, restricted count, and classification, and offers an owner-attested visibility selector (`on` / `off`). A separate probe classifies an invalid credential using a fixed fake token; the real token is never sent. The harness also starts in platform-only mode when only `GITHUB_TEST_USERNAME` and `GITHUB_PLATFORM_TOKEN` are configured; the sign-in/activity flows render a disabled notice and their actions are rejected.
- Platform events are written to this directory's `live-evidence.json` (override with `GITHUB_PLATFORM_EVIDENCE`), leaving the Phase 06 evidence files untouched.
- The shared template `specs/2026-10-15-github-permissions/.env.example` gains `GITHUB_PLATFORM_TOKEN` with the separate-account, no-scope requirement noted.

## Automated verification

| Check | Result |
| --- | --- |
| `pnpm check` | Pass: Biome, all 12 package typechecks, 173 unit tests across 17 files (6 new tests) |
| `pnpm spike:github` | Pass: 40 workerd/D1/Web Crypto checks; `specs/2026-10-15-github-permissions/evidence.json` unchanged |
| Chromium harness regression | Pass: exact `http://localhost:3000` Origin and intercepted GitHub authorization destination with the platform section present |
| Local smoke run | Pass: platform section and both platform actions worked without any sign-in session; platform-only startup, the sign-in-disabled notice, and the `signin_not_configured` rejection also pass; HTTP 401 from the fake credential classified `retry/credential`; no secret in evidence. See [automated-smoke-evidence.json](automated-smoke-evidence.json). |

The new unit coverage includes: accepted separate zero-scope baseline, restricted baseline unavailable, credential/rate/server/network retries, scope/identity/payload fail-closed cases, present-but-empty vs absent scope header, and the explicit assertion that no platform failure produces an owner reconnect. The harness test adds the scope-header state helper.

## Failure/retry contract for dependent graph work

Phases 11D and 40 through 42 must implement this mapping; they must not reinterpret a platform failure as owner reconnect or serve a restricted baseline.

| Platform fetch outcome | Classification | Dependent behavior |
| --- | --- | --- |
| Success, `restrictedContributionsCount == 0` | `available` | Serve the public baseline and update the fetch date |
| `restrictedContributionsCount > 0` | `unavailable` / `restricted` | Serve a clear unavailable state; never add or subtract calendars |
| HTTP 401 | `retry` / `credential` | Platform-level rotation and retry; retain the last good baseline or unavailable; no owner action |
| 403 / 429 | `retry` / `rate` | Bounded backoff; retain the last good graph and date |
| 5xx, timeout, network, GraphQL partial errors | `retry` / `server` or `network` | Bounded backoff; retain the last good graph and date |
| Non-empty or absent `X-OAuth-Scopes` | `invalid` / `scope` | Fail closed; serve no baseline from this credential; operator alert |
| Viewer identity equals the selected account | `invalid` / `identity` | Fail closed; use a separate account |
| Malformed or unsupported payload | `invalid` / `payload` | Fail closed; retain the last good baseline |

The platform fetch is independent of owner OAuth. A platform failure never changes private grant state, and vice versa. Scheduling and cache behavior remain the confirmed six-hour visit TTL and daily private sweep from architecture section 13; they are implemented in later phases.

## Live protocol status

Pending the owner run. The expected outcomes, credential preparation, and stopping conditions are in [live-setup.md](live-setup.md). Automated evidence cannot establish the live provider baseline; only the owner session can.

## Limits

- This increment is verification infrastructure, not product graph work. `packages/github/src/index.ts` remains empty; production token storage/rotation, refresh queues, serving, and cache purge belong to Phases 11D and 40 through 42.
- The local harness is an isolated HTTP process; it does not exercise production Better Auth cookies, callbacks, or scheduling.
- The candidate policy expects a classic no-scope PAT (present-and-empty `X-OAuth-Scopes`). If the live credential behaves differently, the policy, fixtures, and this document are revised as a recorded finding.
- Figma was not modified; this phase changes no UI.
