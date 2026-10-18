# Phase 13 provider performance

CPU measurements ran October 17 UTC. Instrumented provider quotas and completion review finished October 18, 2026. The temporary web Worker forwards to the named jobs entry through a real service binding. Requests use signed provider-fixture sessions and a dedicated D1 database. The fixture imports the production owner router; production does not import fixture SQL or measurement code.

## CPU and startup

The table combines the final measurement of each case. Ordinary saves and the first five validation cases use 100 commands after ten warmups. Maximum reads use the final streamed implementation with 100 commands after ten warmups. Deep traversal and correction use 100 commands each after 100 warmups. The deep traversal completes a supported maximum-depth rich-text tree with an escaped destination at its approved byte limit.

All reported warm p95 values meet the target below 10 ms. Jobs startup is 60 ms and web startup is 48 ms, below one second. The [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) were checked October 18, 2026. A p95 target permits individual outliers; it does not prove every invocation fits a hard CPU allowance or establish capacity for every document shape.

| Case | Jobs p95 CPU, ms | Web p95 CPU, ms | Jobs adaptive request count |
| --- | ---: | ---: | ---: |
| read-max | 8.881 | 0.855 | 99 |
| patch-max | 7.167 | 0.958 | 96 |
| progress-read | 6.167 | 0.859 | 101 |
| progress-save | 5.759 | 0.901 | 98 |
| begin | 6.548 | 2.032 | 93 |
| change | 8.453 | 0.928 | 100 |
| pending | 5.914 | 0.887 | 100 |
| status | 6.540 | 0.948 | 99 |
| commit-max | 6.839 | 0.945 | 100 |
| string-start | 7.380 | 0.919 | 93 |
| piece | 7.317 | 1.051 | 95 |
| string-finish-max | 8.896 | 1.091 | 99 |
| resume | 6.163 | 0.939 | 95 |
| abort | 6.344 | 0.932 | 99 |
| cleanup | 6.611 | 0.919 | 93 |
| validation-begin | 5.284 | 0.926 | 102 |
| validation-step | 8.580 | 0.916 | 98 |
| validation-free-text | 8.808 | 0.962 | 104 |
| validation-finish | 6.633 | 1.031 | 104 |
| validation-commit | 7.342 | 0.961 | 101 |
| validation-deep | 9.010 | 0.880 | 97 |
| validation-correct | 7.139 | 1.030 | 100 |

Provider quantiles are microseconds divided by 1,000. These rows use the LHE success group, matching the client colocation. The retained analytics also include occasional service/internal events from other locations. Adaptive sampling and client timestamp boundaries explain differences from 100 commands. Counts and percentiles are reported as returned, without synthesizing percentiles across groups. Client elapsed time includes network/database wait and is not CPU.

CPU runs disable the D1 wrapper and preserve the native environment object, so authentication can reuse its existing immutable configuration cache. Fixture preparation happens before the real handler and its CPU remains included conservatively. The diagnostic headers confirmed reuse of both the native environment and database binding; no owner content or session authorization is cached. The separate quota deployment enables the wrapper, whose overhead is excluded from this CPU table.

Sources: [base client windows](deployed-requests.json), [jobs analytics](analytics-jobs.json), [web analytics](analytics-web.json), [final streamed read windows](read-streamed/deployed-requests.json), [read jobs analytics](read-streamed/analytics-jobs.json), [read web analytics](read-streamed/analytics-web.json), [deep/correction windows](validation-steady/deployed-requests.json), [validation jobs analytics](validation-steady/analytics-jobs.json), [validation web analytics](validation-steady/analytics-web.json), [jobs startup](deploy-jobs.txt), [web startup](deploy-web.txt).

## Changes supported by measurement

The initial whole-string maximum read measured 13.062 ms p95. Removing unused session-refresh work and the redundant owner-repository lookup reduced this to 10.733 ms. One hundred warmups still measured 10.081 ms. The final implementation returns D1-generated text chunks from one materialized snapshot and encodes them into a response stream. It measures 8.881 ms p95, 6.840 ms p50 and 10.184 ms p99. All 100 client reads succeeded. The measured D1 row cost rises from five to 268 while queries remain three. This tradeoff is part of the [quota model](quotas.md).

Legacy validation initially rebuilt lazy recursive schema definitions. A WeakMap now retains only immutable schema definitions. The traversal cursor retains checked ancestor metadata, so returning from a child does not revalidate its ancestors. Calls process at most four fresh nodes and at most two when starting deeper than 24 path elements. This bounds work within the approved 16-node ceiling. The final deep run measures 9.010 ms p95, with a maximum observed 3,615 validation bytes and at least one complete traversal. Correction measures 7.139 ms p95. An email value is transferred only within its stored kind's 254-byte bound; URL destinations use 2,048 bytes.

The preceding four-node deep experiment measured 10.168 ms p95. Its correction run stopped on an empty 503 after 99 measured successful correction commands. The sanitized tail recorded a jobs exception with no CPU-limit outcome or captured diagnostic cause. The final 100-command deep/correction run succeeded after the bounded-work changes. This does not establish why that earlier provider request failed, and the API has no automatic resume, discard or cleanup behavior. The failed run remains in [partial client evidence](validation-final/deployed-partial.json) and [analytics](validation-final/analytics-jobs.json).

Earlier read measurements remain in [first read optimization](read-final/analytics-jobs.json) and [longer warmup](read-steady/analytics-jobs.json). The [sanitized jobs tail](tail-jobs.json) and [web tail](tail-web.json) retain method, path/case, outcome, CPU and timing without request headers, cookies, response bodies or document content. Tails are sampled and stop before the later quota run; they are supplementary evidence rather than a full request trace.

## Quota instrumentation and cleanup

A separate final deployment enabled request-scoped D1 metadata counters. All 22 short benchmark cases passed with two fresh commands each and no warmups. Maximum read costs 268 reads and three queries on both local and deployed D1. Each measured cleanup receipt reports 32 pieces and one empty attempt removed, with 143 reads, 33 writes and five queries. The short deep quota case covers its initial steps; the separate 100-command local and provider traversals cover deeper work.

See [deployed quota commands and receipts](deployed-quota/deployed-requests.json), [quota deployment](deploy-quota-jobs.txt) and [local/deep budgets](quotas.md). Old uninstrumented CPU samples recorded zero counters, and newer ones record null. Both mean unavailable, not zero database work.
