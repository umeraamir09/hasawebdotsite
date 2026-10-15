# Phase 10 requirements

Sources: roadmap Phase 10; architecture sections 5.2, 7, 8.7, 10, 12, and 13; acceptance criteria 2.3, 13.7, 16.5, 17.4, and 18.6.

Persist Better Auth users, sessions, accounts, and verification records; one portfolio per user; private assets; publication metadata; reserved names and permanent claims; GitHub connection and activity records; contact recipients and outbox; counters; and operator email audits. Keep snapshot bodies in R2 and draft alt text in the draft document.

Repositories derive ownership from a resolved session, verify that session against D1, and scope each operation to the same active account and unexpired session. A cached authentication response cannot bypass session revocation or account deletion. Cross-owner record IDs must not disclose or mutate private data. Inserts and updates cannot take an alternate owner or portfolio from their payloads.

Request guards require the configured application origin and session. Mutations also require an exact Origin header and application/json. These helpers are ready for subsequent owner endpoints; authentication routes and the hot API entrypoint remain in their scheduled phases.

Use Drizzle-generated additive SQL migrations, applied by Wrangler locally. Seed only development identities and private drafts with no usable sign-in sessions. Preserve runtime probes and existing spike tables. No UI or Figma changes are required.

Publication pointer switching and atomic first claims belong to Phase 25. This phase stores versions and reads existing owner claims without exposing an independent claim-creation API. Contact acceptance budgets and delivery scheduling belong to Phases 43–45; the persistence methods do not imply that a message has passed those checks. Global counters and operator audit writes are trusted service operations, not owner APIs.
