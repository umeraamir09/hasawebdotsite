# Deployment budget and development gates

## Owner decision, October 27, 2026

The owner explicitly chose Cloudflare Workers Paid, currently a $5 USD/month minimum, for launch. Upgrade only during launch preparation, before public activation. Keep the subscription unchanged throughout local implementation. This supersedes architecture D-1's Free-at-launch decision and the Free-only CPU, daily Queue/D1 and included-storage fit requirements used to block local development.

The owner authorized removing those budget blockers so implementation can continue. Reuse the tested inactive `s8-v3` publication scaffold from runtime revision `5b796accfac88bf40b2875e606b79c52192a3e16`, with evidence/tooling through `acc77f2`, as the named **S-8 local development milestone**. Integrate that milestone and this decision into the shared base and run applicable integration checks before dependent code starts. This is authorization for local reuse and implementation, not S-8 Free-plan acceptance, completed Phase 24 approval, or production readiness.

The product remains free to portfolio owners. This is operator infrastructure spending; it adds no checkout, subscriptions or paid product restrictions. Keep the existing 100-portfolio, 30-editing-session, 30-publications/day planning workload and content allowance. The earlier discussion of 25 portfolios was hypothetical, not a selected launch cap. Resend, privacy, authentication, withdrawal and provider-consent contracts remain unchanged.

## Current planning basis

Prices and limits were checked against official documentation on October 27, 2026. Recheck them at launch. The $5 minimum is not an all-services bill ceiling.

| Resource | Paid launch planning basis | Required handling |
| --- | --- | --- |
| Workers | $5/month minimum; 10 million requests and 30 million CPU milliseconds/month included; usage above those allowances is metered | The old <10-ms Free p95 gate is no longer a local start prerequisite. Measure complete native calls, cold behavior and average aggregate CPU at launch; p95 is not an average CPU billing estimate. Configure finite execution limits and preserve bounded work. |
| Queues | 1 million operations/month included, then $0.40/million | Budget all publication, retries, cleanup, contact and GitHub work monthly. The measured dense forecast is 313,290 operations per 30-day month. Paid launch behavior remains to verify. |
| D1 | 25 billion reads and 50 million writes/month included; 5 GB included storage; maximum 10 GB per database on Paid | Keep migrations, indexes, admission and cleanup bounded. Chargeable storage and operation overages remain possible. |
| R2 Standard | 10 GB-month, 1 million Class A and 10 million Class B operations/month included; storage overage $0.015/GB-month, with published billing rounding | Storage above 10 GB is a metered cost, not a requirement to shrink supported owner content. Forecast retained versions, private/public copies, temporary peaks and orphans. Implement cleanup and assess actual cost before release. |
| Other providers | Existing Resend/domain/OAuth contracts | Workers Paid does not automatically replace the email provider or remove its separate budgets. |

The [S-8 counters and Free comparison](../specs/2026-10-24-s8-dispatch-feasibility/costs.md) remain evidence. Free CPU failures, extra invocations, incomplete observation windows and storage counterexamples must not be relabeled as paid-provider passes. The paid projection is planning arithmetic from those counters, not a deployment test.

## Development start and release gates

| Gate | Required now for local implementation | Required before public launch |
| --- | --- | --- |
| Infrastructure plan | Target Paid; no subscription or remote resource change now | Upgrade to Workers Paid during launch preparation and confirm actual account settings before activation |
| S-8 reuse | Integrate the owner-authorized local milestone; retain passing local correctness/recovery evidence and run affected integration checks | Native paid-plan verification of the final renderer, source transfer, publication start, Queue and scheduled cleanup; investigate non-success outcomes |
| Phase dependencies | Existing code/API/schema dependencies, owner approval and integration rules still apply; Free-only fit cannot block otherwise ready work | Final phase acceptance and owner completion approvals still apply |
| Publication and privacy | Develop revision-safe candidates, manifests, retries, deletion and retained assets locally; no production activation | Verify complete publication and rollback against real bindings and intended paid limits |
| S-9 withdrawal | Implement/test the browser, query-key and edge policy in the dependent local phases | Observed withdrawal of cached assets, not merely an accepted purge request, before activation of affected public behavior |
| Capacity and recovery | Keep reproducible counters, finite retries/admission/retention and cost forecasts | Measure final paid usage, database allocation, R2 retention/peaks, restore/rollback and operational alerts |

The policy removes Free-tier feasibility blockers from Phase 24 and budget-related blockers in its consumers, owner APIs, cleanup and production-delivery work. It does not declare unrelated phases dependency-ready, check completion boxes, or waive functional/privacy/withdrawal checks. Local fixtures are sufficient for local development; production plan/bindings/callbacks/TLS and paid-provider performance are release gates. Do not require buying the plan early to continue coding.

## Implementation sequence

1. Integrate this decision with the tested S-8 local milestone into the shared base. Record the integration revision and applicable local gate in the S-8 result and Phase 24 audit. Preserve the old audit and failed measurements.
2. Continue Phase 24 in its existing worktree. Reuse sealed revision capture, actual shared rendering, streaming assembly and named private transfer. Add sanitized snapshot/document-shell/manifest/static-asset retention and failure cleanup, without changing the live pointer.
3. Continue downstream phases when their actual implementation dependencies are integrated. Keep S-9 validation with dependent serving/withdrawal work; complete account deletion, asset GC and recovery against sealed/current/retained references.
4. In Phase 52 prepare separate production configurations and a release checklist. At launch preparation, upgrade, perform isolated paid-provider verification and reconcile the measured monthly budget. Only then activate real routes/consumers/cron and run release smoke/acceptance checks through Phases 53–54.

## PR and integration status

The owner requires a separate session branch and PR. Changes are proposed on `docs/paid-launch-policy`; do not push directly to main or merge without the normal owner review. Local `main` was restored to its starting `5564c31` after candidate testing; the remote main was never changed. The [full candidate gate](../specs/2026-10-24-s8-dispatch-feasibility/evidence/integration-869aa40.json) passed all 13 commands at `869aa40`. The [preserved Phase 24 audit](../specs/2026-10-24-immutable-publication/results.md) now distinguishes this pending PR integration from the superseded Free-budget blocker. After merge, rerun only checks invalidated by integration, then proceed locally without an early subscription purchase.

## Sources

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
