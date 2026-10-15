# S-2 runtime results

Measured October 15, 2026. The original OpenNext hot-API assumption fails the below-10-ms request CPU target. Deployed startup passes at 25 ms. Keep Phase 03 unchecked until the owner reviews the revised runtime decision and approves completion under its alternative criterion. The replacement runtime has not been proven Free-tier feasible.

## Decision before dependent features

Keep Next.js/OpenNext for the static marketing response, client editor shell, and provider-facing authentication integration. Move hot owner API handlers, starting with draft save and publish trigger, to a thin Hono entry in jobs through an internal service binding. Reuse the Better Auth configuration per isolate and binding configuration rather than rebuilding it per request; never cache a request's session identity in shared state. Continue real Better Auth validation, exact apex Origin checks, host-only cookies, a separate deletion-state read, owner-scoped writes and revision checks.

The proposed thin path must avoid OpenNext's request conversion and duplicate large-body preparation. Retest the same small and 1 MiB workloads, cold conditions and failures on Cloudflare before Phase 13 or a publication endpoint depends on it. A thin Worker is still subject to the CPU budget. If it fails, measure bounded revision-scoped ingestion/preparation while preserving atomic saving and the 1 MiB content ceiling, or obtain approval to revisit the architecture. Do not silently lower the content ceiling, select Paid, or treat this decision as a proven replacement.

The Phase 02 whole-page rejection remains unchanged. Neither these session measurements nor the runtime decision proves incremental rendering, R2 assembly, Workflow capacity or end-to-end Free-tier feasibility.

## Production measurement

The isolated `hasaweb-s2-spike` Worker uses the compiled OpenNext skeleton, Better Auth 1.7.7, Drizzle 0.45.4, real D1 session/user records and a synthetic owner row. Better Auth initializes per request. Every authenticated request also checks deletion state. The write binds the authenticated user's ID and updates one synthetic row. A supplied ownerId is ignored. No provider sign-in is mocked or claimed; OAuth remains Phase 05.

Wrangler 4.151.0 reported 25 ms global startup for version `e84b4438-7003-4187-a3b5-3b0f26d9419e`, with a 5,825.28 KiB uncompressed upload. This is the provider's startup measurement, not process launch or first-request elapsed time. Compatibility date is 2026-10-14 with nodejs_compat. The owner confirmed the Free-tier budget. The account reports the standard usage model, which alone is not proof of a particular subscription. No subscription was changed.

Each completed case used ten warmups and 100 sequential measured HTTPS requests from this environment to KHI. The cached cookie was issued by Better Auth, signed and host-only. Cached session validation still performs the separate deletion query. Synthetic tokens were random, kept outside source/evidence and removed from D1 after the run.

| Workload | Request body bytes | Client elapsed p50 / p95 ms | Cloudflare window CPU p50 / p95 ms | Analytics request count |
| --- | ---: | ---: | ---: | ---: |
| D1 session | 0 | 382.034 / 784.815 | 10.651 / 18.461 | 98 |
| Cached session | 0 | 144.690 / 166.356 | 8.222 / 13.717 | 98 |
| Small write, D1 session | 1,011 | 518.584 / 694.079 | 11.197 / 16.519 | 94 |
| Small write, cached session | 1,011 | 280.097 / 302.197 | 8.596 / 14.855 | 101 |
| Exact-limit write, cached session | 1,048,576 | See raw partial samples | 22.082 / 68.734 | 74 |

The large write completed 75 measured requests before the 76th returned 503. It did not complete its 100-sample target. The initial sequence then stopped; signed-out distributions and production failure checks were run separately. One global analytics outcome was exceededResources. That is not a confirmed attribution of the 503's root cause. A separate direct D1 REST update accepted the exact 1 MiB bound value, so the observation does not justify declaring D1 incapable of storing a 1 MiB draft.

Cloudflare GraphQL workersInvocationsAdaptive supplies CPU quantiles in microseconds. The table converts to milliseconds. Windows use client sample start/end times, so transport delay, bucket boundaries, ingestion lag and adaptive sampling can omit/include boundary requests. These are provider window quantiles, not an exact unsampled percentile over the 100 client responses. The retained query and counts make that limitation explicit. All observed authenticated p95 window estimates exceed 10 ms, so they reject the assumed budget rather than prove a pass.

A sanitized real-time tail independently captured CPU in integer milliseconds. It retained 210 events out of the initial 527 client requests. Warm observed p95 values were 15, 16, 16 and 16 ms for the four completed cases, with only 38, 15, 54 and 29 retained events respectively. Tail sampling/loss prevents a complete per-request percentile. Do not equate its cpuTime field with client elapsed time or mix it with local profiles.

The first deployed candidate used 275 ms CPU and 797 ms provider wall time. It followed deployment but is not guaranteed isolate-cold. Startup only measures global evaluation; lazy imports and first-handler initialization belong to request CPU. Warm and cold observations do not support the request budget even though global startup passes. Responses generally succeeded above 10 ms; the platform's rollover allowance does not change our architecture's stricter p95 requirement.

## Local measurement

Reproduce with `pnpm --filter @hasaweb/web build` then `pnpm spike:runtime`. Use the Linux pnpm shim on this machine by prefixing `PATH=/home/umer/.local/share/pnpm/bin:$PATH`; the default shell initially resolved a broken Windows pnpm shim. CI uses its pinned pnpm installation normally.

Three fresh Wrangler/workerd processes used persisted, isolated local D1. Their first session request took 2,109.274, 2,087.140 and 2,059.892 ms elapsed. Local process-ready times were 2,248.905, 2,253.986 and 2,237.359 ms. Neither series measures Cloudflare global startup CPU.

Ten warmups preceded 100 unprofiled HTTP samples per case. Separate 50-request V8 profiles requested a 100-microsecond sampling interval. Active estimates sum leaf deltas excluding idle/program/root and divide by 50. They include framework/GC/runtime work, can miss native attribution and are amortized means, not p95 or billed CPU. Inspector connections use an explicit localhost Origin required by this Wrangler version.

| Workload | Local elapsed p50 / p95 ms | Sampled active ms/request |
| --- | ---: | ---: |
| D1 session | 25.471 / 33.164 | 18.008 |
| Cached session | 18.784 / 31.435 | 12.925 |
| Small write, D1 session | 28.167 / 36.853 | 24.638 |
| Small write, cached session | 19.092 / 23.598 | 17.398 |
| Exact-limit write, cached session | 30.005 / 40.821 | 23.891 |
| Signed out | 10.712 / 13.807 | 9.428 |

Raw samples, actual runtime versions, machine details and gzipped profiles are in evidence/local-results.json and adjacent files. Local correctness checks prove signed-out/tampered/expired sessions fail, deleting owners fail, missing/wrong Origin and wrong content type fail, invalid JSON and oversized bodies fail, failures do not increment writes, another owner's row stays unchanged, cached sessions continue after synthetic session-row removal, deletion blocks that same cache, and forced D1 failure returns 503. The cache proof also demonstrates Better Auth's delayed session revocation semantics; Phase 05 must decide sensitive-operation revalidation and test sign-out behavior.

## Reproduction and evidence

The deployment protocol is in deployed-protocol.md. Remote execution requires an explicit ignored config and secrets file. `node scripts/deployed-runtime-benchmark.mjs CONFIG SECRETS` runs only against the isolated named D1 database and workers.dev origin; it rejects domain routes. `--checks-only` runs signed-out and failure checks separately after a workload failure. No remote command is part of CI.

Run `node scripts/deployed-runtime-tail.mjs` before the remote benchmark. Stop it with SIGINT after ingestion. It discards raw headers, cookies and console output, retaining only timing, outcome, URL, status and version. `node scripts/summarize-runtime-evidence.mjs .wrangler/s2-production` summarizes tail data. `python3 scripts/cloudflare-analytics.py --account ACCOUNT --worker hasaweb-s2-spike --requests REQUESTS --output OUTPUT` queries controlled windows using configured OAuth or an environment token without printing credentials. The telemetry REST API returned 403 with this OAuth grant; GraphQL and real-time tail worked.

Evidence includes the deployed client samples, sanitized tail, aggregate/window analytics queries, deploy output and local profiles. The original run's failure is preserved. Production fixture removal and probe disablement must be recorded after all measurements. The experiment does not add product authentication, draft saves, publishing or owner UI.

## Final checks and cleanup

The first separate production checks attempt also returned 503 on its first session request. That failed attempt is retained in evidence/deployed-checks-initial.json. After a fresh deployment with safe dependency error categories, the checks completed with no assertion failures. Evidence/deployed-checks.json contains 129 client responses, including 100 signed-out measurements and the signed-in ownership/failure/cache checks described above. The rerun does not erase the initial availability failures or establish the failed runtime's CPU feasibility. Evidence/deploy-checks.txt identifies its version and startup separately from the main benchmark.

After fixture removal, SPIKE_ENABLED was set to false and the Worker redeployed. The deployment remains available for the independent static-asset accounting experiment and, after approval, the apex skeleton. The probe is disabled. Synthetic tokens were deleted from D1. The isolated database is retained empty of session/user data until experiment cleanup. No unrelated account database or bucket was modified.

`pnpm check`, the full workspace build, the local real-auth benchmark, offline frozen installation and the three-Worker runtime smoke test pass. CI now runs the local real-auth experiment, with no remote command or performance assertion. The spike endpoint is disabled in ordinary configs, and the smoke test checks that guard. Subsequent hostname checks are recorded under Phase 04. Owner approval is still required before the Phase 03 checkbox changes.
