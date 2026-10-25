# Shared cost calculation

This is a failed feasibility result. Operation headroom does not override the failed native CPU gate. [Provider counters and forecasts](evidence/shared-ledger.json) are reproducible with `scripts/publication-dispatch-costs.mjs`; [local counters](evidence/local-batch32-results.json) supply separate recovery/cleanup and large-file inventories.

## Observed operations

Each invocation includes preparation reads, JSON parsing/normalization, real `renderFragment` work, D1 claim/checkpoint, R2 writes/assembly and continuation enqueueing. Asset transfer includes the named source service's authorization queries and R2 read. Native CPU runs disable quota proxies. Fixture setup, binary seeding, oracle rendering and output-download checks are outside the measured candidate. Provider control polling does not dilute Queue Worker analytics.

| Batch 32 case | Input bytes | Checkpoints | D1 reads | D1 writes | Queue operations | R2 A / B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small | 604 | 8 | 410 | 38 | 24 | 5 / 6 |
| Three-page maximum | 1,048,576 | 51 | 2,424 | 180 | 153 | 46 / 82 |
| Dense, 3,000 components | 520,383 | 116 | 202,954 | 361 | 348 | 113 / 222 |

Provider and local ordinary-case counters agree. Provider quota objects use 128-byte synthetic files; independent local and native runs verify full 5,242,880-byte images and 10,485,760-byte PDFs. Repeated gallery references use eight distinct copied objects across 24 project entries and a case-study image. Their local case needs 70 checkpoints. Transfer byte sizes affect latency/storage, while these single-object R2 operation counts remain unchanged.

A wake under 64 KB costs one write, read and delete. Consumer delivery batching does not discount messages. We count the initial send once, then measured continuation sends. Deletes are not R2 Class A/B charges, but are retained as operations and subrequests. [Queue accounting](https://developers.cloudflare.com/queues/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

The largest observed parent has 34 D1 statements and 36 conservatively combined internal calls, including candidate creation. The source hop has two D1 queries and one R2 read. Core dispatch makes no external HTTP requests. Streaming uses at most two storage bodies at once, with sequential assembly inputs. D1 batches count as one provider query; the instrumentation conservatively counts their statements. Check the separate Free ceilings of 50 D1 queries, 50 external subrequests, 1,000 internal subrequests and six simultaneous pending connections. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Planning workload and reserves

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

## CPU and storage

The [repeat maximum CPU window](evidence/native-repeat-max-cpu.json) has 50 successful Queue observations in SEA, median 27.128 ms, p95 71.704 ms and p99 149.963 ms. It is the second identical maximum candidate after earlier executions, not an average of regional percentiles. The measurement window omits one of its 51 checkpoints. Initial/post-deployment and other-location samples are separate evidence. No `exceededCpu` was observed in the retained windows, but provider burst flexibility does not establish a 10 ms guarantee. Small batch-16 repeats alone reached p95 9.944 ms. Cold isolates are not directly labelled by these analytics. Final `s8-v2`, full production web-module startup, publication-start authorization in isolation and deployed sweeper CPU remain unverified. Do not substitute quota-tail CPU or client latency for missing native evidence.

The [provider inspection](evidence/provider-inspection.json) reports 2,400,256 D1 bytes for this isolated fixture. That is not a capacity test with 100 maximum owners. The historical local canonical/attempt/piece allocation is 426,217,472 bytes. One maximum source adds at least 1,048,455 payload bytes before row/index overhead. One hundred retained sources alone add 104,845,500 bytes and exceed the conservative 500 MB database ceiling alongside that stress baseline. Admission, physical source retention, cleaned-tombstone retention and deleted-owner identifier removal are not bounded yet. Logical expiry does not reclaim pages.

Local maximum inventory retains 9,437,178 HTML/assembly bytes and 26,214,400 copied asset bytes per candidate. As an asset-only forecast, 100 maximum portfolios with 30 MiB private assets and one 25 MiB public version use 5.77 GB; two public versions use 8.39 GB; three use 11.01 GB before HTML, temporary assembly, platform assets or additional gallery images. Sixty uncollected maximum image replacements/day add 9.44 GB in 30 days. Cleanup must preserve current drafts, sealed sources and retained versions while reclaiming replaced assets. This code does not establish that steady state or a general storage fit.

R2 storage scenarios assume retained bytes persist for the billing month. The allowance is 10 GB-month, calculated from average daily peaks; temporary assembly requires that calculation rather than treating 10 GB as an instantaneous service cap.
