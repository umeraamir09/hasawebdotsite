# Phase 11 requirements

Implement GitHub and Google sign-up/sign-in with the Phase 05 configuration over Phase 10's product D1 tables. Verified matching emails must resolve to the same owner; missing/unverified emails cannot merge accounts. Request GitHub identity/email permissions only. Password and email-only login remain disabled.

Provide responsive sign-in, pending, cancellation, failure, retry, and sign-out states using the read-only Figma direction. Successful authentication opens `/editor`. Protect editor data with current persisted sessions and deletion checks, including copied cache cookies after sign-out. Preserve existing account and portfolio identity through retry and reauthentication.

Phase 12 owns sample portfolio provisioning; Phase 17 owns the complete editor. This phase supplies an authenticated editor entry without creating placeholder drafts. Phase 15 owns unsaved-edit recovery.

Configure an exact app origin and provider secrets through Worker bindings, with no production fallback secrets. Only local loopback HTTP may use development cookie names. Production requires the HTTPS apex and `__Host-` cookies. No deployments or provider app changes are required for this local implementation. Record live-provider verification limits.

Repository AGENTS.md branch conventions override the older roadmap branch example. Leave the phase checkbox pending until the owner approves it after implementation.
