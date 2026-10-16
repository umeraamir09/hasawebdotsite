# Phase 11A results

Measured October 16, 2026. The thin owner API is implemented and tested. Full-body 1 MiB validation and saving fail the strict below-10-ms CPU target. A save invocation returned 503 with a provider-confirmed `exceededCpu` outcome. Phase 11A remains unchecked pending owner agreement to a compatible revision and explicit completion approval.

The [bounded-save revision](revision.md) is proposed for agreement. Its implementation and CPU/quotas remain unproven. Do not build dependent APIs on the failed full-body save path, reduce the 1 MiB ceiling, or assume a paid plan.

## Implementation

- `packages/auth` shares the unchanged proven Better Auth configuration between web and jobs. A WeakMap caches configuration by binding environment. Identities and owner repositories remain request scoped. Session cookie caching is disabled for owner access; persisted expiry, revocation and deletion checks remain active.
- The custom web Worker forwards `/api/owner` and its child paths before OpenNext request conversion or body parsing. It checks the original URL authority and passes the original cookie/body stream over the `OWNER_API` service binding. Other requests use the generated OpenNext handler.
- The named jobs `OwnerApi` entry runs Hono with exact authority, mutation Origin, JSON type and method checks. Its default HTTP entry exposes no owner API. Rejected bodies are drained without retaining chunks before returning across the service binding; the local failure tests caught a forwarding-lifetime error when the handler returned before the stream finished.
- The experiment imports the actual web adapter/OpenNext bundle and the same jobs router, authentication and repositories. Its separate entry adds real draft validation and one atomic D1 update of draft content, separate private progress and revision. The update repeats the active-session/deletion condition and prevents resetting the fixture editor milestone. It cannot overwrite another owner or a stale revision.
- The experiment table and save routes are absent from product entries and migrations. The permanent onboarding schema and product saves remain Phases 11B and 13. No appearance defaults, portfolio provisioning or Figma/UI changes belong to this work.

## Deployed startup and CPU

The temporary `hasaweb-owner-runtime-web` and `hasaweb-owner-runtime-jobs` Workers used an isolated `hasaweb-owner-runtime-spike` D1 database and workers.dev hostnames, without zone routes. Authentication retained the actual production-apex rules; only the separately built, keyed experiment gateway translated its external authority to that apex. Synthetic signed sessions used the real product user/session schema and Better Auth HMAC verification. OAuth was not part of the workload.

[Deployment logs](deploy-web.txt) report web startup at **49 ms**; [jobs deployment logs](deploy-jobs.txt) report **98 ms**. Both are below 1,000 ms. Secret installation created the measured Worker versions `a79ee5a3-54b6-46c8-8edc-f7629e29c83a` and `a2594e2d-cf08-4724-9106-1cf50677e165`. The upload/startup logs precede that configuration-only version change. The code is unchanged.

Ten warmups preceded each intended 100-request distribution. The small draft is 11,203 UTF-8 bytes. The large draft is exactly 1,048,576 UTF-8 bytes, contains every MVP component type and 192 additional text sections, and has a separate bounded revision/progress envelope. Full-size draft JSON passes validation and can be saved; CPU, rather than storage capacity, rejects the assumed runtime. The owner-read workload uses real repository access with no product portfolio provisioned.

| Workload | Measured client responses | Jobs CPU p50 / p95 ms | Web CPU p50 / p95 ms | Provider jobs / web requests |
| --- | --- | --- | --- | --- |
| Owner read | 100 × 200 | 3.883 / 5.883 | 0.630 / 0.989 | 104 / 95 |
| Validate 1 MiB | 100 × 200 | 22.430 / 44.337 | 0.631 / 0.847 | 96 / 106 |
| Save 11,203 bytes | 100 × 200 | 4.860 / 6.867 | 0.649 / 0.933 | 103 / 98 |
| Save 1 MiB, incomplete | 40 × 200, then 503 | 34.192 / 59.874 | 0.687 / 0.866 | 38 / 39 |
| Signed-out read, separate recovery | 100 × 401 | 0.495 / 1.677 | 0.578 / 0.738 | 19 / 42 |

The save distribution stopped at measured request 41 after ten successful warmups. The retained jobs trace confirms `exceededCpu`, with 11 ms CPU at termination. It is a failed 41-response distribution, not a completed 100-sample result. Provider window quantiles above describe the requests retained in adaptive analytics, which omitted the failure from that window; they are not a failure-inclusive exact percentile. This limitation does not turn the failed budget into a pass.

The first captured authenticated jobs candidate used 29 ms CPU and 758 ms provider wall time; a later run's candidate used 6 ms and 729 ms. Neither is guaranteed isolate-cold. Startup measures global evaluation, while lazy auth initialization belongs to request CPU. Cold candidates do not establish a below-10-ms cold-request guarantee.

Initial tail collectors retained 290 events per Worker across preflight and the main run, with one jobs CPU-limit outcome. The first recovery attempt also hit CPU while generating the large fixture, outside the benchmark workload; its report and trace are retained separately. Successful recovery uses a 230-byte minimal fixture and skips large fixture generation, full-size validation and boundary tests. It completes the remaining 100 signed-out samples and persisted revocation/deletion checks without repeating the failed large distribution. Its tail collectors retained 26 jobs and 27 web events across both recovery attempts, including the fixture failure.

[Main requests](deployed-requests.json), [successful recovery](deployed-recovery.json), [preflight harness failure](preflight-results.json), [initial recovery failure](deployed-recovery-initial.json), [jobs analytics](analytics-jobs.json), [web analytics](analytics-web.json), [recovery jobs analytics](recovery-analytics-jobs.json), [recovery web analytics](recovery-analytics-web.json), [jobs tail](tail-jobs.json), [web tail](tail-web.json), [recovery jobs tail](recovery-tail-jobs.json), [recovery web tail](recovery-tail-web.json) and [machine-readable summary](summary.json) preserve the samples, versions, windows, counts and outcomes.

Cloudflare adaptive quantiles are provider measurements converted from microseconds, not client elapsed timing. Average sample intervals range from 1 to about 2.8. Transport, clock offsets, window boundaries, ingestion and sampling change request counts. Tail retention is incomplete. Assess both Workers; quantiles cannot be added to obtain the actual combined per-request percentile. The jobs failure alone rejects the full-body path under either accounting interpretation.

The current OAuth credential cannot read account subscriptions, returning 403 in [the plan-access check](plan-access.json). This experiment retains the previously confirmed account configuration and strict Free-tier target. It makes no billing changes or claim of a newly verified subscription.

## Correctness and regression evidence

[The local report](local-results.json) passes all 12 workerd/D1 assertion groups, including real signed sessions; missing, tampered, expired and revoked sessions; deleting owners; exact Origin/type/method checks; malformed, unsafe and unknown content; UTF-8 and transport boundaries; atomic content/progress writes; stale and concurrent saves; interleaved owners; permanent milestone protection; revocation between validation and mutation; and a real D1 write failure returning private 503. Another owner's row remains unchanged. Local warm distributions contain 100 samples per case and are client elapsed measurements, not provider CPU.

The main deployment passes nine groups before its performance failure. Successful small-payload recovery passes nine groups, including the outstanding persisted revocation/deletion and between-validation-and-write checks. The earlier main run supplies full-size validation/boundary evidence. Synthetic fixtures never contain real owner content or provider tokens.

| Check | Result |
| --- | --- |
| `pnpm check` | Biome, all 12 package typechecks and all 145 unit tests pass |
| `pnpm build` | All 12 packages pass, including OpenNext and jobs/site dry-run bundles |
| `pnpm test:owner-runtime` | All 12 local workerd/D1 groups pass, including 100 full-size saves |
| `pnpm test:auth:browser` | All 21 auth groups and nine Chromium journey checks pass; the built web adapter also reaches the named owner binding |
| `pnpm test:persistence` | All 31 persistence/access groups, migrations and restart checks pass |
| `pnpm test:runtime` | Three Workers, D1, R2, services, Queue, Workflow and restart persistence pass |
| Deployed full-body CPU | Fails; 1 MiB validation/save exceed target and saving hits `exceededCpu` |

The pinned runtime includes Node 22.22.1, pnpm 12.11.2, Wrangler 4.151.0, compatibility date 2026-10-14, Better Auth 1.7.7, Drizzle 0.45.4, Hono 4.13.13, Zod 4.6.7 and OpenNext 1.20.11. See [the protocol](protocol.md) for reproduction. The auth/browser harness now starts jobs with matching fixture bindings and secrets, because the built web Worker routes owner requests through the named entry.

## Cleanup and decision

The harness deleted synthetic owners and sessions after each run. [Cleanup output](cleanup.txt) confirms deletion of both temporary Workers and the isolated D1 database. [Verification](cleanup-verification.json) confirms the experiment database is absent and the account returns to its previous two databases. Local experiment secrets were removed. Existing product data, production routes, other experiment resources and billing configuration were untouched.

Implementation and measurement are complete. The required feasibility outcome is a failure for full-body saves. The [revision proposal](revision.md) specifies immutable revision-scoped staging, bounded server validation across piece boundaries, preserved large fields, and one atomic canonical content/progress commit with fresh session/revision checks. It requires a new measurement of every continuation/commit path and the extra request/D1 quotas. Owner agreement is pending, so this document does not complete Phase 11A under its alternative criterion.

## Implemented follow-up

On October 16, 2026 the owner explicitly requested implementation/testing of the bounded approach with reversible Git changes, then approved 2,048-byte URL and 254-byte email limits. The [implemented protocol](../2026-10-16-free-owner-saves/protocol.md), [measurements](../2026-10-16-free-owner-saves/results.md) and [quota model](../2026-10-16-free-owner-saves/quotas.md) supersede the implementation-pending status above. The original failed measurements remain historical evidence. Agreement to implementation and field limits does not approve a phase checkbox; completion still requires the owner's post-implementation answer.
