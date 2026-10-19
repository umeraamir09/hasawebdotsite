# Phase 14 provider CPU investigation

The first complete Phase 14 provider run did not meet the existing warm p95 target below 10 ms. All 2,200 primary commands succeeded, but several jobs handlers exceeded the target. The client reached KHI; the historical Phase 13 passing run reached LHE. Geography alone does not establish a cause or excuse the failed gate.

The table reports the KHI success group from adaptive analytics, in milliseconds. Each case sent 100 commands after ten warmups. Session identities were uncached, immutable authentication configuration was reused, and quota wrappers were disabled. Provider counts can differ from client counts because these are adaptive timestamp-window aggregates.

| Case | Jobs p95, ms | Web p95, ms | Jobs adaptive requests |
| --- | ---: | ---: | ---: |
| read-max | 16.637 | 1.807 | 100 |
| patch-max | 11.753 | 1.825 | 99 |
| progress-read | 8.949 | 2.271 | 100 |
| progress-save | 8.732 | 2.235 | 99 |
| begin | 9.925 | 2.009 | 97 |
| change | 14.279 | 2.031 | 100 |
| pending | 9.353 | 2.095 | 115 |
| status | 9.535 | 2.187 | 100 |
| commit-max | 13.132 | 2.076 | 100 |
| string-start | 14.949 | 2.567 | 99 |
| piece | 12.351 | 1.984 | 100 |
| string-finish-max | 13.215 | 2.161 | 102 |
| resume | 10.138 | 1.927 | 96 |
| abort | 11.873 | 2.382 | 100 |
| cleanup | 11.791 | 2.689 | 100 |
| validation-begin | 9.766 | 2.106 | 101 |
| validation-step | 14.126 | 1.960 | 100 |
| validation-free-text | 15.918 | 2.157 | 97 |
| validation-finish | 12.876 | 2.327 | 101 |
| validation-commit | 13.237 | 2.744 | 97 |
| validation-deep | 17.977 | 2.308 | 102 |
| validation-correct | 13.863 | 2.423 | 62 |

Sources: [client windows](provider/deployed-requests.json), [jobs analytics](provider/analytics-jobs.json), [web analytics](provider/analytics-web.json), [jobs startup](provider/deploy-jobs.txt), [web startup](provider/deploy-web.txt). Historical evidence is preserved in the [Phase 13 performance report](../2026-10-17-revision-aware-drafts/performance.md).

## Controlled comparison and experiments

A comparison deploys the previous owner router from HEAD against the same isolated fixture resources and original 16,384-code-point database reader. It omits only the new missing/mismatched-header assertions because that router predates the precondition. All requests otherwise use the same signed sessions, current fixtures and limits. The default regression suite continues to require the owner header. See [comparison deployment](provider/header-baseline/deploy-jobs.txt).

The comparison reached LHE, so it cannot isolate the owner header's cost against the earlier KHI run. Its maximum read narrowly failed at 10.017 ms p95, while patch, begin, string-start, piece and deep validation measured 6.205, 5.216, 6.898, 7.117 and 9.772 ms respectively. All 600 primary comparison commands succeeded. See [comparison client windows](provider/header-baseline/deployed-requests.json), [jobs](provider/header-baseline/analytics-jobs.json) and [web](provider/header-baseline/analytics-web.json).

The candidate replaces unused general owner repository construction with the database package's direct persisted-session precheck, reuses setup/content engines within each request and increases bounded stream chunks to 65,536 Unicode code points. Session refresh and all database access checks remain in place. A 30-command exploratory run after ten warmups reached LHE and measured jobs p95 of 7.471 ms for maximum read, 7.700 patch, 5.916 begin, 6.363 string-start, 5.758 piece and 8.538 deep validation. All 180 primary commands succeeded. These exploratory samples do not replace the required complete run. See [candidate patch](provider/candidate-65536/candidate.patch), [client windows](provider/candidate-65536/deployed-requests.json), [jobs](provider/candidate-65536/analytics-jobs.json) and [web](provider/candidate-65536/analytics-web.json).

The candidate changes preserve uncached Better Auth lookup, session refresh on existing routes, persisted expiry/revocation/deletion checks, SQL ownership predicates, canonical CAS, request limits and streamed content. Local tests alone do not establish provider feasibility. The following native follow-up determines retention, with separate cleanup receipts required.

## Final native CPU follow-up

The retained candidate meets the existing warm p95 target in the measured LHE runs. Each of the 22 cases sent 100 primary commands after ten warmups. Jobs startup is 103 ms and web startup 36 ms, both below one second. The final jobs p95 maximum is 8.797 ms; web is 1.230 ms. The candidate retains all protocol limits and its current read costs 76 local D1 rows instead of 268.

The normal run completed all 1,500 primary save/recovery commands, then the unmeasured fixture SQL update preparing validation returned Cloudflare 500 / 1101, Worker threw exception. The seven validation cases ran separately with 700 primary commands. All 2,200 primary commands returned 200. The normal cleanup analytics window also contains one scriptThrewException group at 0.743 ms p95; all primary cleanup commands succeeded. The cause of the fixture exception is unknown; no CPU-limit outcome was captured. The failed run is retained, not rewritten as a complete uninterrupted success.

| Case | Jobs p95, ms | Web p95, ms | Jobs adaptive requests |
| --- | ---: | ---: | ---: |
| read-max | 8.474 | 0.843 | 99 |
| patch-max | 5.853 | 0.900 | 106 |
| progress-read | 4.541 | 0.815 | 95 |
| progress-save | 4.892 | 0.864 | 100 |
| begin | 5.888 | 1.027 | 96 |
| change | 6.993 | 0.932 | 96 |
| pending | 4.827 | 1.044 | 109 |
| status | 5.334 | 0.915 | 109 |
| commit-max | 6.338 | 0.927 | 96 |
| string-start | 6.807 | 0.959 | 101 |
| piece | 6.276 | 1.075 | 99 |
| string-finish-max | 6.266 | 1.154 | 100 |
| resume | 5.112 | 0.984 | 99 |
| abort | 5.918 | 0.980 | 114 |
| cleanup | 5.696 | 0.919 | 97 |
| validation-begin | 5.485 | 0.988 | 98 |
| validation-step | 8.261 | 0.939 | 98 |
| validation-free-text | 8.098 | 0.916 | 107 |
| validation-finish | 6.355 | 0.910 | 106 |
| validation-commit | 6.621 | 0.989 | 96 |
| validation-deep | 8.797 | 1.230 | 96 |
| validation-correct | 6.747 | 1.049 | 92 |

The validation deep case completed one full traversal of the supported maximum-depth rich-text fixture. The retained configuration has not been remeasured in KHI. Its initial KHI failure remains a deployment prerequisite, rather than being explained away by a passing LHE sample. Recheck intended deployment conditions before owner-flow activation. The p95 target permits individual outliers; it does not prove every warm/cold invocation fits the hard Free allowance or establish publication feasibility.

Sources: [normal client windows and fixture failure](provider/final-65536/deployed-partial.json), [normal jobs](provider/final-65536/analytics-jobs.json), [normal web](provider/final-65536/analytics-web.json), [validation clients](provider/final-validation/deployed-requests.json), [validation jobs](provider/final-validation/analytics-jobs.json), [validation web](provider/final-validation/analytics-web.json), [candidate startup](provider/candidate-65536/deploy-jobs.txt).

## Provider quota check and cleanup

All 22 quota-instrumented cases pass with two fresh commands each and no warmups. Maximum reads cost 76 rows and three queries, matching local evidence. Prepared cleanup receipts remove 32 pieces and one empty attempt with 142 reads, 33 writes and five queries. See [deployed counters](provider/deployed-quota/deployed-requests.json) and the [current quota model](quotas.md). CPU evidence above uses the native unwrapped database binding; the quota deployment is excluded from CPU claims.

Both temporary Workers, D1 database `4bd2fda3-ea36-4b0f-9d34-62605066f0e7` and local fixture secrets were deleted. See [provider deletion receipts](provider/cleanup.txt) and [independent absence verification](provider/cleanup-verification.json). No production resources or configurations were deployed.
