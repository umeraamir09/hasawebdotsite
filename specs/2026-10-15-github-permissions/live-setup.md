# GitHub setup and live verification

## Register the apps

The isolated local harness now serves the callbacks below. The fixture runner does not use real credentials. Product OAuth routes remain outside this spike.

1. Sign into GitHub and open [Developer settings](https://github.com/settings/developers).
2. Select **OAuth Apps**, then **New OAuth App**. Choose an OAuth App, not a GitHub App.
3. Create `hasaweb local sign-in` with homepage `http://localhost:3000` and authorization callback `http://localhost:3000/api/auth/callback/github`.
4. Copy the Client ID and generate a Client Secret. Store them in a password manager or an ignored local configuration file. Do not paste the secret into chat, a terminal command, or a committed file.
5. Create `hasaweb local activity` with homepage `http://localhost:3000` and callback `http://localhost:3000/api/github/callback`. Save its separate credentials.

GitHub requests scopes when the application starts authorization. There is no scope selector in app registration. Sign-in must explicitly request only `user:email`; activity must request only `read:user` after a signed-in owner consents. A separate application prevents activity grant deletion from deleting sign-in tokens for the same application. Use separate production apps with HTTPS callbacks later. Do not change the local apps to production URLs.

Store the credentials in `.env.github-spike.local` at the repository root. A labeled [.env.example](.env.example) lists the five fields. `GITHUB_SIGN_IN_*` belongs to the sign-in app, `GITHUB_ACTIVITY_*` belongs to the activity app, and `GITHUB_TEST_USERNAME` is the contribution account's username. Git ignores the local file. Only the live harness loads it; the fixture runner does not. Never place these secrets in `NEXT_PUBLIC_*` variables.

The phase 05 auth configuration uses Secure cookies, so the final browser flow will need local HTTPS or a deliberately isolated local harness. Registering the HTTP development callbacks above does not prove that configuration works in a browser. Never weaken the production cookie settings to make a local test pass.

## Run the local harness

Run `pnpm spike:github:live`, or `node scripts/github-live-oauth.mjs`, from the repository root. Port 3000 must be free. Open `http://localhost:3000` in one browser. The server binds to loopback and accepts only that exact Host and Origin.

1. Click **Authorize sign-in** and complete GitHub authorization for the configured username.
2. Tick the explicit private-count consent checkbox, click **Authorize private activity**, and complete authorization for the same account.
3. Click **Fetch and compare contribution calendars**. The page shows aggregate observations and an expandable anonymized authorized calendar. Compare it with known contribution dates and counts.
4. After inspecting the first results, use **Disconnect activity and revoke the activity test app grant** to test provider deletion and sign-in independence. Reauthorize activity to test external revocation separately.

Tokens are encrypted with an ephemeral AES-GCM key in server memory. Restarting the process requires authorization again. OAuth state is one-use, expires after ten minutes, uses S256 PKCE, and is bound to the browser session and current local owner identity. Mutations require the exact Origin, form content type, and a CSRF token. This deliberately isolated HTTP test session does not use or change Better Auth's production cookie configuration.

Sanitized provider observations are saved to `live-evidence.json`. No OAuth codes, state, tokens, secrets, usernames, stable IDs, repository details, or daily private counts are written there. The local page can display the authorized anonymized calendar only in its browser session. The first comparison uses the owner's narrow sign-in token as an observational public-access fixture; it is not the separate production platform credential and does not pass that part of the protocol.

On local disconnect the harness removes private access before requesting provider grant deletion, then checks the old activity token and the separate sign-in token. If remote deletion fails, remove the activity app manually in GitHub settings. This short-lived spike does not implement the product's durable retry task.

## Prepare contribution accounts

- Public-only fixture account: use an account with known public contributions within the test window and no private activity in that window. Record the expected UTC dates and counts privately. A zero-contribution account can verify zero handling but cannot prove nonzero graph accuracy.
- Private-activity fixture account: use an account you control with known private contributions in the same window. An existing account works. The owner of that account must complete the separate activity authorization.
- One account with both public and private activity can cover both cases by testing public-only access and matching authorized access separately, with the profile visibility setting on and off. Two contribution accounts are convenient, not required. A separate platform identity is still required by the candidate baseline policy below.
- If creating a private fixture, create a private repository, commit to its default branch using an email linked to the account, and wait for GitHub's graph to update. Check the [contribution rules](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference). A pushed commit is not automatically proof that a contribution should already appear.
- Test the private account's **Contribution settings → Private contributions** setting both on and off. Record whether each setting affects the platform and authorized responses. Do not assume that an authorized calendar minus a platform calendar equals private contributions.
- Public GraphQL access also needs a dedicated platform credential with no OAuth scopes, belonging to a separate account. Do not substitute the repository CLI credential, an owner's sign-in token, or a broad `repo` token. The candidate adapter rejects broad or unknown scope headers and the target account's own platform credential.

## Live protocol

1. Capture the authorization URLs without their random state values. Confirm separate client IDs, exact callback URLs, and the requested narrow scopes. Complete sign-in, then deliberately cancel activity consent once. Cancellation must leave private activity disabled.
2. The activity callback must bind one-use state and PKCE to the authenticated owner and selected graph account. Query the provider identity from the new token. Never trust a callback username supplied by the browser. Test wrong state, replay, another owner, and a different GitHub account.
3. Fetch the public fixture calendar using the platform token. Record sanitized day/count output, the granted scope header, and fetch time. Confirm known public contributions and a successful zero response where applicable.
4. Repeat with the private fixture using platform access, then the matching `read:user` token. Repeat with private profile visibility enabled and disabled. Verify expected daily counts against known activity. The adapter must reject unsupported scope/visibility behavior rather than silently changing permissions or counting twice.
5. Inspect public JSON and rendered output. They may contain only selected username, profile link, dates, counts, availability, and fetch date. Check for private repository names, contribution details, code, tokens, and raw errors. The S-6 query requests no repository objects.
6. Try a different account and a reused username with a different stable ID. Both must fail matching. Google sign-in owners must be able to authorize the selected GitHub account independently.
7. Revoke the activity app in [Authorized OAuth Apps](https://github.com/settings/applications). Confirm that the next visit refresh after the six-hour TTL, or daily private sweep, detects invalid authorization, deletes token/private data, and reports Reconnect without Publish. Record actual times. Local interval fixtures do not prove deployed scheduling.
8. Reauthorize and test local disconnect. Deny local private reads first, advance the grant generation, delete the encrypted token and private calendar, and revoke the activity grant using `DELETE /applications/{client_id}/grant` with that app's client credentials. Keep a durable encrypted revocation task if provider deletion fails. Never keep a disconnected grant available to refresh jobs. This product cleanup/retry path remains to implement.
9. Start a refresh, then disconnect or change usernames before it completes. The conditional persistence write must reject its old generation. Attempt reconnect while the old request is still running.
10. Verify the sign-in application still signs into the same account after activity grant deletion. Verify a transient provider failure preserves the last successful graph and timestamp. If CDN caching is added later, repeat revocation against a populated cache and confirm purge completion. The spike response uses `no-store`.

Commit sanitized observations and pass/fail outcomes only. Do not commit raw provider responses, OAuth codes, state, access tokens, client secrets, or private repository identifiers. Phase 06 remains pending until the live provider assumptions have evidence and the owner approves completion.

## Provider references

Reviewed October 15, 2026:

- [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- [OAuth authorization, identity revalidation, state, and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [ContributionsCollection and calendar fields](https://docs.github.com/en/graphql/reference/users#contributionscollection)
- [Profile contribution visibility](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile)
- [Token validation and grant deletion](https://docs.github.com/en/rest/apps/oauth-applications)
