# Foundation review results

Reviewed October 18, 2026 on `docs/foundation-review`, starting from clean `main` at `43e6b62`. The review compares planning documents with runtime entries, production owner routes, schema/repository code, migrations, package exports, CI and retained phase evidence. It is a focused documentation and implementation-boundary review, not an exhaustive application security audit.

## Current status

The roadmap records Phases 01–13, including 11A–11E, as complete. Inspected implementations and the fresh checks below support the existing authentication, private provisioning, bounded draft/progress, recovery and persistence contracts. Phase 14 is next. The current `/editor` remains an account welcome shell. Shared renderer/editor, uploads, guided onboarding, product publication, production GitHub/OAuth/refresh endpoints and contact integration remain pending.

## Findings and corrections

| Finding | Why it could mislead later work | Correction |
| --- | --- | --- |
| Architecture prescribed `PUT /api/draft`, whole-document validation and conflicts returning newer documents. | Phase 14 could implement a nonexistent route and restore a rejected CPU-heavy save path. | Replaced it with Phase 13's bounded action API, streamed reads, code-only conflicts, separate reconciliation, persisted contexts and explicit recovery/receipt rules. |
| Publication still prescribed Workflows and one render step per page after S-1/S-8 rejected them. | A completed spike checkbox could be mistaken for a working production dispatcher. | Updated topology, Worker responsibilities, publish/render/lifecycle guidance and Phase 24 prerequisites to require measured Queue/D1 batching, bounded preparation and shared operation budgets. |
| Generic failure wording claimed the old pointer survives every failure, including cleanup after commit. | A post-commit cleanup retry could be handled as a failed atomic publication or an unsafe rollback. | Distinguished pre-commit failure from retryable post-commit cleanup and pending withdrawal verification. |
| Onboarding described version 1-only storage, no provisioning, an empty GitHub package and an unverified public credential. | Agents could repeat completed foundation work or reintroduce `privateCounts` semantics. | Refreshed the baseline through Phase 13 and linked existing setup/provisioning/GitHub contracts and later integration phases. |
| Old quota headroom and single-write autosave claims conflicted with staged saves and streaming. | Autosave/read frequency and publication could be budgeted from superseded estimates. | Added current handler/capacity references, dense-document/staging/storage limits and scheduled cleanup follow-up. |
| Local setup, package examples and CI descriptions mixed target capabilities with current ones. | Agents could omit jobs auth configuration, decode full drafts in hot routes, expect a seeded public example, or rely on unimplemented Playwright/axe/deployment checks. | Corrected README, auth setup, database/schema examples, local/CI descriptions and pending boundaries. |
| Draft assets are bound only to web while planned jobs promotion assumed source access. | Publication/lifecycle implementation could assume a nonexistent binding or bypass the private asset boundary. | Recorded the unresolved authorized transfer boundary in architecture, Phase 24 and the implementation-status dependency table. No binding/access policy was changed. |
| Product/acceptance upload wording still used ambiguous MB units. | Future handlers might choose decimal byte caps instead of confirmed MiB limits. | Made the already-confirmed exact 5 MiB/10 MiB byte values consistent. |
| No short entry point collected implementation decisions and superseded approaches. | Future work required reconstructing changes across historical specs. | Added `docs/implementation-status.md`, linked it from README/AGENTS/roadmap and documented evidence-directory overrides. |

Existing roadmap checkbox lines and historical evidence remain unchanged. The Phase 05 narrative's contradictory "approval pending" wording was removed while preserving its checked status and distinguishing fixture, later local-provider and pending deployment evidence. No new approval date was invented.

## Verification

- `pnpm check` passes Biome, all 12 package typechecks and all 224 tests in 22 files. Typecheck tasks reused valid Turbo cache entries.
- `pnpm build` passes all 12 tasks, including Next/OpenNext and Worker dry runs. Five tasks reused cache; the web build ran again.
- `DRAFT_API_EVIDENCE=specs/2026-10-18-foundation-review/draft-api pnpm test:draft-api` passes all 15 production API groups through the built web adapter and real named jobs router. Checks include access, missing portfolios, revisions/races, staged retries/transfer, large text, legacy validation/correction, permanent handoff, revocation/failures, publication isolation and restart persistence. See [complete group outcomes](draft-api/checks.json). The full synthetic response samples remain locally under ignored `.wrangler/foundation-review/draft-api/local-results.json`.
- Final `pnpm lint` passes for 352 files. All 183 local documentation targets/fragments resolve across the 22 reviewed documents, including the follow-up agent-rule link. `git diff --check` passes, every roadmap checkbox line matches the baseline, and all tracked changes are Markdown. The only additional non-Markdown artifact is this review's new JSON verification receipt.

Commands used the Linux runner `npm exec --yes --package=pnpm@12.11.2 -- pnpm ...` because the default WSL pnpm path resolves to a Windows shim. Integration output was isolated from Phase 13 results; only a compact group-outcome receipt is included in this documentation change.

## Remaining requirements

Phase 14 can use the implemented production protocol. Before publication, validate final preparation/render/dispatch batching and shared quotas, specify authorized private-asset transfer, and verify the actual browser/query/edge withdrawal policy. The S-9 four-hour browser-cache observation remains unresolved. Production callback/TLS, complete browser/accessibility checks, operational cleanup/alerts and the real signup-to-publication journey remain scheduled work.

No application code, UI, Figma file, production configuration or external service changed. No live provider experiments or limit revalidation ran; provider performance/limits in these documents retain their original dates and limitations. No implementation phase was added or checked off by this review.

## Documentation impact

The review replaced stale foundation assumptions with the implemented Phase 13 contract and carried the resulting requirements into Phases 14, 15, 24 and 51. The findings table records the affected documents and remaining publication prerequisites. Historical evidence and phase checkbox lines remain intact.

The owner's follow-up adds a required documentation impact check to `AGENTS.md` and the roadmap's phase workflow. Every implementation or decision change must search for superseded guidance, correct affected current documents, update dependent future phases and record the outcome before completion review or PR creation. Older specs that could mislead readers need dated supersession links. Unaffected documents do not require edits, but the phase results must explain the check. This requirement applies to future work across the roadmap without changing its order, scope or approval rules.
