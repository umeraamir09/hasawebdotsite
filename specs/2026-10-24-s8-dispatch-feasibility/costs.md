# Shared cost calculation

## Current `s8-v3` verdict, October 27, 2026

The complete required fit still fails. The dense scenario exceeds Queue operations, maximum content has no passing native CPU result, and permitted asset inventories exceed storage. [Current provider counters and forecasts](evidence/shared-ledger-s8-v3.json) supersede the historical tables below. Reproduce them with `node scripts/publication-dispatch-costs.mjs specs/2026-10-24-s8-dispatch-feasibility/evidence/provider-s8-v3-quota-results.json output.json`. This calculator does not certify CPU, future handlers or general storage feasibility.

Application code is exact `5b796ac`, with the client-only gallery-plus-Face fixture from `94f317b`. [Native versions](evidence/native-s8-v3-provider-versions.json) identify the separate uninstrumented deployment. [Quota invocation boundaries](evidence/provider-s8-v3-invocations.json) identify instrumented Queue version `bc36f7d4-b2f6-4413-a504-8080af141aab`; all 148 captured events report `ok`. Its CPU fields are excluded from native acceptance.

## Measured ordinary work

| Case | Checkpoints | D1 reads, including source | D1 writes | Queue operations | R2 A / B |
| --- | ---: | ---: | ---: | ---: | ---: |
| small | 9 | 349 | 45 | 27 | 5 / 6 |
| max | 28 | 989 | 115 | 84 | 24 / 78 |
| dense | 60 | 94,099 | 197 | 180 | 56 / 108 |
| assets-face | 38 | 1,861 | 160 | 114 | 33 / 59 |

[Deployed completion/cleanup counts](evidence/provider-s8-v3-quota-results.json) agree with the local ordinary checkpoint counts. Per-case cleanup uses 2/3/5/3 wakes for small/maximum/dense/gallery-plus-Face. The ledger additionally reserves its measured D1/R2 work. Source transfer includes two persisted authorization queries and one R2 read per copied asset. The largest parent has 16 conservatively counted D1 statements and 38 combined internal calls; no core external HTTP calls, and at most two simultaneous storage bodies. These remain below the separate per-invocation limits.

Provider quota transfers use 128-byte synthetic files. The full-size local and native tests separately verify permitted maximum image/PDF transfers with exact byte/hash checks. Storage inventories match by fixed fixture, input bytes, page paths/byte lengths, sites inventory, asset IDs and object counts. Each report independently passes the full-renderer oracle. Output hashes differ across candidates because their URLs contain different UUIDs. Both provider binary inventories and full-size local inventories remain in the merged report.

## Complete shared forecast

Keep 100 portfolios, 30 editing sessions and 30 publishes/day. The saving/recovery baseline remains 52,400 Worker invocations, 1,450,000 reads and 66,000 writes. Its historical non-save allowances are replaced, not counted twice. Shared contact/GitHub/static-refresh forecasts add 3,600 requests, 112,384 reads, 10,032 writes and 2,919 Queue operations/day. This includes a sweep reserve based on 38 local observations, using the worst observed reads/writes for all 288 daily sweeps. Shared handler costs remain forecasts, not implemented handler measurements.

Each publication also forecasts owner polling every five seconds for at least five minutes, through two Workers and ten reads per poll. Future delivery includes 128-KiB snapshot chunks with bounded sixteen-way assembly, document shells, a size-based manifest, 404/robots/sitemap and generated styles. These require 5/15/9/7 forecast tasks respectively. Packing, exact output, CPU and actual counters remain future integration checks. Static library bytes are inventoried once globally; raw source regeneration inputs must not enter publication manifests.

The replay allowance selects the most expensive distinct `ceil(10% × logical batches)` once per resource, including forecast delivery tasks. A future task has a conservative replay envelope of one wake, ten reads, four writes, three R2 A calls and 32 R2 B calls for bounded head/read assembly. The daily failure reserve includes one fully worked candidate, future delivery, cleanup and four additional worst-cost wakes. One/three/ten complete replay storms and the older repeated-maximum upper bound remain explicit JSON scenarios.

| Shared scenario | Requests/day | Reads/day | Writes/day | Queue/day | R2 A/month | R2 B/month |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| small | 60,468 | 1,596,743 | 79,006 | 4,599 | 94,830 | 1,156,980 |
| max | 61,610 | 1,626,627 | 83,189 | 7,659 | 131,760 | 1,327,080 |
| dense | 62,416 | 4,665,125 | 85,093 | 10,443 | 165,060 | 1,403,280 |
| assets-face | 61,857 | 1,659,166 | 84,087 | 7,845 | 132,690 | 1,294,530 |
| Agreed allowance | 100,000 | 5,000,000 | 100,000 | 10,000 | 1,000,000 | 10,000,000 |

Dense publications exceed the Queue forecast by 443/day. They leave 334,875 D1 reads and 14,907 writes/day. The maximum case leaves 2,341 Queue operations/day but still lacks a passing CPU result. Operation headroom does not establish feasibility. The [Queue pricing contract](https://developers.cloudflare.com/queues/platform/pricing/) counts operations per message, so consumer delivery batching cannot discount these wakes.

If all thirty daily publications each suffer additional complete replays, the following Queue stress forecasts add to the existing ten-percent and failed-candidate reserves. The JSON also retains per-publication request/read/write/R2 costs. These are forecasts, not observed storms.

| Scenario | One extra full replay each | Three extra each | Ten extra each |
| --- | ---: | ---: | ---: |
| small | 5,859 | 8,379 | 17,199 |
| max | 11,529 | 19,269 | 46,359 |
| dense | 16,653 | 29,073 | 72,543 |
| assets-face | 11,895 | 19,995 | 48,345 |

The nominal dense capacity is 28 publishes/day under this reserve model, below the agreed thirty. That is a failure of the target workload, not a new product limit.

## CPU, allocation and asset growth

The [five native maximum repetitions](evidence/native-s8-v3-five-cpu.json) retain each region/version/outcome instead of averaging percentiles. The last three have exactly 28 observations each and p95 values of 29.165, 29.615 and 31.971 ms. Earlier repetitions contain two `clientDisconnected` outcomes and extra invocations, despite complete correct output. The [full-size matrix](evidence/native-s8-v3-matrix-cpu.json) and interrupted full-size repetition are separate cohorts. Warm/cold isolates are not labeled. The [separate native HTTP sweeper probe](evidence/native-s8-v3-sweeper-cpu.json) observes all five tombstone sweeps, with regional p95 10.419 ms in KHI and 7.673 ms in LHE. The empty-sweep window omits one of ten requests. This is not scheduled-trigger proof. No sub-10-ms pass or percentage speedup is claimed. Diagnostic profiles show local SDK/response conversion work, without proving native outlier attribution.

Candidate admission bounds sources to four and records to 128. [Native D1 churn](evidence/native-s8-v3-lifecycle.json) inserted/deleted four 1-MiB source payloads three times. Database metadata repeatedly rose from 1,372,160 to 5,578,752 bytes and returned to 1,372,160 bytes. Delete-statement metadata reported 1,376,256 bytes. This allocation-only fixture omits 100-owner canonical/history/index/page growth. Bounded retention is tested; general physical capacity and a production collector remain unproved.

The [full-size repeated gallery plus Face Reveal](evidence/gallery-face-storage-results.json) retains 50 MiB privately and copies 50 MiB publicly. With one public version for 100 portfolios, the ledger projects 10,487,616,300 bytes before additional delivery work. Delivery, four candidate peaks and one day of sixty maximum-image orphans reach 11,015,636,956 bytes. Neither a second retained version nor a retry storm is needed to fail this layout. A 24-hour orphan window and the public retention policy are forecasts. Without collection, sixty maximum-image replacements/day add 9,437,184,000 bytes in thirty days.

The [distinct-gallery lower bound](evidence/unique-gallery-storage-lower-bound.json) is a schema-validated variant with 24 unique gallery images. At maximum permitted upload sizes, those gallery images alone require 12,582,912,000 bytes across 100 portfolios. Its 29 distinct assets require 15,728,640,000 bytes even with one physical copy. This is calculated allowed content, not a new binary/native measurement. A single-copy design can reduce duplication, but cannot guarantee this maximum-content workload fits. An aggregate content/storage contract or larger allowance needs an explicit owner decision. No allowance, workload or plan changes here.

The agreed ledger uses 10,000,000,000 bytes. [R2 pricing](https://developers.cloudflare.com/r2/pricing/) describes GB-month as average daily peak storage; temporary peaks must enter that forecast. Steady inventories persisting for a month already exceed the budget. General replacement GC must protect draft, sealed-candidate and retained-version reachability, and preserve private reads and withdrawal. Historical source allocation, failures and approvals remain below.

## Historical initial ledger

The following tables describe the initial `s8-v2` follow-up. Current `s8-v3` counters and delivery/replay forecasts above supersede them. Their failed experiments and original provider evidence remain historical facts.


This is a failed feasibility result. Operation headroom does not override the failed native CPU gate. [Provider counters and forecasts](evidence/shared-ledger.json) are reproducible with `scripts/publication-dispatch-costs.mjs`; [local counters](evidence/local-batch32-results.json) supply separate recovery/cleanup and large-file inventories.

### Observed operations

Each invocation includes preparation reads, JSON parsing/normalization, real `renderFragment` work, D1 claim/checkpoint, R2 writes/assembly and continuation enqueueing. Asset transfer includes the named source service's authorization queries and R2 read. Native CPU runs disable quota proxies. Fixture setup, binary seeding, oracle rendering and output-download checks are outside the measured candidate. Provider control polling does not dilute Queue Worker analytics.

| Batch 32 case | Input bytes | Checkpoints | D1 reads | D1 writes | Queue operations | R2 A / B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small | 604 | 8 | 410 | 38 | 24 | 5 / 6 |
| Three-page maximum | 1,048,576 | 51 | 2,424 | 180 | 153 | 46 / 82 |
| Dense, 3,000 components | 520,383 | 116 | 202,954 | 361 | 348 | 113 / 222 |

Provider and local ordinary-case counters agree. Provider quota objects use 128-byte synthetic files; independent local and native runs verify full 5,242,880-byte images and 10,485,760-byte PDFs. Repeated gallery references use eight distinct copied objects across 24 project entries and a case-study image. Their local case needs 70 checkpoints. Transfer byte sizes affect latency/storage, while these single-object R2 operation counts remain unchanged.

A wake under 64 KB costs one write, read and delete. Consumer delivery batching does not discount messages. We count the initial send once, then measured continuation sends. Deletes are not R2 Class A/B charges, but are retained as operations and subrequests. [Queue accounting](https://developers.cloudflare.com/queues/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

The largest observed parent has 34 D1 statements and 36 conservatively combined internal calls, including candidate creation. The source hop has two D1 queries and one R2 read. Core dispatch makes no external HTTP requests. Streaming uses at most two storage bodies at once, with sequential assembly inputs. D1 batches count as one provider query; the instrumentation conservatively counts their statements. Check the separate Free ceilings of 50 D1 queries, 50 external subrequests, 1,000 internal subrequests and six simultaneous pending connections. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

### Planning workload and reserves

The ledger keeps 100 portfolios, 30 editing sessions and 30 publishes/day. The historical maximum-piece saving baseline contributes 52,400 conservatively counted Worker invocations, 1,450,000 reads and 66,000 writes. Its old 50,000-read/2,000-write non-save allowances are replaced by explicit shared forecasts. Routine saves are not added again. See the [save model](../2026-10-16-free-owner-saves/quotas.md) and [client orchestration/recovery model](../2026-10-18-shared-autosave-recovery/quotas.md). The historical saving/recovery reserve remains a forecast, not a measured daily traffic trace.

Shared forecasts reserve 3,588 invocations, 100,000 reads, 6,000 writes and 2,910 Queue operations/day. They cover 2,500 graph requests, 250 GitHub jobs, 90 contact submissions with all five attempts, ten notice jobs, provider retries and 288 shared sweeps. These handlers are not implemented here. Their reserved D1/CPU cost requires later measurement. Monthly R2 forecasts include 60 uploads and 100 orphan lists/day, 36,000 reads/day without edge-cache savings, and the maximum four two-bucket tombstone checks per five-minute sweep.

Each publish additionally forecasts owner polling every five seconds for at least five minutes, two Workers and ten D1 reads per poll, plus two snapshot/manifest invocations, six Queue operations, four reads, three writes and two R2 reads/writes. Those later-phase actions are not measured implementations. Existing art/styles/font bytes and hashes are [inventoried](evidence/platform-artifacts.json); production retention, document shells, future generated palettes, manifests and serving must be measured when implemented.

Every daily scenario includes one replay of `ceil(10% × checkpoints)` at the maximum observed per-resource invocation cost, normal candidate cleanup, and one completely worked failed candidate plus cleanup and four additional worst-cost claims. Cleanup is measured locally and scaled conservatively for object count. This deliberately over-reserves separate maxima that may not occur together. Lost-ack deliveries are not treated as free. The JSON also reports one, three and ten full-replay storms and resource-specific publish capacities.

| Shared workload | Requests/day | Reads/day | Writes/day | Queue/day | R2 A/month | R2 B/month |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small publishes | 60,458 | 1,584,879 | 74,445 | 4,686 | 96,330 | 1,091,520 |
| Maximum publishes | 62,153 | 1,691,327 | 80,933 | 9,135 | 138,960 | 1,246,440 |
| Dense publishes | 64,497 | 25,349,423 | 87,645 | 15,813 | 208,530 | 1,463,040 |
| Free allowance | 100,000 | 5,000,000 | 100,000 | 10,000 | 1,000,000 | 10,000,000 |

The maximum case leaves 37,847 requests, 3,308,673 reads, 19,067 writes and only 865 Queue operations/day. Dense publications exceed both reads and Queue operations; the conservative model permits only three/day before the read ceiling. The local gallery case projects 10,992 Queue operations/day, also over budget. At batch 16 the maximum case exceeds the Queue budget; batch 32's lower operation count fails native CPU. These are supported-content limitations, not permission to lower content limits or assume a paid plan.

### CPU and storage

The [repeat maximum CPU window](evidence/native-repeat-max-cpu.json) has 50 successful Queue observations in SEA, median 27.128 ms, p95 71.704 ms and p99 149.963 ms. It is the second identical maximum candidate after earlier executions, not an average of regional percentiles. The measurement window omits one of its 51 checkpoints. Initial/post-deployment and other-location samples are separate evidence. No `exceededCpu` was observed in the retained windows, but provider burst flexibility does not establish a 10 ms guarantee. Small batch-16 repeats alone reached p95 9.944 ms. Cold isolates are not directly labelled by these analytics. Final `s8-v2`, full production web-module startup, publication-start authorization in isolation and deployed sweeper CPU remain unverified. Do not substitute quota-tail CPU or client latency for missing native evidence.

The [provider inspection](evidence/provider-inspection.json) reports 2,400,256 D1 bytes for this isolated fixture. That is not a capacity test with 100 maximum owners. The historical local canonical/attempt/piece allocation is 426,217,472 bytes. One maximum source adds at least 1,048,455 payload bytes before row/index overhead. One hundred retained sources alone add 104,845,500 bytes and exceed the conservative 500 MB database ceiling alongside that stress baseline. Admission, physical source retention, cleaned-tombstone retention and deleted-owner identifier removal are not bounded yet. Logical expiry does not reclaim pages.

Local maximum inventory retains 9,437,178 HTML/assembly bytes and 26,214,400 copied asset bytes per candidate. As an asset-only forecast, 100 maximum portfolios with 30 MiB private assets and one 25 MiB public version use 5.77 GB; two public versions use 8.39 GB; three use 11.01 GB before HTML, temporary assembly, platform assets or additional gallery images. Sixty uncollected maximum image replacements/day add 9.44 GB in 30 days. Cleanup must preserve current drafts, sealed sources and retained versions while reclaiming replaced assets. This code does not establish that steady state or a general storage fit.

R2 storage scenarios assume retained bytes persist for the billing month. The allowance is 10 GB-month, calculated from average daily peaks; temporary assembly requires that calculation rather than treating 10 GB as an instantaneous service cap.
