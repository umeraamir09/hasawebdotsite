# Bounded owner-save results

October 16, 2026. The thin jobs owner API plus incremental D1 saves meets the measured warm p95 CPU target for the bounded operations below while retaining the 1 MiB draft ceiling. This is the tested runtime foundation for Phase 11A. Production portfolio/progress mapping and migrations remain in Phases 11B/13, and browser autosave/recovery orchestration remains in 14. Phase 11A's checkbox still awaits the owner's post-implementation approval.

The owner explicitly requested implementation/testing with reversible Git changes and approved the only field-limit changes: URLs at most 2,048 UTF-8 bytes and email addresses at most 254 UTF-8 bytes. Free text and all MVP component types remain supported. See the [protocol](protocol.md) for validation, recovery, expiry and integration details.

## Why the transport changed

The [original experiment](../2026-10-16-owner-api-runtime/results.md) failed at 1 MiB, with validation/save p95 of 44.337/59.874 ms and a confirmed `exceededCpu` save. Eliminating repeated whole-tree JSON scans lowered exploratory optimized validation/save p95 to 27.743/53.415 ms. Those [20-sample measurements](optimized/analytics-jobs.json) still fail. They are retained as an optimization experiment, not substituted for the historical baseline or presented as a pass.

The final repository validates bounded input against the shared schemas. D1 applies JSON changes, checks cross-document rules and atomically saves canonical content plus private progress under revision/session conditions. Large free text uses ordered immutable pieces and D1 assembly. No bounded save invocation parses, validates or serializes the entire maximum draft. Real Better Auth checks remain in place; only configuration is cached.

## Provider CPU

The first bounded run sent 100 measured requests per class after ten warmups. The follow-up repeated pieces, begin and cleanup and added maximum escaped URLs, pending, status and explicit cross-session resume, also with 100 measured requests per class. Both traverse the built web Worker forwarding adapter and named jobs entry using real signed Better Auth sessions in an isolated D1 database. The web Worker bundles the actual OpenNext adapter. Provider adaptive quantiles, not client timers, supply these values.

| Class | First jobs p95 ms | Follow-up jobs p95 ms |
| --- | ---: | ---: |
| Piece | 5.837 | 7.314 |
| Atomic commit | 5.923 | |
| Maximum string finish | 6.355 | |
| Staged change | 8.095 | |
| Patch, 1 MiB eight-type draft | 6.358 | |
| Patch, 34,000 rich-text nodes | 5.795 | |
| Patch, 3,000 components | 6.724 | |
| Abort | 6.744 | |
| Cleanup, 32 pieces | 5.744 | 7.841 |
| Begin | 9.609 | 7.762 |
| String start | 7.147 | |
| Maximum escaped URL replacement | | 7.550 |
| Pending | | 6.104 |
| Status | | 6.340 |
| Resume across sessions | | 6.587 |

All listed p95 values are strictly below 10 ms. The highest is 9.609 ms. Web forwarding p95 stays below 1.35 ms in these runs. The follow-up jobs/web startup is 86/43 ms, below 1,000 ms. The supplemental append/remove deployment reports 215 ms jobs startup, also below the target. Each tested deployment uses workers.dev, synthetic users and an isolated database. No production domain route, data or plan was changed.

The separate 100-sample array pass measures appending 32 validated text components to a near-limit draft at **8.381 ms jobs p95**, and removing from 3,000 components at **8.063 ms**. Both report zero provider errors. This pass also verifies starting a second staged string clears the previous retained pieces. Evidence: [requests](operations/deployed-requests.json), [jobs analytics](operations/analytics-jobs.json), [web analytics](operations/analytics-web.json) and [jobs startup](operations/deploy-jobs.txt). Across the three deployed runs there are 2,000 primary measured requests, plus warmups, correctness calls and 304 remainder pieces. All primary requests return their expected success response.

Raw evidence: [first requests](bounded/deployed-requests.json), [first jobs analytics](bounded/analytics-jobs.json), [first web analytics](bounded/analytics-web.json), [follow-up requests](final/deployed-requests.json), [follow-up jobs analytics](final/analytics-jobs.json), [follow-up web analytics](final/analytics-web.json), [startup jobs](final/deploy-jobs.txt) and [startup web](final/deploy-web.txt). [summary.json](summary.json) combines all runs and checks the target mechanically.

The measured commit and finish operate on the actual maximum-field upload, not a small stand-in. Additional benchmark repetitions restore fixed synthetic state inside the same measured invocation for begin/commit/string-start/string-finish/abort/cleanup. That preparation's CPU is included conservatively. The actual upload sends 262 genuine pieces; the first run took 187.2 elapsed seconds for those pieces. This is a latency observation for that location, not CPU or a general speed guarantee.

## Correctness and repository checks

The follow-up deployed test passes 17 assertion groups. Local tests also verify repository row usage. They cover real missing/tampered/expired/deleting sessions, strict origin/type/transport rules, malformed UTF-8/JSON, oversized input, prototype paths, nested rich-text discriminators, all MVP schema paths, approved URL/email boundaries, private owner isolation, revision races with exactly one winner, duplicate/mutated/reordered retries, lost-start recovery, session transfer, immutable milestones, invalid references, stale commits, maximum document size, a real maximum individual string, expiry, bounded cleanup, revoked-session discard, revocation at the write and a real D1 failure returning a private 503. Canonical content/progress remain unchanged during preparation.

| Verification | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm typecheck` | All 12 packages pass |
| `pnpm test` | 156 tests pass |
| `pnpm build` | All 12 package builds pass |
| `pnpm test:auth:browser` | 21 workerd/D1 groups and nine Chromium journey checks pass |
| `pnpm test:persistence` | 31 persistence/access groups pass |
| `pnpm test:runtime` | Three Workers, D1, three R2 buckets, services, Queue, Workflow and restart checks pass |
| Bounded local integration | [16 full-upload groups](bounded/local-results.json), plus [array branch checks](operations/local-results.json), pass |
| Bounded deployed integration | [17 full-upload groups](final/deployed-requests.json) and [16 supplemental array/recovery groups](operations/deployed-requests.json) pass |
| Storage allocation | [100 maximum drafts plus staging](bounded/storage-capacity.json) fit in 426,217,472 bytes locally |

## Limits of the evidence

The criterion is warm per-class p95, not a guarantee that every invocation stays below 10 ms. Several p99 values exceed 10 ms. The first traced signed-out/expired-session candidates report 15, 16 and 12 ms. They are not verified isolate-cold measurements. These occasional overruns carry a Free-tier failure risk even though the bounded runs report no `exceededCpu` outcome. Keep CPU monitoring and bounded retries; do not promise zero cold or tail failures. [Cloudflare documents occasional isolate flexibility and CPU termination behavior](https://developers.cloudflare.com/workers/platform/limits/).

Adaptive analytics uses client-time windows, approximate sampling and weighted counts. It can report fewer or more than 100 requests per 100-request client class. Measurements here come from LHE and do not establish performance in every colo. Sanitized real-time [jobs](final/tail-jobs.json) and [web](final/tail-web.json) traces supplement the follow-up runs, discard headers/cookies/logs and may themselves sample. Rounded tail CPU is distinct from the more precise adaptive quantiles. The first run's tail collector did not persist its output; its client responses and provider analytics remain the evidence for that run. The existing OAuth credential cannot read account subscriptions; no new subscription verification or billing change is claimed.

The [quota model](quotas.md) is part of the result. At the planned 30 editing sessions/day, one large upload per session plus ordinary changed-field autosaves fits the modeled daily request/write budget. Repeated maximum restaging after every edit does not. Scanning 3,000 components for every autosave can exceed the five-million-read allowance. The 426.2 MB local maximum-storage stress state leaves limited room for other rows, so production must monitor size and perform bounded garbage collection. These measurements do not establish the publication/Queue fallback's overall Free feasibility.

## Git and integration handoff

The branch is `feat/owner-api-runtime`. Focused commits preserve the steps:

- `4dafc36` retains the measured thin-runtime baseline and original failed evidence.
- `babb44d` removes repeated schema traversal and reuses serialized draft JSON.
- `b35cf85` adds the bounded revision-aware repository and isolated integration.
- `ca89779` adds recovery, bounded storage/transport, nested path support and approved destination limits. The commit records the validation-contract change explicitly.
- `09ce4f9` adds separate array-operation measurements and reproducible storage/summary tools.

To undo this follow-up while retaining the Phase 11A thin-runtime checkpoint, revert the later documentation/evidence commit, then `09ce4f9`, `ca89779`, `b35cf85` and `babb44d` in that order. Use new revert commits; do not reset shared history. No production schema migration accompanies the experiment, so Git rollback requires no production data downgrade. Inspect longer existing destinations before integrating the new limits; never silently trim owner content.

Phase 13 must use the approved 11B progress schema and map this repository to the canonical portfolio columns, migrate the staging tables and expose strict product handlers. Phase 14 must implement changed-field coalescing, conflict/local recovery and explicit pending/resume/discard orchestration. The isolated preparation/revocation routes must never be imported by the product entry. The tested incremental validator assumes a fully schema-valid canonical starting document and must evolve alongside future schema refinements.

## Reproduce

Run `pnpm test:bounded-saves` locally. Add `--benchmark --samples=2` when invoking the script directly for a quick local quota run. Then run `node scripts/bounded-save-capacity.mjs` for the local 100-owner storage stress check. That script uses only local D1 and a read-only SQLite page query.

For an authorized isolated Cloudflare rerun, create the named test D1 database, run `node scripts/owner-runtime-deploy.mjs prepare --bounded`, deploy with `OWNER_RUNTIME_EVIDENCE` pointed at the chosen evidence directory, and invoke `scripts/bounded-save-runtime.mjs --remote --benchmark`. `--cases` selects measured classes; `--skip-large` skips the actual large upload for supplemental array cases. Set `BOUNDED_SAVE_EVIDENCE` to keep separate runs. Collect sanitized tails, fetch provider windows with `scripts/cloudflare-analytics.py`, and run `node scripts/summarize-bounded-saves.mjs`. Finish with `scripts/owner-runtime-deploy.mjs cleanup`; it deletes both experiment Workers, the test D1 database and local experiment secrets. Do not reuse a production database or routes.

Cleanup completed for this run. [Deletion receipts](final/cleanup.txt) and an independent [resource check](final/resource-cleanup.json) confirm both experiment Workers and the experiment database are absent, with the two pre-existing D1 databases retained and local experiment secrets removed. No experiment production migration or route needs reversal.
