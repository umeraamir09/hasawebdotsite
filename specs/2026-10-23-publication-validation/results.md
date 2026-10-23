# Phase 23. Publication validation and checklist

## Scope and acceptance
Implements [Phase 23](../../docs/roadmap.md#phase-23-build-publication-validation-and-checklist) and [publication criteria 15.4–6](../../docs/acceptance-criteria.md#15-subdomain-selection-and-publication), using the current component registry and approved catalog.
Prerequisites 11E, 13, 17–18 and 20–22A are owner-approved and integrated in main at 14af1a6. Phase 20's separate provider review remains outstanding and does not change its recorded owner approval.
Branch: feat/23-publication-validation. Worktree: /home/umer/.codex/worktrees/phase23-publication-validation/hasawebdotsite.
Write boundaries: shared publication messages/projection, database readiness queries, private check adapter, reusable editor checklist/correction controls, focused verification and affected guidance. No schema migration, publication commit, setup activation or roadmap checkoff.

## Decisions
Readiness checks use the saved revision and current owner authorization. Republish checks follow architecture 8.3: the owned permanent claim must match the fixed published address. A missing historical requested-address mirror cannot force a published owner back through Address selection. They never use the editor-entry milestone as readiness.
The service pages private object checks and caps reported issues. Local D1 rejected the initial 30-term compound query even though native SQLite accepted it. Rules now run in groups of four, retaining a global 50-issue cap and explicit truncation. The [selected failure evidence](evidence/d1-compound-query.json) preserves that runtime constraint. Page results are evidence about one revision, not a publication authorization. Phase 24 must revalidate facts while preparing its immutable candidate; Phase 25 must guard the address in its pointer transaction.

## Results
Implemented shared check messages and offline sample/disabled-photo omission, bounded database checks, the private web adapter, and the reusable checklist with field navigation and catalog/optional-section corrections. GitHub uses the existing consent/generation resolver and contact uses private verified recipient state.

Targeted unit checks pass for projection and client quiescing, local input retention, revision/owner changes and object pagination. All 439 unit tests, typechecking and application builds passed during development. The first runtime run was interrupted by the terminal lifetime; its verified orphaned processes were stopped before restarting the locked runner. Final targeted and full verification are in progress. Owner completion approval and the separate publication-boundary review are pending. The separate review should inspect authorization/revision changes during object reads, sample omission and private service references, provider generation/consent, and held versus claimed address checks. No deployment or production CPU/capacity claim is made.

## Documentation impact
Publication readiness was previously deferred. Update schema/database/client guidance and the implementation baseline to describe the new reusable check service and remaining activation/publication gates.
