# Phase 06 requirements

Started October 15, 2026 on `feat/github-permissions`. The repository branch convention takes precedence over the older example in the roadmap.

This is architecture spike S-6, not the product graph or editor implementation. Figma inspection is unnecessary because this phase changes no UI. Product section 9, acceptance criteria 9.5 through 9.10, and architecture sections 8.5 and 13 control the scope.

- Sign-in requests `user:email` only. Explicit private-activity consent uses a separate OAuth application requesting `read:user`, with a separate stored grant. Never request repository scopes.
- Resolve the authenticated GitHub identity from the provider. Match both stable ID and case-insensitive login to the selected account. An owner may sign in with Google and separately authorize GitHub.
- Public responses allow only dates, counts, selected username, profile URL, and fetch date. Never forward provider responses or error messages.
- Preserve a separate public baseline and authorized calendar. Do not assume the calendar obtained with a platform token excludes anonymized private contributions. When restricted contributions are present, use an unavailable baseline until safe separation is proven.
- Delete private data and tokens on local disconnect or detected authorization loss. A refresh completing after disconnect or a username change must not restore data.
- Transient network/rate/server failures retain the last successful graph and timestamp. Scope loss and invalid tokens require reconnect. Detect external revocation on the next six-hour visit refresh or daily private sweep.
- Exercise AES-GCM token encryption and D1 conditional writes in local workerd. Production migrations, OAuth routes, scheduling, cache purge integration, and UI belong to later phases.
- Fixtures prove application behavior, not GitHub's live visibility semantics. Live public/private accounts and real grant revocation remain required for full S-6 proof.
