# Phase 08 workflow and withdrawal results

October 27, 2026 supersession: the [owner-approved paid-at-launch policy](../../docs/deployment-policy.md) removes this record's Free-only feasibility requirements as local development blockers. Preserve all original failures, API-limit findings and approvals below. Reuse the integrated S-8 local milestone; verify final paid behavior before launch. S-9 withdrawal/privacy requirements still apply to dependent activation.

Recorded October 15, 2026. This is an architecture feasibility experiment, not the production publish pipeline. The owner approved Phase 08 completion on October 15, 2026, with the recorded fallback requirements. The roadmap checkbox is checked.

## Decision

Reject the unbatched fragment-per-step Workflow design as the Free-plan production implementation. Local storage and retry mechanics work. The deployed three-page stress candidates fail the per-invocation API request limit, and the daily step allowance cannot support the architecture's planning estimate of 30 near-limit publishes. Record Queue plus D1 task state as the fallback to validate before Phase 24. Do not replace each fragment with a separate Queue message without measuring batching and the complete quota budget.

Retain private R2 candidates, deterministic fragment keys, streamed assembly and an atomic D1 compare-and-swap pointer. Require successful origin deletion followed by retryable URL purge and observed missing responses. Cache purge acceptance alone does not prove withdrawal. Correct browser TTL and query cache-key policy before serving withdrawable owner assets in the publishing implementation.

## S-8 local execution

`pnpm spike:workflow` runs actual Workflows in Wrangler/workerd with persisted, isolated D1 and R2. It reuses the S-1 fixtures and compares streamed pages byte-for-byte with independently rendered expected HTML. Large bodies stay in R2; the largest individual durable render result is a small key/size/timing record. Input records contain at most 8,192 serialized bytes and 64 atoms. Up to eight independent render steps run concurrently; Promise.all preserves fragment order. Each assembly step reads at most 32 source objects into a FixedLengthStream and writes one R2 object. No multipart upload is needed, so intermediate objects can be smaller than the multipart minimum.

| Page envelope | Render steps | Assembly steps | HTML bytes | Standalone steps including manifest/commit |
| --- | ---: | ---: | ---: | ---: |
| Portfolio | 133 | 6 | 1,355,551 | 141 |
| Case study | 179 | 7 | 1,150,375 | 188 |
| Resume | 128 | 5 | 1,370,779 | 135 |
| Combined experiment | 440 | 18 | 3,876,705 | 460 |

Each candidate finishes below the 1,024-step per-instance limit. Two three-page candidates compete against the same base pointer; exactly one commits. Both have complete immutable manifests and exact output. A separate candidate fails permanently after an R2 write and leaves the previous pointer untouched. A transient post-write failure retries idempotently. Private source bytes survive public-copy deletion and repeated deletion succeeds. Separate unit tests exercise deletion failure and purge failure/retry ordering.

[evidence.json](evidence.json) retains all 22 passing local checks and durable step outputs. The final local run took 37.712 seconds including fixture uploads and verification. The two full candidates each recorded 440 synchronous render samples, with p95/max values of 2/12 ms and 1/4 ms respectively. The 12 ms elapsed outlier is another reason not to claim a proven 10 ms CPU bound. Local performance.now values measure only synchronous render elapsed time, excluding input parsing and I/O. They are not provider CPU measurements. Local execution does not enforce deployed Free quotas. Step names do not imply an independent CPU invocation. The final schema, nested rich text, Unicode splitting and transactional normalization remain future work; pre-normalized fixture records do not prove those capabilities. Each synthetic page is near 1 MiB, so the combined three-page envelope intentionally exceeds one portfolio's total draft limit.

## S-8 deployed execution

[workflow-live-evidence.json](workflow-live-evidence.json) records the isolated deployed completion experiment. The Worker has no public routes or workers.dev endpoint, and uses only its own synthetic D1/R2 resources named `hasaweb-s8-spike`.

The final near-limit deployed candidates both ended in `errored` with `Too many API requests by single Worker invocation`. They completed 341 and 325 durable steps before failing during resume rendering. D1 still contains the prior `old` version for the race, no complete candidate manifest exists, and no pages were committed. The captured window runs from 08:28:15 UTC to 08:39:02 UTC, about 10 minutes 47 seconds. This is a failed stress experiment, not a successful production publication or a CPU-limit finding.

The planned three-page candidate requires at least 1,354 R2 calls plus its D1 commit, already beyond the documented 1,000 internal-service subrequests per invocation. The exact point of failure also depends on platform bookkeeping and scheduling, so the observed step counts do not establish a new API-call allowance. The input deliberately exceeds the valid total draft envelope; do not infer that every valid 1 MiB candidate must hit this cap. The independent daily-step failure for a single valid-size portfolio still requires the fallback.

[workflow-smoke-evidence.json](workflow-smoke-evidence.json) records a separate reduced completion case using three fragments per page, with the same step implementation, R2 assembly and competing commit. Both small three-page candidates completed all 14 steps. All six shortened page bodies matched expected HTML, and exactly one candidate committed. The three deployed completion checks passed. This separates basic deployed operation from the rejected large experiment. It does not replace the failed stress evidence or prove Free production capacity.

The first sequential experiment observed several seconds of durable storage I/O per fragment. It was intentionally terminated after 41 and 47 successful steps to avoid spending the account's step allowance on a slow schedule. [workflow-sequential-observation.json](workflow-sequential-observation.json) records that observation. It was not a completion or a platform CPU-limit failure. The final schedule runs at most eight independent fragment steps concurrently and retains the original byte/node/fan-in bounds.

[workflow-cpu-observation.json](workflow-cpu-observation.json) records a successful adaptive Workers analytics query during the active deployed run. It returned no invocation rows for this Workflow script, so production CPU evidence is unavailable from that dataset. Provider status and step timing do not prove production CPU headroom. Neither success nor timers rounded to zero authorize larger render batches. No plan upgrade was selected.

## Free capacity and required fallback

Cloudflare lists 3,000 Workflow steps/day, 1,024 steps/Free instance and 100 concurrent instances. The pricing page says CPU is limited per invocation and explicitly says that steps are not invocations. The limits page also describes compute per step. Do not resolve that distinction by assuming every durable step resets CPU. Recheck deployed CPU with the final renderer and dispatcher.

Even the single near-limit portfolio requires 141 steps. Thirty such publishes would require 4,230 steps/day before preparation, asset copying, cleanup, retries or other workflows. The three-page stress experiment needs 13,800 steps/day at that frequency, but that larger figure deliberately overstates the valid draft envelope. Parallel scheduling reduces wall time without reducing step count.

The three-page candidate uses 895 R2 reads, 459 writes including the manifest, and one successful D1 commit write. Initial normalized-input creation adds 440 R2 writes outside the Workflow. A losing commit also reads the pointer. These are counts derived from the executed algorithm, excluding retries, candidate cleanup, platform-internal persistence and future owner asset copies. An assembly step uses at most 33 R2 operations, below the conservative 50-operation bound used by S-1. That per-step bound is insufficient: the deployed runtime accumulates API calls across the invocation. The fallback must bound total calls for each actual invocation, including platform headroom. Workflow results hold references, not page bodies.

The required Queue/D1 fallback must persist the candidate, revision, task cursor, task leases and publication status in D1; make every task replay-safe; retain immutable R2 keys; and commit only after the complete manifest exists. Recover lost triggers and expired leases with the existing sweeper approach. Measure bounded task batching before selecting a batch size. Queues Free provides 10,000 operations/day, and a normal message uses write/read/delete operations. Thirty single-page portfolios at one message per current step would require 12,690 Queue operations before retries and existing contact/GitHub work. That naive replacement also fails. This spike records the required architecture revision; it does not claim the fallback has been implemented or validated.

## S-9 live withdrawal

`pnpm spike:workflow:live` uploads a uniquely named, harmless 1x1 PNG to the already configured S-3 public bucket, warms it, deletes only that object, checks the authenticated R2 origin, purges exactly its public URL, and observes public GET/HEAD responses. The owner supplied a zone-scoped purge token in the ignored local env file. Evidence never includes the token.

[live-evidence.json](live-evidence.json) contains eight passing live checks. Local LHE and remote ORD requests warmed CDN HITs. After origin deletion, R2 returned 404 while LHE continued serving a cached 200. The purge API accepted the URL, but the first subsequent LHE GET still returned 200. A later LHE GET returned 404 approximately 2.6 seconds after purge was requested. HEAD returned 404, and a fresh remote browser GET through SIN returned 404 approximately 8.1 seconds after the request. A previously uncached query variant also returned 404. These timestamps include network and observation scheduling time, not exact propagation latency.

Browser Run's own default five-second API response cache is disabled with cacheTTL=0. Its remote location can change between calls: ORD warmed the object, while SIN observed the missing response. The experiment does not prove that the exact warmed ORD cache was rechecked, nor does it establish a worldwide withdrawal deadline. [live-purge-propagation.json](live-purge-propagation.json) preserves an earlier immediate post-purge GET failure rather than concealing it.

## Cache policy requirements before publication

The PNG requested `public, max-age=0, s-maxage=60, must-revalidate`, but the public host returned `max-age=14400`. This experiment did not change the zone's browser TTL or cache rules. Treat the observed four-hour browser lifetime as a launch blocker for withdrawable asset classes. CDN purge cannot erase a visitor's downloaded copy or browser cache. Configure and verify a browser revalidation/no-storage policy that the public host actually honors, and a short bounded edge TTL as the S-9 fallback. Do not claim the requested metadata alone establishes that policy.

A fresh query variant returning 404 does not prove purge coverage for previously warmed variants. Before Phase 26, normalize query cache keys for immutable asset URLs or explicitly bypass query caching for withdrawable classes and verify warmed variants. Keep deletion/purge pending until deletion succeeds and purge verification completes; retain failed work for retry. Preserve private draft assets. Revalidate the same policy for Face Reveal removal, replacement, unpublish and deletion. No DNS, route or zone-cache configuration changes were applied by this experiment.

## Verification and retained resources

- `pnpm check` passes lint, all 11 package/app typechecks and all 16 unit tests.
- `pnpm build` passes all 11 package/app builds, including OpenNext and the site/jobs Worker dry runs.
- `pnpm spike:workflow` passes all 22 local checks and verifies durable execution, exact output, races, failure handling and public-copy deletion.
- `pnpm spike:workflow:live` passes all eight live origin/CDN checks.
- `pnpm spike:workflow:execution:live` records the expected stress rejection. `--reuse-fixtures --small` records basic deployed completion and compares shortened private R2 pages with expected HTML. A stress command returning nonzero must not be reported as a passing test.

Run pnpm with the Linux pnpm directory first in PATH in this WSL session; the Windows shim cannot locate its pinned engine. The ignored env file has mode 600 and remains outside Git. Deployed synthetic Workflow/D1/R2 resources remain for review; no owner content or public route was created. The production pipeline, fallback dispatcher and cache-policy changes are not delivered by this spike.

## Provider references

- [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Workflow pricing and invocation definition](https://developers.cloudflare.com/workflows/reference/pricing/)
- [Queue pricing and operation accounting](https://developers.cloudflare.com/queues/platform/pricing/)
- [Purge by single file](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-single-file/)
- [Browser Run content API and cacheTTL](https://developers.cloudflare.com/api/resources/browser_rendering/subresources/content/methods/create/)
