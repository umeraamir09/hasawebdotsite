# GitHub storage contracts

Phase 11D provides calendar projection and credential handling in `src/`. Provider experiments in `spike/` retain their historical evidence. Product fetching, OAuth routes, graph UI, public endpoint, cache purge, queues and cron remain Phases 40–42.

`RefreshResult` distinguishes an independently safe public baseline from a complete authorized calendar. The latter includes public and private contributions. Never add calendars or subtract independently fetched counts. The Phase 11C public-baseline classifier remains the required provider policy. Platform failures must not become owner reconnect errors. Public identity/scope/payload failures discard the baseline; transient errors retain the last successful calendar and its fetch date.

`projectPublishedActivity(published, state)` accepts the immutable graph configuration from the active publication, including stable account ID, username, and `includePrivate`. A missing publication returns no graph. Mismatched identity/generation returns unavailable. Authorized output requires both the publication's private choice and currently valid authorization. Returned fields are allowlisted. Owner previews need a separate authenticated adapter. Never pass draft choices into the public endpoint.

`encryptActivityToken` uses AES-GCM with a random IV and a portfolio/app/account/consent-operation binding. Only internal jobs may decrypt active credentials. Cleanup credentials live in separate storage and are unavailable to refresh acquisition. Keys and app secrets come from server configuration. Key provisioning/rotation remains later integration work.

Grant deletion uses [GitHub's grant-wide endpoint](https://docs.github.com/en/rest/apps/oauth-applications?apiVersion=2026-03-10#delete-an-app-authorization), which removes all OAuth tokens for the app/user pair. Only HTTP 204 confirms deletion. Other completed HTTP responses retain encrypted credentials for retry after one minute. An interrupted request is uncertain and keeps consent blocked. A clock-based lock expiry cannot stop a provider request that is already running.
