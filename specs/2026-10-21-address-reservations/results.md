# Phase 22 address reservations

## Scope and acceptance

Implement the October 21 reservation contract in [the roadmap](../../docs/roadmap.md). Prerequisites 11B, 13 through 15, and 17 are approved and integrated at `89acb72831bf8c05b22b39cdf350245dfdf87a5b`. Worktree `/home/umer/.codex/worktrees/phase22-address-reservations/hasawebdotsite` uses `feat/22-address-reservations`.

This delegate owns reservation schema/migration 0006, repository, bounded draft guards, HTTP actions, shared draft controller, reusable Address control, and existing persistence/draft/editor fixtures. Phase 18 owns upload modules and web Worker dispatch. The coordinator owns shared baseline and architecture guidance. Production activation and publication remain outside scope.

## Decisions

The namespace stores held and permanent claimed rows. Existing claims retain unknown historical claim times as null. A confirmed command records its complete payload hash and durable receipt. Generic draft writes never reserve. The existing controller journals explicit confirmations and serializes them with ordinary saves.

The independent boundary review found that same-tab Retry could accept a historical receipt after another device replaced the hold. The fix reads current canonical state before accepting a replayed receipt. A mismatch preserves raw input and the journal under revision-conflict review. [Selected failing proof and the runnable controller regression](receipt-recovery.md) retain the original false Saved result. The Address control also suppresses held wording when the displayed candidate differs from the fetched registry name.

Prepared browser recovery exposed a synchronous `recovery_required` throw from a paused address-read adapter before its caller could attach a rejection handler. Both new address-read adapters now reject through their promised result. A controller regression and both prepared-recovery browser cases cover the fix.

Throughput checkpoint. First prove SQL rollback in the real D1 fixture, then implement and verify command transport, replay, and browser behavior. Reuse the persistence and owner API fixtures for regressions.

## Results

Implementation and focused local verification are complete. Owner phase approval is pending. Local reports are under this worktree's `.wrangler/verification/` directory.

| Verification | Result | Report |
| --- | --- | --- |
| Persisted D1, tracked migrations, repeatable fixtures, restart | 80 groups passed | `2026-10-21T15-25-24.815Z-jZaqlR/summary.json` |
| Production draft API and autosave browser | 16 API and 48 autosave groups passed, no browser errors | `2026-10-22T03-04-57.696Z-yJDGOz/summary.json` |
| Final unfiltered editor profile | Lint, typechecks, 355 unit tests, web/jobs builds, and all 18 editor browser groups passed | `2026-10-22T03-21-25.260Z-L4FOo2/summary.json` |

The draft gate's overall result includes a later editor fixture failure; its API and autosave commands passed independently. The final editor profile passed the corrected fixtures and paused-read fix. Address UI coverage includes explicit Save address, a persisted hold without a public pointer, reload, restored-candidate wording, keyboard submission, and mobile layout. The standalone controller reproduction also passes. No SQL changed after the successful persistence run.

Earlier failures remain recorded in ignored reports. Persistence fixture fixes corrected a malformed SQL callback and a milestone UPDATE missing its required revision increment. Editor fixture fixes made anonymous requests explicitly signed out and scoped three restoration selectors to Profile controls. [Selected regression proof](receipt-recovery.md) preserves both product failures and their fixes. The coordinator reviewed the SQL, receipt reconciliation, async adapters, and guidance before clearing this phase commit. Final diff, formatting, and 13 local documentation links passed inspection.

The editor remains an isolated handoff fixture. Production guide/editor activation, publication conversion, required-setup handoff validation, deployment, and production CPU feasibility remain outside this evidence. The coordinator owns the integrated full gate and final separate boundary review. Roadmap completion stays unchecked until explicit owner approval.

## Documentation impact

The changed assumption is that explicit Address confirmation reserves an exclusive name. The database, schema, and draft client READMEs now describe held/claimed rows, transactional rollback, immutable replay receipts, mirror guards, and private Address controls. Their earlier candidate-only descriptions now distinguish generic saves from explicit confirmation. The coordinator reconciles baseline, architecture, authentication, onboarding, and verification guidance. Historical Phase 11B evidence remains intact. First publication conversion, required-setup handoff validation, and production flow activation remain later-phase prerequisites.
