# Phase 10 acceptance criteria

1. Generated migrations apply to a fresh local D1 database and are safe to rerun through Wrangler migration tracking. Existing runtime fixtures continue working. Repeatable local seeds create accounts and valid private drafts without sign-in credentials.
2. Drizzle and SQLite enforce one portfolio per account, unique publication numbers per portfolio, valid foreign keys, draft JSON/size constraints, and permanent subdomain reservations after owner deletion.
3. Each private repository can round-trip its records. Another owner cannot read, update, delete, or overwrite them by supplying known IDs, keys, or payload fields. Shared email budgets are inaccessible through owner counters.
4. Request guards reject missing/expired/revoked sessions, session/user mismatches, deleting accounts, wrong application hosts, missing/cross-site/null Origin, and non-JSON mutations. Dependencies fail closed. Success responses are private and not cached.
5. Every repository operation continues to enforce session and deletion state, including repositories created before revocation/deletion. Draft changes do not alter publication metadata or live pointers. Outbox finalization removes visitor payloads.
6. Integration checks use actual workerd/D1 and the checked-in migration files, verify restart persistence, and run in CI. Lint, strict TypeScript, unit tests, builds, and the existing local runtime smoke test pass.
7. Record evidence and limitations. Ask the owner before changing the roadmap completion checkbox.
