# S-1 publish rendering results

Recorded October 15, 2026 in local workerd. Reproduce with `pnpm spike:render`. The command only bundles with Wrangler dry-run and starts a local Miniflare runtime. It does not deploy or require Cloudflare credentials.

## Decision

Reject the assumption that one React render per page reliably fits the free-plan 10 ms CPU budget at the 1 MiB draft ceiling. Record bounded fragment rendering and incremental preparation/assembly as the revised approach before publication implementation. No paid-plan change or smaller owner content limit is selected. This closes the spike by recording a revised approach, rather than claiming the original assumption passed.

## Measurements

These are synchronous local elapsed milliseconds, including JSON parsing, React element construction, static serialization, and UTF-8 output encoding. They exclude I/O and can include scheduler pauses and garbage collection. Local timers in this run have roughly 1 ms resolution. Zero means below timer resolution, not zero CPU.

Each shape/mode has one first-use pass, ten warmup passes, fifty timed passes, and a separate fifty-pass CPU profile. The first-use column is the maximum unit time in that pass. Only the very first portfolio render is isolate-cold. Fragment measurements run sequentially in one request to gather enough samples; they are not separate Workflow invocations.

| Shape | Operation | First-use max ms | Warm p50 ms | Warm p95 ms | Warm max ms | Sampled active ms/unit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| portfolio | page | 39 | 12 | 26 | 29 | 12.371 |
| portfolio | fragment | 1 | 0 | 1 | 7 | 0.066 |
| portfolio | prepare | 6 | 7 | 12 | 13 | 8.144 |
| case-study | page | 14 | 15 | 17 | 19 | 16.595 |
| case-study | fragment | 1 | 0 | 1 | 3 | 0.069 |
| case-study | prepare | 24 | 22 | 39 | 40 | 26.603 |
| resume | page | 14 | 10 | 15 | 20 | 12.565 |
| resume | fragment | 2 | 0 | 1 | 2 | 0.105 |
| resume | prepare | 7 | 6 | 12 | 14 | 11.701 |

V8 inspector sampling uses a requested 100 microsecond interval. The estimate sums sample time deltas whose leaf is not `(idle)`, `(program)`, or `(root)`, then divides by measured units. It includes harness and GC work during the profiling window, may miss unattributed native work, and is not an exact per-request CPU measurement or percentile. Small fragment figures are amortized estimates. Profiles support the finding that whole-page work is expensive; they do not prove a production CPU bound.

| Shape | Serialized input bytes | HTML bytes | Top-level nodes | Fragments |
| --- | ---: | ---: | ---: | ---: |
| portfolio | 1048556 | 1355551 | 2280 | 133 |
| case-study | 1048570 | 1150375 | 11435 | 179 |
| resume | 1048216 | 1370779 | 1799 | 128 |

The portfolio includes synthetic profile/face-reveal markup, project/image/link entries, skills, experience, repeated text headings, a dynamic GitHub placeholder, contact controls, social links, and resume navigation. The case study stresses many short text nodes and 200 image references. The resume stresses shared chrome text runs close to the draft ceiling plus a PDF iframe and download/back links; it does not inline PDF bytes or add structured resume editing. The near-limit chrome deliberately overstates normal resume text costs. Fixtures are synthetic workload envelopes, not valid future draft schemas, a visual prototype, or a proof of the Phase 16 renderer. Nested rich text, decorations, final metadata and styles must be measured again once implemented.

## Revised bounded approach

1. Retain markup-only React and static R2 pages. Render at most one fragment of 8,192 serialized bytes and 64 top-level nodes per render invocation as an initial experimental bound. Final contracts also need limits on total descendants, depth, string bytes, and output bytes. The fixture atom format has no nested descendants. Recheck the final renderer before choosing production bounds.
2. Do not parse and partition the entire 1 MiB snapshot inside one publish step. Use resumable input scanning with a byte cursor and bounded parser state. Start with at most 8 KiB input per preparation invocation, and persist progress. Normalized fragment records prepared during revision-aware saving are another option, but they must be transactional with the revision captured for publication. Neither preparation implementation is delivered by this spike.
3. Split oversized text leaves at Unicode-safe boundaries while preserving escaping, marks and wrapper tags. Do not reject valid owner content merely because the spike helper rejects an oversized atom. The final schema/serializer must prove this path.
4. Store fragments privately under the candidate version with deterministic ordering and idempotent keys. Assemble ordered bodies through streaming, not a full HTML string concatenation in a single render invocation. Aggregate at most 32 source objects per assembly invocation to leave headroom under the 50-subrequest budget. For these fixtures, an intermediate aggregation level is necessary before final assembly. R2 stream behavior, CPU accounting, object operation costs, and multipart size restrictions must be tested in S-8.
5. Preserve the existing immutable manifest and atomic pointer switch. Preparation or assembly failure must retain the previous public version. S-8 must verify the increased step count, retries, concurrency and persisted results before this becomes the publish implementation.

The local fragment timings leave much more headroom than whole-page rendering, but the benchmark does not enforce the Cloudflare CPU limit. A prior exploratory run included a 16 ms synchronous fragment outlier. Scheduling and GC can affect these measurements; its cause was not established. Bounded inputs alone do not guarantee every invocation fits the platform limit. If final production measurements still exceed the budget, lower measured bounds or revisit the architecture before publication ships.

## Free-tier capacity follow-up

Cloudflare currently lists 3,000 Workflow steps per day on Free. If each of the 179 case-study fragments uses a separate step, 30 such publications would need 5,370 render steps before preparation and assembly. The fragment bound is experimental, not a confirmed production step size. S-8 must measure safe batching, invocation boundaries, total step counts, storage operations and production CPU before the revised pipeline can be called free-tier feasible at the planned publishing volume.

## Evidence and verification

Raw samples, runtime versions and machine details are in [evidence/results.json](evidence/results.json). The adjacent `.cpuprofile.gz` files retain the sampled profiles. Decompress one and load it in Chrome DevTools to inspect stacks. New runs write to `.wrangler/render-spike/` so archived evidence is not overwritten.

- `pnpm install --offline --frozen-lockfile` passes after lockfile update.
- `pnpm check` passes Biome, all 11 package/app typechecks, and all six tests. Four new spike tests cover the three page shapes and oversize rejection.
- `pnpm --filter @hasaweb/render build` passes.
- `pnpm spike:render` bundles the production React renderer and executes all nine cases in workerd. It verifies matching whole-page and fragment output byte counts. Unit tests additionally verify exact HTML equivalence, ordering, escaping and fixture bounds.

The production renderer, resumable scanner, R2 assembly and Workflow execution remain later-phase work. No deployed production CPU measurements were taken. The owner approved Phase 02 completion on October 15, 2026, under the recorded-revised-approach condition. The roadmap checkbox is checked.

## References

- [Cloudflare CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/) supports local DevTools profiling and explains production timer limitations.
- [Cloudflare performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/) describes local timing behavior.
- [Cloudflare Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/) lists the daily step allowance and CPU limit.
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) defines the plan constraints.
