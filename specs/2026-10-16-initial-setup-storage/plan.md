# Implementation plan

1. Extend draft and private progress contracts, version 1 migration and public-content projection. Verify compatibility and strict validation.
2. Add tracked progress/milestone/staging storage and owner-scoped revision operations using the bounded-save implementation. Preserve claimed-subdomain behavior and enforce permanent entry.
3. Exercise migrations, candidate collisions, repeated creation, content/progress races, cross-owner access, prepared-save races, session revocation and deletion in local workerd/D1.
4. Run repository checks and builds, record evidence and request approval before checking off Phase 11B.
