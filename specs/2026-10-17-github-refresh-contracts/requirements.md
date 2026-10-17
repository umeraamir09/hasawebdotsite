# Phase 11D requirements

Started October 17, 2026 on `feat/github-refresh-contracts`.

## Scope

- Advance connection generations on selection, grant activation, and withdrawal. Bind refresh successes and errors to the captured portfolio, generation, and stable account identity.
- Store a safe public calendar and a complete authorized calendar separately. Select one whole calendar, never sum or subtract counts. Treat unknown legacy `private_counts` as untrusted and refetch it.
- Require the active published version's account ID, username, and private choice before projecting authorized data. Draft-only consent cannot change a published public-only graph. The projection returns only username, profile URL, date/count, availability, and fetch date.
- Encrypt activity credentials with AES-GCM and an identity/purpose binding. Move withdrawn credentials into durable cleanup storage, inaccessible to refresh jobs, while immediately clearing active credentials and authorized data.
- Serialize consent and grant-wide deletion globally by activity app and stable GitHub account, including across owners. GitHub deletes all tokens for that pair. Cleanup jobs must acquire a unique persisted attempt before obtaining a credential or making a provider call. Old queue deliveries cannot reuse completed cleanup.
- Keep consent blocked while cleanup is pending, running, or uncertain. Never steal an expired deletion lock: a delayed provider call cannot honor a local fencing token. A confirmed failed HTTP response permits a later cleanup retry; an ambiguous network interruption retains the lock for reconciliation. A successful response releases it and removes the cleanup ciphertext.
- Keep sign-in accounts untouched. Public-only setup remains possible during cleanup. Production OAuth state/PKCE, public endpoints, cache purge wiring, queues and cron remain later phases.

## Provider reference

[GitHub's app authorization deletion contract](https://docs.github.com/en/rest/apps/oauth-applications?apiVersion=2026-03-10#delete-an-app-authorization), inspected October 17, 2026, says grant deletion removes every OAuth token for the app/user pair and requires the app's client ID/secret. Only confirmed deletion success releases the cleanup lock. Provider error bodies never enter persisted/public errors.

## Migration and rollout

Preserve old columns for schema compatibility while new code ignores unclassified calendars. Invalidate legacy authorized caches rather than labeling them complete. Legacy credentials without an activity-app binding must remain disabled and quarantined for explicit migration/cleanup, never reused by refresh. New lifecycle adapters must use these transitions; old unguarded repository upserts are removed. Deployment order and legacy credential reconciliation must be handled before enabling graph routes.
