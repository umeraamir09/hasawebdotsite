# Phase 11C plan

1. Record requirements, acceptance criteria, and this plan before implementation. Establish the branch `feat/github-platform-credential` and the `specs/2026-10-16-github-platform-credential/` directory.
2. Add an explicit public-baseline entry point with a classified outcome (`available` / `unavailable` / `retry` / `invalid`) to the S-6 spike adapter, reusing the existing public-mode fetch. Cover every branch with unit tests and keep the existing fixture matrix and its evidence unchanged.
3. Extend the isolated live harness with the platform credential: load `GITHUB_PLATFORM_TOKEN`, verify a separate zero-scope identity, fetch the public baseline for the contribution account, probe the invalid-credential failure path, and write sanitized events to this spec's `live-evidence.json`. Update the shared `.env.example` template.
4. Run repository checks and the default S-6 fixture command (verify the Phase 06 `evidence.json` remains byte-identical). Record the automated evidence.
5. Run the owner live protocol: visibility-off baseline, visibility-on baseline, optional zero case, and the invalid-credential probe. Record sanitized observations in `results.md` and `live-evidence.json`.
6. Document the failure/retry contract for dependent graph work and request owner approval before checking off Phase 11C.
