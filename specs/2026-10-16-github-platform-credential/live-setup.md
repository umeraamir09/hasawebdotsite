# Phase 11C live protocol: separate platform credential

This closes Phase 06's recorded outstanding check. The public baseline must come from a dedicated credential belonging to a **separate GitHub account**: a classic PAT with **no OAuth scopes**. Never substitute the repository CLI credential, an owner sign-in token, an activity token, the contribution account's own credential, or a broad `repo` token.

The platform step needs no owner sign-in session. The harness serves it even when the sign-in and activity flows are unused.

## Prepare the credential

1. Sign into a dedicated GitHub account. Do not use your personal account or the contribution account under observation.
2. Open [Developer settings](https://github.com/settings/developers) → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**. Do not tick any scope. The candidate policy expects the present-and-empty `X-OAuth-Scopes` header that a classic zero-scope token sends; fine-grained tokens are out of scope.
3. Copy the updated template at [../2026-10-15-github-permissions/.env.example](../2026-10-15-github-permissions/.env.example) to the repository root as `.env.github-spike.local` (git-ignored) and fill in the existing S-6 fields plus:
   - `GITHUB_TEST_USERNAME` — the contribution account under observation.
   - `GITHUB_PLATFORM_TOKEN` — the separate account's classic PAT.
4. Never paste the token into chat, a terminal command, or a committed file.
5. Record the contribution account's expected public contribution totals for the running 12-month window privately. A previous Phase 06 observation cannot be the expectation; check the live profile or your own notes.

## Run the protocol

Run `pnpm spike:github:live` and open `http://localhost:3000`. The platform section is visible without signing in.

1. **Public-only case.** Set the contribution account so private contributions are **hidden** (GitHub → profile → Contribution settings). In the harness choose **Private contributions hidden** and click **Fetch public baseline**. Expect classification `available` when the account's public activity is visible; compare the recorded total and day count with your known public totals. The Phase 06 sign-in observation (425 public in that window) is a diagnostic comparator only, never a fallback.
2. **Private-visible case.** Change the setting so private contributions are **shown** on the profile. Choose **Private contributions shown** and fetch again. Record whatever classification appears. If the reduced signals cannot distinguish a public-only calendar from an anonymized mixed one, stop and bring the observations to the owner decision instead of loosening or tightening the policy.
3. **Failure case.** Click **Test invalid platform credential handling**. A fixed fake credential is used; the real token is never sent by this probe. Expect classification `retry/credential` at HTTP 401 with no owner reconnect.
4. **Zero case (optional).** If a zero-activity account is available, point `GITHUB_TEST_USERNAME` at it and fetch. Expect `available` with zero counts. Record a limitation when no such account is available; the fixture matrix already covers zero handling.
5. Restore your preferred GitHub contribution visibility setting.

Sanitized events are written to [live-evidence.json](live-evidence.json). No usernames, stable IDs, tokens, or provider payloads are recorded. If a run needs isolation from the real evidence file, set `GITHUB_PLATFORM_EVIDENCE` to a scratch path.

## What the live evidence must establish

- The separate zero-scope credential returns a usable public baseline for the public-only visibility case, or a recorded unavailable/invalid outcome with no private leak.
- `X-OAuth-Scopes` is present and empty (`present-empty`), the viewer is a separate account, and no sign-in or activity token is used.
- The invalid-credential path classifies as platform retry, never an owner reconnect.

Stop the harness with `Ctrl+C`. Do not weaken any production cookie setting for this isolated HTTP harness, and do not modify Phase 06 historical evidence files.
