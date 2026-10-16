# Acceptance criteria

- Git preserves the failed baseline, isolated optimization and final bounded implementation in focused Conventional Commits, with documented revert points.
- Existing schema acceptance remains equivalent for internal JavaScript inputs and network JSON. No duplicate nested scans are needed after a whole-tree JSON check. Prototype keys, invalid/deep/non-finite data and malformed UTF-8 fail; byte limits are measured correctly.
- A valid canonical draft of exactly 1 MiB can be saved atomically with separate progress. A large individual string and a dense structured draft remain supported without changing product limits.
- Each supported save operation performs bounded Worker work, checks real authenticated ownership/revocation/deletion, and preserves revision and milestone rules. No client-supplied validation result is trusted.
- Stale/parallel saves, interrupted attempts, duplicate/reordered/mutated pieces, invalid cross-document references, failed validation and revoked/deleting owners cannot mutate canonical content/progress or another owner's private records.
- Provider CPU p95 is strictly below 10 ms for every supported request class, including final commit and cleanup, with startup below 1,000 ms. Include failure counts, sample/telemetry limitations and first-request observations. Do not infer CPU from timers.
- Additional Worker/D1/storage quotas are quantified for the architecture's target scale; retries/cleanup are bounded and abandoned attempts expire.
- Relevant repository checks pass, experiment resources/secrets are removed, and Phase 11A remains unchecked until explicit owner approval after implementation.
