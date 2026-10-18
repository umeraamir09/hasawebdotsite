# Phase 13 request and D1 budgets

October 18 compatibility note: these tables preserve the original Phase 13 implementation and measurements. Phase 14 changes the required owner header, removes unused general repository construction from action authorization, and uses 65,536-code-point response chunks. Consult its [CPU investigation](../2026-10-18-shared-autosave-recovery/performance.md) and [current client costs](../2026-10-18-shared-autosave-recovery/quotas.md) before reusing these as current budgets.

These local workerd measurements include uncached Better Auth lookup and product authorization, unlike the earlier repository-only model. They exclude keyed fixture preparation. The wrapper records D1 row/query metadata and also accounts for Drizzle raw reads. Each row is the maximum observed across two fresh commands after ten warmups.

| Handler case | Rows read | Rows written | Queries |
| --- | ---: | ---: | ---: |
| read-max | 268 | 0 | 3 |
| patch-max | 99 | 1 | 5 |
| progress-read | 8 | 0 | 4 |
| progress-save | 12 | 1 | 4 |
| begin | 12 | 4 | 4 |
| change | 101 | 1 | 7 |
| pending | 8 | 0 | 4 |
| status | 8 | 0 | 4 |
| commit-max | 21 | 2 | 7 |
| string-start | 22 | 1 | 8 |
| piece | 16 | 3 | 7 |
| string-finish-max | 358 | 1 | 6 |
| resume | 11 | 1 | 5 |
| abort | 13 | 2 | 5 |
| cleanup | 143 | 33 | 5 |
| validation-begin | 11 | 4 | 4 |
| validation-step | 92 | 1 | 9 |
| validation-free-text | 48 | 1 | 9 |
| validation-finish | 82 | 1 | 6 |
| validation-commit | 23 | 2 | 7 |
| validation-deep | 76 | 1 | 9 |
| validation-correct | 15 | 1 | 6 |

The separate 100-step deep traversal after 100 warmups reached 118 reads and 11 queries in a call. All API checks assert the [50-query Free invocation limit](https://developers.cloudflare.com/d1/platform/limits/), checked October 18, 2026. The production validator processes at most four fresh nodes per call, or two for deep paths, within the approved maximum of 16. It never transfers more than 4 KiB of validation data. Containers, record-key lookup and final SQL invariants account for variation between steps.

The maximum draft read streams chunks from one materialized snapshot. This costs 268 observed D1 reads instead of five in the earlier whole-string response, while retaining three total authentication/content queries. Thirty maximum-size reads/day would consume about 8,040 reads in this fixture. The higher row count buys lower Worker CPU without private-content caching or weaker access checks.

The final [deployed D1 pass](deployed-quota/deployed-requests.json) runs two fresh commands per case without warmups. Twenty cases match the local table. Resume reaches 13 reads, two writes and six queries when the first command transfers its session. The initial deep validation calls reach 92 reads, one write and nine queries. The 100-command deep run above remains the better bound for the supported deep fixture. Each provider cleanup receipt records exactly 32 pieces and one empty attempt removed. CPU runs disable these counters; their zero/null fields mean unavailable.

Canonical writes retain their single-row update. Attempt creation/commit and string-piece insertion also change staging/index rows. Cleanup removes at most 32 piece rows, then an eligible empty attempt; its reported D1 writes include that attempt and indexes. A new string may replace retained pieces under the existing measured protocol.

The [previous quota model](../2026-10-16-free-owner-saves/quotas.md) remains the capacity baseline. At 3,000 representative patches/day, the observed complete API path costs approximately 297,000 reads and 3,000 canonical writes. Session refresh, failures, retries, reads, staging and cleanup need additional capacity. Neither a passing CPU percentile nor this representative eight-component draft bounds the cost of every possible one-MiB collection.

Legacy validation is an explicit recovery operation. A large free-text field stays in D1, while a dense tree requires many small calls. Budget those calls and authentication queries separately; this phase does not schedule validation or add an autosave client. Full restaging per keystroke remains outside the approved model.

See [local measurements](local-benchmark/local-results.json), [deep traversal measurements](deep-local/local-results.json) and the [production protocol](protocol.md). Provider measurements and cleanup are recorded in [results](results.md).
