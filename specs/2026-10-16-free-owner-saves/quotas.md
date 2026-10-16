# Free-tier quota model

The published limits checked October 16, 2026 are 100,000 Worker requests/day, 5 million D1 row reads/day, 100,000 D1 row writes/day and 500 MB per D1 database. D1 permits 50 queries per Free Worker invocation. Database/network wait is elapsed time, not Worker CPU. Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

These are capacity estimates based on measured repository operations. They do not prove the entire application's Free-tier feasibility. The publication/Queue fallback still requires its separate roadmap validation. Count both web and jobs invocations conservatively in request projections, even though Standard service-binding billing can avoid an extra request fee. No caching of owner identity or private responses is assumed.

## Per-operation measurements

The local integration Worker wraps the D1 binding for each request and records `meta.rows_read`, `rows_written` and query count. It measures the reusable save repository, excluding the preceding Better Auth checks and keyed fixture preparation. The wrapper is disabled for deployed CPU measurements. D1's local query engine reports virtual JSON-table scans as reads. Counts depend on document structure, indexes and SQLite/provider versions; production must observe actual deployed counters.

| Operation/fixture | Repository rows read | Rows written | Queries |
| --- | ---: | ---: | ---: |
| Small patch, full 1 MiB eight-type draft | 90 | 1 | 2 |
| Small patch, 34,000 rich-text nodes | 90 | 1 | 2 |
| Small patch, 3,000 text components | 12,029 | 1 | 2 |
| Append 32 text components near the draft ceiling | 217 | 1 | 2 |
| Remove from 3,000 components | 12,023 | 1 | 2 |
| Staged change | 93 | 1 | 3 |
| Begin | 6 | 4 | 1 |
| String start, no previous pieces | 14 | 1 | 4 |
| String piece | 8 | 3 | 3 |
| String finish, 262 retained pieces | 350 | 1 | 2 |
| Commit | 12 | 2 | 3 |
| Abort | 7 | 2 | 2 |
| Cleanup batch | 138 | 32 | 2 |
| Pending/status | 3 | 0 | 1 |
| Resume across sessions | 6 | 1 | 2 |

These observed counts come from [local-results.json](bounded/local-results.json) and [array-operation results](operations/local-results.json). Index writes are included. `string-start` also deletes any previous retained string, so replacing a second large field adds up to 512 deleted pieces. Cleanup's final attempt deletion adds its table/index writes. Initial account/session refresh, failed commands, recovery and retries also consume quotas. The wire protocol caps a string at 512 pieces, so one abandoned attempt cannot accumulate an arbitrary number of tiny piece rows.

## Daily planning cases

The architecture assumes 100 portfolios, 30 editing sessions/day and 100 autosaves/session, with a baseline of about 20,000 Worker requests and 5,000 D1 writes/day. Ordinary changed-field autosaves retain a single canonical row write. At 3,000 saves/day, the representative eight-type fixture adds 270,000 repository reads. Adding the old 50,000-read estimate conservatively gives 320,000 before a reserve for authentication and other work. This replaces the old assumption that saves require almost no reads.

Allow one full maximum-field upload per editing session, then ordinary changed-field autosaves. At the measured 4,000-character packing, a near-1 MiB field uses 262 pieces, four preparation/finalization calls and roughly ten cleanup calls. It adds about 8,300 incoming requests/day for 30 uploads, or 16,600 invocations counting both Workers. About 32,000 extra D1 writes/day includes piece table/index writes and deletion, bringing the modeled total to about 37,000 writes/day.

At the protocol maximum of 512 pieces, allow 540 incoming requests and 2,100 writes per full upload, including bounded cleanup and a few recovery calls. Thirty such uploads add at most 32,400 conservatively counted invocations and about 63,000 writes. Combined with the baseline, this is about 52,400 invocations and 68,000 writes/day. Reserve up to 32 extra authentication/other row reads per incoming save call and additional SQL scans; a 1.5-million-read daily planning allowance remains below five million for the representative component collection. This reserve is a planning allowance, not a measured auth read count or an admission-control guarantee. Repeated retries and replacement of several large fields need their own budget.

The 3,000-component stress fixture costs about 36.1 million reads if every one of the 3,000 daily autosaves scans that collection. That exceeds Free. Allow roughly 370 such saves/day account-wide after reserving 500,000 reads for other work, or reduce the affected-collection SQL scans in a later optimization. Do not interpret a passing CPU percentile as unlimited D1 capacity. Product integration must observe row usage and autosave frequency; full-document restaging on every keystroke is incompatible with these projections.

## Storage

[The local storage check](bounded/storage-capacity.json) creates 100 maximum 1 MiB canonical drafts, 100 maximum staged drafts and 51,200 string pieces totaling 100 MiB of piece payload. Actual SQLite page allocation is **426,217,472 bytes**, about 426.2 MB, including indexes, template tables and existing free pages. This fits the conservative 500,000,000-byte database limit and leaves about 73.8 MB for other data in this synthetic state. It is much larger than a payload-only 300 MiB estimate because small rows consume SQLite pages and indexes.

This checks local allocation only. Remote page management, fragmentation, production metadata and version retention can differ. Observe deployed size, alert before 350 MB and perform bounded garbage collection before continued growth. Expired attempts deny writes immediately but remain physically stored until cleanup; never assume TTL automatically reclaims D1 pages. The one-attempt-per-owner, 512-piece and byte caps bound retained staging until the later cleanup integration. The test removes its synthetic owners after measuring and never writes a remote capacity fixture.

Run `node scripts/bounded-save-capacity.mjs` after a completed local bounded-save test to reproduce storage allocation. It uses local D1 for writes and a read-only SQLite connection for page counters, since the D1 API disallows those PRAGMAs.
