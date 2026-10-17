# Phase 11C requirements

Started October 16, 2026 on `feat/github-platform-credential`. This is the S-6 follow-up that closes the recorded outstanding platform-credential check. It is a verification increment, not product graph work.

Phase 06 proved the permission model with fixtures and live OAuth but recorded one untested item: the separate no-scope platform credential (`AC 9.10`). The public-only live observation used the owner's narrow sign-in token, which returned restricted counts (392/393) and must not become the public fallback. Phase 11C exercises the real platform credential against controlled accounts and both contribution visibility settings.

## Scope

- Run the live public baseline with a dedicated credential: a classic PAT with **no OAuth scopes** belonging to a separate GitHub account, never the contribution account, the owner's personal account, the repository CLI credential, an owner sign-in/activity token, or any broad `repo` token.
- Confirm the candidate policy in `packages/github/spike/permissions.ts` against live provider behavior: an empty `X-OAuth-Scopes` header, a viewer identity different from the selected account, and `restrictedContributionsCount > 0` making the baseline unavailable.
- Cover controlled public/private visibility cases by toggling the contribution account's "Include private contributions on my profile" setting, as Phase 06 did.
- Produce a classified, testable failure/retry contract for dependent graph work (Phases 11D and 40 through 42): platform credential failures are platform-level retry/rotation, never an owner-facing reconnect; restricted baselines are unavailable; misconfigured credentials fail closed.
- Record sanitized evidence only. No tokens, client secrets, usernames, stable IDs, repository details, or raw provider payloads enter evidence files or commits.

## Explicit non-goals

- Production token storage/rotation, connection generations, refresh scheduling, serving endpoints, cache purge, and OAuth UI remain Phases 11D, 40 through 42, and 47. `packages/github/src/index.ts` stays empty.
- Do not modify Phase 06 historical artifacts: `specs/2026-10-15-github-permissions/{results.md,live-evidence.json,evidence.json,requirements.md,acceptance-criteria.md,live-setup.md}` stay unchanged. The single exception is the shared `.env.example` template, which gains the new platform field because the harness consumes it.
- Do not claim that Phase 06's historical completion or its original limitations changed. Phase 11C adds separate evidence.
- Do not weaken or hide the sign-in token observations by presenting them as a public fallback. The sign-in token can expose authorized activity and is not substituted anywhere.

## Context and decisions

- Architecture section 8.5 and the S-6 results require a separate public baseline and authorized calendar, selected whole, never summed or subtracted. Restricted counts make a baseline unavailable until safe separation is demonstrated.
- Architecture section 13 confirms the six-hour visit TTL and daily private sweep. Those govern later refresh work; this phase only documents how platform-credential failures feed into them.
- The platform fetch needs no owner OAuth session. The harness exposes it without sign-in, which demonstrates independence from sign-in/activity grants.
- If the live signals cannot distinguish a mixed calendar from a public-only one, stop and bring the recorded observations to the owner for a serving decision rather than silently loosening or tightening the policy.
- The credential expected by the candidate policy is a classic PAT: GitHub sends a present, empty `X-OAuth-Scopes` header for it. If the live run shows a different header shape, the policy, fixtures, and documentation are revisited as a recorded finding.
