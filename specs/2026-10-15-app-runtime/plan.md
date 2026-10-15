# Phase 03 plan

1. Inspect the merged Phase 02 base, provider access, architecture S-2, and current official documentation.
2. Add an isolated OpenNext spike route with real Better Auth, Drizzle/D1 sessions, cookie cache, deletion checks, and an owner-scoped synthetic D1 write. Do not add product sign-in or draft APIs.
3. Run local workerd first-request and warm workloads, including invalid/expired sessions, cross-origin mutations, large JSON, and another owner. Preserve raw elapsed samples and separate sampled CPU profiles.
4. Measure deployed startup_time_ms and per-request CPU when account resources and credentials are available. Decide runtime changes from evidence before dependent features.
5. Run correctness, lint, type, build and runtime checks. Record pending external checks honestly. Ask for approval before checking off Phase 03.
