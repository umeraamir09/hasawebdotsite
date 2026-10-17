# Phase 12 acceptance criteria

1. New GitHub and Google owners receive one private canonical draft with approved defaults, empty owner fields and Address progress. Neither provider profile nor avatar/email enters the draft.
2. Repeated/concurrent authenticated initialization and retry after an ignored successful response return the same portfolio ID. Another owner receives a different ID. No claims, public versions, assets or graph connections appear.
3. Reinitialization preserves edited drafts, appearance, revision, progress and permanent editor milestone, including published/claimed fixtures. Legacy content outside current destination limits stays unchanged and is not revalidated or silently reset.
4. Signed-out, expired, revoked, deleting and cross-origin requests fail without creating or modifying a portfolio. Session changes after repository construction still deny insertion and reads.
5. The endpoint accepts only an empty JSON object, with a bounded request body. Invalid JSON, unsupported methods, oversized bodies and identity/content/template/progress overrides fail. Responses are private/no-store, noindex and contain no provider credentials or draft content.
6. Account entry initializes before displaying success, handles lost/failed requests through the existing retry path, and sends expired sessions to sign-in. Read-only session checks do not initialize portfolios.
7. Relevant workerd/D1 integration, browser account-entry checks, unit tests, lint, typechecks, builds and runtime smoke checks pass. Evidence records fixture and deployment limits. The roadmap stays unchecked until the owner approves completion.
