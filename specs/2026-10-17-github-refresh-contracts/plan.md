# Phase 11D plan

1. Read the existing schema, S-6 and 11C evidence, and GitHub requirements. Define generation, calendar, publication, and grant cleanup contracts.
2. Add backward-compatible migrations and replace unconditional GitHub repository writes with owner-scoped transitions and conditional job writes.
3. Add allowlisted calendar selection, authenticated encryption, and serialized retryable remote grant cleanup. Keep production routes, queues, scheduling, and UI in Phases 40–42.
4. Exercise migration fixtures, owner/session boundaries, stale successes/errors, publication gates, concurrent consent/cleanup, failed removal, and delayed retries in workerd/D1. Run repository checks and record evidence.
5. Ask the owner whether to mark Phase 11D complete after implementation review.

Task groups 1–5 are complete. Validation and the remaining integration boundaries are recorded in [results.md](results.md). The owner approved completion on October 17, 2026, and Phase 11D is checked in the roadmap.
