# Deployed S-2 protocol

This is the reproduction procedure. Recorded runs and their limitations are in results.md; the procedure alone is not evidence.

## Safe setup

Use the existing account's Free plan. Read account subscriptions before provisioning. Do not enable Paid, enable a service requiring billing authorization, or change public domain routes without approval. A Worker with only a workers.dev hostname can collect S-2 CPU before the zone is ready. This is a production platform experiment in the same account, not an extra product environment.

Create an isolated D1 database for synthetic S-2 records. Bind DB to that database. Build apps/web with the pinned OpenNext toolchain. Prepare a generated, ignored Wrangler config with the compiled worker, static asset directory, nodejs_compat, compatibility_date 2026-10-14, WORKER_SELF_REFERENCE service binding, and Workers Logs enabled. Set SPIKE_ENABLED=true and SPIKE_ORIGIN to the deployed HTTPS origin. Set SPIKE_KEY and BETTER_AUTH_SECRET with Wrangler secrets. Leave all other resource bindings absent. Do not deploy the local config's fake database ID.

Apply apps/web/spike/fixture.sql to the isolated remote database only after inspecting its ID. Seed synthetic users, sessions and owner rows using fresh random tokens and millisecond timestamps, as the local harness does. Do not commit generated SQL, tokens, signed cookies, auth secrets or logs containing request headers. No OAuth provider credentials are required for this session-validation experiment. Phase 05 still owns provider sign-in and account-linking verification.

## Required measurement

1. Retain the deploy/version identifier, date, region/colo, plan, compatibility settings and startup_time_ms printed by Wrangler. Startup passes only below 1,000 ms. A local process-ready duration cannot replace this value.
2. Use the local harness's six cases and fixture sizes. Send a real signed session_token cookie for the D1 cases. Obtain session_data from Better Auth's first successful response and include it for cache cases. Include the separate owner deletion query in every authenticated case.
3. Use at least 100 requests per case after ten warmups and collect cold candidates after a new version and after idle. A deployment or idle period does not guarantee an isolate-cold request. Report that limitation. Store request ID, case, status, time, Worker version and Cloudflare CPU milliseconds without auth headers or cookies. Record total failures and exceededCpu/exceededResources outcomes.
4. Capture Cloudflare Workers Logs invocation CPU fields or an account analytics export with p95 CPU by controlled case/time window. Tail output without CPU fields is insufficient. Export the measurement schema and sampling rate. If only aggregates are available, keep each workload in its own nonoverlapping window and record background traffic and sampling. Never infer CPU from response elapsed time or Server-Timing.
5. Compare p95 CPU with the strict below-10-ms target. Retain cold observations separately. If small auth/write paths fail, test moving hot endpoints to the thin jobs Worker through a service binding, using the same real Better Auth/D1 path. A thin endpoint remains subject to the same CPU limit. If only large payloads fail, measure bounded request/preparation alternatives without silently lowering the agreed content ceiling. Upgrade to Paid requires owner approval.
6. Repeat signed-out, tampered/expired session, deleting owner including cache, wrong/missing Origin, wrong content type, invalid JSON, exact-limit/over-limit payload, other-owner ID and D1 failure checks on the deployment. Disable SPIKE_ENABLED and remove synthetic resources after preserving evidence. Do not leave an operator write probe open.

## Official sources checked October 15, 2026

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) defines the 10 ms Free CPU budget, one-second global startup limit and deployed startup_time_ms output.
- [Workers analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) distinguishes CPU, wall time, sampling and invocation outcomes.
- [CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/) describes local sampling. An amortized profile is not a CPU percentile.
- [Better Auth sessions](https://better-auth.com/docs/concepts/session-management) documents cookie caching and its delayed revocation semantics.
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) documents SQLite schema mapping. The installed 1.7.7 adapter validates all four core tables even when the spike only reads sessions.
