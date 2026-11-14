# Sign-in and private account

Owners sign in with GitHub or Google, open one private portfolio in the account shell, and sign out. Failed or cancelled authentication offers retry.

## Sub-features

- `account-providers` covers both sign-up/sign-in providers and returning identities.
- `account-retry` covers cancellation, provider/network failure and retry.
- `account-provision` creates exactly one empty private portfolio and preserves it on repeated entry.
- `account-setup-entry` verifies the persisted setup/editor decision, fixed callbacks and direct-route guard.
- `account-signout` ends editing access and rejects revoked/expired sessions.

## How to get to it (user POV)

- Choose `Continue with GitHub` or `Continue with Google` on `/sign-in`.
- Return to `/sign-in` or open `/editor` with a valid account session.
- Choose `Retry` after account-opening failure or `Sign out` in the account header.

## Driving it with Chromium and the auth suite

Preconditions: built web/jobs Workers, Chrome available, no other suite using ports 8810–8812 or CDP ports 9245–9248. `pnpm verify --profile=auth` performs the builds/checks and drives `scripts/auth-integration.mjs --browser`, then draft/autosave/editor checks under the shared lock. Let the suite establish its own isolated database and provider boundary; ordinary seed users cannot log in.

- Provider entry uses actual buttons whose text is `Continue with GitHub` and `Continue with Google`. The existing CDP recipe in `scripts/auth-ui-browser.mjs` clicks them, routes fixture consent/HTTP, and observes the real callback/account UI.
- Observe a `Welcome, ...` heading and `Sign out` in `/auth/entry` for incomplete owners. Check the suite's D1 proof of one portfolio, approved empty defaults and no assets, publication or claim. Repeat entry/retry and require the same portfolio and unchanged draft.
- Exercise cancellation/failure, then choose the same provider again. Require a visible alert with `Sign-in didn't finish.` and a working retry rather than a stuck connecting button.
- Choose `Sign out`; require `/sign-in`, a rejected owner request and inability to reuse the revoked session. Read `uiEvidence` and `browserEvidence` in the auth suite's `evidence.json`, its named screenshots and command log under the printed verification output. Preserve both initiating actions and resulting state for any new journey added to the suite.

## Gotchas

- Provider HTTP/consent is replaced at the existing external boundary. This is not proof of real GitHub/Google configuration, production TLS/cookies or callback delivery. Do not send a live login request with dummy credentials.
- Direct `/editor` navigation sends incomplete owners to `/auth/entry`. Completed owners reach `/editor`, including after required content removal. With the committed (closed) Phase 42E gate both routes render account shells; the gated guide/editor journey is exercised by the editor harness groups "setup guide Review, ..." (`scripts/guide-review-browser.mjs`). New production accounts cannot prove the complete setup-to-editor journey until the gate opens.
- Account identity is not automatically public profile content. A signed-in welcome name is not proof that the portfolio profile was populated.
