# Phase 14 browser request costs

These are local workerd/D1 observations through the production web adapter and named jobs router, including uncached authentication. They are not provider CPU or a guarantee of application capacity. The existing [Phase 13 handler budgets](../2026-10-17-revision-aware-drafts/quotas.md) and [Free capacity model](../2026-10-16-free-owner-saves/quotas.md) remain constraints.

The [browser evidence](review-browser/browser-results.json) records each request's encoded body size, D1 reads/writes and query count. Test-group totals include fixture provisioning and initialization unless explicitly excluded below. SQL preparation and browser storage writes are outside those HTTP/D1 counters. Session refresh can add writes. The current direct persisted access precheck avoids constructing unused general owner repositories; its successful action paths read one fewer row in these fixtures. Stream chunks now contain at most 65,536 Unicode code points, reducing the measured maximum read from the historical 268 rows to 76 at the same three queries. Original Phase 13 receipts remain unchanged.

| Behavior | Observed cost |
| --- | --- |
| Ordinary changed name | One patch, 155-byte request in the representative fixture, 101 reads, one write, five queries; no full read after acknowledgement |
| Exact 1 MiB target with all eight component types | One begin, three changes, one string-start, 256 pieces, one string-finish, one commit and nine cleanup calls |
| Maximum-save commands, excluding initialization | 272 requests, 6,081 D1 reads, 1,036 writes; both Workers conservatively count as 544 invocations |
| Complete maximum-save test group | 276 requests, 6,116 reads and 1,040 writes, including provisioning and initial owner/draft/pending reads |
| One changed title in 3,000 text components | One 172-byte patch, 12,040 reads, one write and five queries |
| Grouped profile/order/appearance/ready-reference scenario | 18 requests, 810 reads, 18 writes across its flushes, provisioning and initialization |
| Correcting one invalid legacy email in the eight-type fixture | 78 requests, 3,151 reads and 73 writes, including initialization, issue detection, kind rejection, explicit correction, commit and cleanup |
| Lost direct-patch reply with reload/recovery | Nine requests, 172 reads, five writes, including initialization/provisioning |
| Lost staged change/piece/string-finish reply with reload/recovery | 22 requests, 493 reads, 38 writes in each representative scenario |
| Lost begin receipt with explicit discard/rebuild | 27 requests, 542 reads, 45 writes, retaining exact input and captured progress |

Explicit discard adds one metadata read to pin its canonical revision before cleanup. Transfer/discard retries retain their command intent. Representative complete test groups include initialization/reload, authentication, recovery and cleanup:

| Recovery group | Requests | Reads | Writes |
| --- | ---: | ---: | ---: |
| Lost content-transfer reply | 21 | 363 | 31 |
| Lost validation-transfer reply plus correction | 84 | 3,204 | 75 |
| Lost abort reply plus reload/discard | 27 | 520 | 18 |
| Lost discard-cleanup reply plus reload | 27 | 514 | 18 |

The maximum-save example packs ASCII text pieces to the actual JSON-encoded 4,096-byte limit. Its largest wire request is 4,164 bytes. Escaped Unicode, quotes, backslashes and lone surrogates have their own packing tests; string pieces never split a surrogate pair. Every observed browser request stays below 50 queries. Dense-tree validation is bounded per call, not cheap in aggregate.

## Daily planning calculation

At the existing estimate of 30 editing sessions/day, one measured maximum save per session adds 16,320 conservatively counted web/jobs invocations and 31,080 writes. Added to the earlier 20,000-request/5,000-write baseline, this is roughly 36,320 invocations and 36,080 writes, before additional reads, recovery, validation, retries, session refresh and the still-unverified publication dispatcher. The baseline already includes routine autosaves; do not add their writes twice.

Three thousand representative 101-read patches cost about 303,000 reads. Thirty maximum saves add 182,430 reads. Add 2,280 reads for thirty current maximum streamed reads and the historical 50,000 non-save planning allowance to get about 537,710 reads. This is an illustrative planning calculation, not observed daily traffic or proof that all application work fits Free.

Repeated maximum-field replacements remain outside that estimate. At 3,000 such transfers/day, the measured example alone would exceed 1.6 million Worker invocations and three million D1 writes. The client coalesces edits and saves changed subtrees; it cannot make the existing protocol send a substring patch for an arbitrary huge free-text field.

Three thousand daily patches against the dense 3,000-component fixture would cost about 36.1 million reads, above the five-million planning limit. A 500,000-read reserve leaves capacity for roughly 370 such patches account-wide. Small transport size does not remove D1's cross-document scans. Preserve this boundary in later editor/publication/operational work; do not silently add paid resources, reduce the agreed content cap or claim unlimited autosave capacity.

Phase 51 still supplies dormant-owner bounded garbage collection; Phase 52 supplies monitoring/admission decisions. Validation and explicit recovery need their own allowance. The one-hour expiry does not physically delete staging. Canonical saves and cleanup retain the existing per-invocation limits and 512-piece storage bound.

## Deployed D1 confirmation

A separate quota-instrumented deployment passed all 22 cases with two fresh commands each and no warmups. It confirms the current 76-read / three-query maximum response and bounded cleanup (32 pieces and one empty attempt per prepared receipt). Instrumentation changes environment reuse and is excluded from CPU claims. These are per-handler fixture observations, separate from the browser scenario totals above. The short deep case measures its starting steps; use the full traversal evidence for depth coverage.

| Case | Maximum rows read | Maximum rows written | Maximum queries |
| --- | ---: | ---: | ---: |
| read-max | 76 | 0 | 3 |
| patch-max | 98 | 1 | 5 |
| progress-read | 7 | 0 | 4 |
| progress-save | 11 | 1 | 4 |
| begin | 11 | 4 | 4 |
| change | 100 | 1 | 7 |
| pending | 7 | 0 | 4 |
| status | 7 | 0 | 4 |
| commit-max | 20 | 2 | 7 |
| string-start | 21 | 1 | 8 |
| piece | 15 | 3 | 7 |
| string-finish-max | 357 | 1 | 6 |
| resume | 12 | 2 | 6 |
| abort | 12 | 2 | 5 |
| cleanup | 142 | 33 | 5 |
| validation-begin | 10 | 4 | 4 |
| validation-step | 91 | 1 | 9 |
| validation-free-text | 47 | 1 | 9 |
| validation-finish | 81 | 1 | 6 |
| validation-commit | 22 | 2 | 7 |
| validation-deep | 91 | 1 | 9 |
| validation-correct | 14 | 1 | 6 |

Source: [deployed quota commands and cleanup receipts](provider/deployed-quota/deployed-requests.json), [instrumented deployment](provider/deployed-quota/deploy-jobs.txt).
