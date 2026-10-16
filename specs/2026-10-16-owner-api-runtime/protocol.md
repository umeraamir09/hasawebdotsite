# Measurement protocol

Build with `pnpm build` before starting the benchmark. The web experiment imports the actual custom web Worker and its generated OpenNext bundle. Run `pnpm test:owner-runtime` for an isolated local workerd/D1 run. Do not rebuild OpenNext while that run is starting. The report includes all assertion groups and raw client samples. It does not measure provider CPU.

For deployment, create only `hasaweb-owner-runtime-spike` with Wrangler D1, then run `node scripts/owner-runtime-deploy.mjs prepare` followed by `node scripts/owner-runtime-deploy.mjs deploy`. Both Workers are temporary workers.dev experiments without zone routes. The generated ignored configuration fixes the account and experiment names; the deployment driver rejects routes. Keep the current account plan and never enable billing. The scripts generate random experiment/signing secrets, seed real product user/session tables, and use no real provider credentials or customer data.

Start two sanitized tail collectors with `node scripts/deployed-runtime-tail.mjs <evidence-path> <worker-name>` for `hasaweb-owner-runtime-web` and `hasaweb-owner-runtime-jobs`. Run `node scripts/owner-runtime-benchmark.mjs --remote`. The gateway validates its external authority and experiment key before translating the experiment origin to the unchanged production auth apex. That translation exists only in the separately built experiment entry. An actual deployment to the apex is outside this phase.

The benchmark uses real signed Better Auth session cookies, disables the identity cookie cache as production does, and independently checks persisted sessions and owner deletion. The synthetic table stores validated draft content and separate private progress in one revision-conditional D1 update with an active-session predicate. It is not a product migration or a published draft API. The large fixture has every MVP component type, 192 additional text sections, and exactly 1,048,576 UTF-8 bytes of draft JSON. Envelope overhead is additional and bounded at 4,096 bytes. JSON, validator and D1 serialization costs belong to the measured jobs invocation.

Retain the first authenticated request separately. It follows deployment but is not guaranteed isolate-cold. Run ten warmups and 100 sequential requests for each workload: owner read, 1 MiB validation, 11,203-byte save, 1 MiB save, and signed-out read. Save responses return only the revision, never the large draft. The owner read also queries the product portfolio repository; the experiment creates no product portfolio.

Tail collectors retain only timing, outcome, URL case, status, script and version. Stop each with SIGTERM to flush the report. Compare retained events with client counts; tail is not an unsampled percentile. Query `scripts/cloudflare-analytics.py` separately for each Worker against the retained request windows. It stores provider adaptive CPU quantiles in microseconds, sample intervals and counts. Report CPU in milliseconds and keep CPU distinct from client elapsed time. Binding CPU must be assessed in both Workers; do not assume splitting requests grants extra CPU budget.

If a large workload fails, retain its incomplete report. Run `node scripts/owner-runtime-benchmark.mjs --remote --recovery` to collect the remaining signed-out distribution and repeat small-payload correctness/revocation checks without repeating large validation, fixture generation or the 1 MiB boundary checks. Recovery uses a separate minimal synthetic draft; the original report retains the full-size checks. Recovery writes a separate report and does not turn the failed large-save run into a pass.

Finish with `node scripts/owner-runtime-deploy.mjs cleanup`. This removes both experiment Workers and the isolated D1 database. The benchmark removes its synthetic owners and sessions even on failure. The retained secrets/configuration are ignored; raw cookies, request bodies, provider tokens and signing keys must never enter evidence.

Official references checked October 16, 2026:

- [Cloudflare Worker limits](https://developers.cloudflare.com/workers/platform/limits/)
- [HTTP service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)
- [Named Worker entrypoints](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [OpenNext custom Worker](https://opennext.js.org/cloudflare/howtos/custom-worker)
- [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
