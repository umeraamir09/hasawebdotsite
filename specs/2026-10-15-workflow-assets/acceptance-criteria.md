# Phase 08 acceptance criteria

- A repeatable command executes actual Cloudflare Workflows against local D1 and R2, with near-limit portfolio, case-study and resume fixtures.
- Ordered streamed output matches independently rendered expected bytes; intermediate R2 objects stay below the 32-source fan-in bound. Step results contain references rather than HTML.
- A fault after an R2 write retries idempotently. A permanently failed candidate leaves the prior pointer intact. Competing candidates have one compare-and-swap winner with complete pages.
- Withdrawal deletes public bytes while retaining private bytes, and a failed purge remains retryable. Repeated withdrawal succeeds.
- Live evidence distinguishes origin absence, warmed CDN hits, purge acceptance and observed post-purge edge responses. Missing privileges or unavailable locations are recorded as unverified.
- Results report step counts, object operations, limits and CPU measurement limitations. Any required Queue/D1 or cache fallback is recorded before publication work.
- Relevant typechecks, lint, tests and build pass. Roadmap completion requires owner approval after reviewing evidence.

## Evidence mapping

| Check | Evidence |
| --- | --- |
| Actual local Workflows, bounded storage, exact output | `evidence.json`, 22 passing checks |
| Retry after side effect, failed candidate, competing pointer commits | `evidence.json`; `withdraw.test.ts` for purge/deletion failure ordering |
| R2 origin absence, warmed CDN HITs, accepted purge, observed missing responses | `live-evidence.json`, eight passing checks; the immediate stale response remains visible |
| Deployed execution and output | `workflow-live-evidence.json` records the API-cap rejection and three passing failure-safety checks; `workflow-smoke-evidence.json` passes three completion checks and compares six shortened pages; sequential I/O observation separately retained |
| Limits, fallback and remaining validations | `results.md`; architecture S-8/S-9 and ADR-5 updates |
| Repository checks | `pnpm check`, `pnpm build`, and local/live spike commands listed in `results.md` |

The spike records a required fallback instead of claiming that the unbatched design meets Free-plan capacity. Production CPU headroom, the batched dispatcher and corrected cache policy remain checks before their dependent roadmap phases. The owner approved checking off Phase 08 on October 15, 2026, with these recorded fallback requirements. The roadmap phase checkbox is checked.
