# Phase 11D acceptance criteria

- Tracked migrations apply to populated legacy fixtures and reapply cleanly. Unknown authorized caches are cleared and require a fresh complete calendar.
- Current successes/errors persist; stale successes, transient errors, and reconnect errors cannot overwrite or withdraw newer state after removal, selection, or reauthorization.
- Authorized totals are selected whole. A public-only publication, missing/mismatched publication, or withdrawn grant cannot expose draft/private counts. Output excludes credentials, provider errors and unexpected fields.
- Owner mutations recheck persisted sessions and deletion state, ignore injected portfolio IDs, and cannot change another owner's connection.
- Removal atomically clears active credentials and authorized output while preserving an independently safe public fallback. Sign-in links remain intact.
- Failed remote cleanup retains encrypted credentials and blocks same-app/account consent across owners. A delayed successful retry removes the cleanup credential, allows new consent, and cannot later revoke it through duplicate queue delivery.
- Concurrent cleanup attempts permit one provider call. In-flight or ambiguous deletion never unlocks consent by time expiry. Consent/removal races cannot strand an issued token or expose it publicly.
- Repository lint, typechecks, unit tests, build, persistence/access checks and applicable runtime checks pass. Record exact evidence and remaining later-phase integration work before asking for completion approval.
