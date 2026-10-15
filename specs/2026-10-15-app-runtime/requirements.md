# Requirements and context

S-2 requires a deployed OpenNext skeleton with a real Better Auth session check and a D1 write. Startup must be below 1,000 ms and auth/API request CPU p95 below 10 ms. Local elapsed time and sampled V8 CPU estimates cannot establish deployed CPU or startup limits. Retain the Phase 02 rejection of whole-page rendering and its unproven bounded-pipeline/free-tier qualifications.

Use pinned dependencies, per-request Better Auth initialization, Drizzle on D1, cookie caching, and a separate deletion-state lookup. Synthetic records are spike-only, not the Phase 10 schema. Measure small and near-1 MiB JSON writes to expose the architecture's payload risk. Require exact origin, JSON content type, a valid session and owner-scoped writes. No OAuth, product editor, publication or later phases.

PR #2 merged October 15, 2026 as 89dd399. Start from origin/main at that merge on perf/app-runtime-routing. The checkout was clean. Wrangler whoami reported unauthenticated; no Cloudflare credential environment variables were found. Ask the owner to configure access outside chat. Never print credentials, cookies, session tokens or raw request headers in evidence.

AGENTS.md branch naming overrides the older roadmap example. Phase 03 remains unchecked until required evidence exists and the owner approves.

The owner subsequently authenticated Wrangler and confirmed D1/R2 availability and the Free-tier budget. An isolated hasaweb-s2-spike D1 database and workers.dev Worker were provisioned for S-2 without changing domain routes. The OAuth token cannot read subscriptions or the Workers telemetry-query API. Real-time tail supplies provider CPU instead. Keep all unrelated existing resources untouched.
