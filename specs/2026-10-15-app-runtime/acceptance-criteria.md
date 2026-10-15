# Acceptance criteria

- Real Better Auth getSession validates seeded D1 sessions through Drizzle. Include cache miss and cache hit, absent/tampered/expired sessions and a deleting user. No mocked lookup.
- An authenticated mutation writes only the current synthetic owner's row. Signed-out, cross-origin and invalid content-type requests cannot write. Bound payloads at the architecture's 1 MiB ceiling.
- Record versions, fixture sizes, cold/warm definition, sample counts, distributions, reproducible commands and raw evidence. Sampled CPU estimates remain separate from local elapsed timing.
- Deployed startup_time_ms is below 1,000 ms and measured auth/API CPU p95 is below 10 ms, or record necessary runtime/endpoint changes before dependent features. Missing deployed data is pending, not a pass.
- Relevant lint, strict types, unit/integration and build checks pass. Do not change a roadmap checkbox without owner approval.

## Recorded outcome

The real Better Auth/D1 path, local correctness checks, local profiles and deployed startup measurement pass their execution checks. The original deployed request CPU target fails. The required hot-API runtime revision is decided in results.md, with replacement measurements required before dependent features. Sampled tail and adaptive/window analytics limitations are retained. The initial large-write and first-check availability failures remain in raw evidence; the separate production failure/ownership checks subsequently pass. No roadmap completion approval has been received.
