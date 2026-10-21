# Reserve the subdomain on selection, claim it on first Publish

## Scope and acceptance

Documentation-only scope change implementing the owner's October 21, 2026 decision recorded in
`/home/umer/.opencode/plan/2026-10-21-subdomain-reservation-scope.md`. A confirmed Address save
reserves the address exclusively; first Publish converts that reservation into the permanent claim.
This removes the onboarding-to-publish race where another owner could take the name between
selection and the first publication.

No application code, schema, migration, test, fixture or Figma change. The reservation registry
and its migration belong to Phase 22; the publish conversion belongs to Phase 25.

Requirements updated together: [product](../../docs/product.md) section 15,
[onboarding](../../docs/onboarding.md), [acceptance criteria](../../docs/acceptance-criteria.md)
ON-02/ON-14/ON-18 and AC 15.1-15.3, 15.8, 18.5-18.6, [architecture](../../docs/architecture.md)
D-15/A-4/ADR-16/ADR-19/Q-1, [roadmap](../../docs/roadmap.md) Phases 22, 22A, 23, 25, 26, 42A, 42F,
48, 49, and [implementation status](../../docs/implementation-status.md).

Write boundaries: `docs/` only, plus this record. Shared base `main` at `9c4014c`; branch
`docs/address-reservation-contract` in its own worktree. No approved prerequisites apply because
no phase is implemented and no phase checkbox changed.

The same change also records the implementation consequences of the contract for work the completed
phases already produced. Those consequences were verified against
`packages/db/migrations/0001_owner_constraints.sql`, `packages/db/src/schema.ts`,
`packages/db/src/bounded-save.ts`, `packages/db/README.md`, `packages/schema/README.md` and
`specs/2026-10-17-revision-aware-drafts/protocol.md`. The plan for that amendment is
`/home/umer/.opencode/plan/2026-10-21-pr25-reservation-amendment.md`.

## Decisions

- Terminology: "platform-reserved name" is the blocklist; "address reservation" / "held address" is
  the owner's exclusive hold; "permanent claim" is the published state.
- One namespace record with `held`/`claimed` states enforces both holds and claims. `portfolio.subdomain`
  stays the published-address pointer.
- The reservation lasts for the life of the account. No expiry was invented; dormant-account
  reclamation can release holds later without changing the selection contract.
- Existing Phase 11B `requestedSubdomain` values are not auto-promoted. The next confirmed Address
  save attempts the reservation.
- The existing `subdomain_claim` record is extended, not replaced. Its Phase 22 migration adds the
  `held`/`claimed` state and timestamps and rewrites the delete trigger so a `held` row can be
  released while a `claimed` row stays permanent. Only the delete trigger blocks the new model; the
  existing name, platform-reserved and format triggers already cover held rows, and the existing
  transfer trigger already permits the `held` to `claimed` state change and the owner-clearing on
  account deletion.
- Ownership: Phase 22 owns the migration, the trigger rewrite, the batched reservation save, the
  unavailable-name result and the rule that staged and legacy paths do not reserve. Phase 22A owns
  the required-setup check that the portfolio holds the reservation. Phase 25 owns the conversion
  and consumes the Phase 22 guards. No new phase ID was added.

## Results

Documentation profile (`docs`) applied:

- `git diff --check HEAD` clean.
- Relative-link and anchor check over all seven changed files: every link resolves.
- Contradiction sweep over `docs/` for `does not reserve`, `is not reservation`, `unreserved`,
  `non-reserving`, `no reservation`, `without a claim`, `same candidate`, `two owners can save`,
  `selection is not`, `early address reservation`. Every remaining hit is a dated historical note
  (Phase 11B and Phase 13 completion records), a deliberately unchanged current-code statement
  (`packages/schema/README.md` is outside `docs/`), or newly intended wording.
- Terminology sweep: the platform blocklist reads "platform-reserved name", the owner hold reads
  "address reservation" or "held address", and the published state reads "permanent claim".
- Cross-document matrix confirmed: reserve on confirmed Address save, exclusive reservation, no
  public URL, changeable until first publication, atomic replacement with the old hold kept on
  failure, Publish converts hold to claim, failed Publish keeps the hold, account-lifetime hold,
  deletion releases an unpublished hold and keeps a published claim.
- Scope check: `git status --short` shows only the seven intended `docs/` files plus this record.
  No `apps/`, `packages/`, migration, test or Figma change.
- No phase was checked off. Phases 22, 25, 26, 42A, 42F, 48 and 49 keep their previous status.

Amendment verification against the working tree, recorded so later phases do not rediscover it:

| Check | Evidence | Result |
| --- | --- | --- |
| `subdomain_claim` has only `name` and `portfolio_id`; no `state` column | `packages/db/src/schema.ts` | confirmed |
| The delete trigger aborts every DELETE | `packages/db/migrations/0001_owner_constraints.sql` | confirmed |
| The transfer trigger blocks a name change or portfolio transfer but allows `portfolio_id` to become NULL | trigger condition, plus the account-deletion fixture leaving an ownerless claim | confirmed |
| The transfer trigger does **not** block a `held` to `claimed` state change | the trigger inspects only `name` and `portfolio_id` | confirmed |
| The Phase 13 protocol states that no save claims an address, and its error set has no unavailable-name code | `specs/2026-10-17-revision-aware-drafts/protocol.md` | confirmed |
| Multi-statement D1 `batch()` is the established atomic-write mechanism | `packages/db/src/bounded-save.ts` | confirmed |
| The `site` Worker needs no change, because a held name is absent from `portfolio.subdomain` | `docs/architecture.md` section 8.4 | confirmed |

Correction: an earlier review of this change stated that the transfer trigger blocks the
`held` to `claimed` conversion. That is wrong and the roadmap text does not rely on it. The trigger
inspects only `name` and `portfolio_id`, so a state update trips neither condition. Only the delete
trigger blocks the new model, in two places: releasing the previous hold on replacement and
cleaning up held rows on account deletion. The recorded plan reflects the corrected analysis.

Limitations: no runtime behavior changed, so no application gate was required. The reservation
behavior itself remains unimplemented; Phase 22 owns the migration, the trigger rewrite and the
registry.

PR #25 review fixes, October 21, 2026: documented a delete-then-insert hold swap that respects unique `portfolio_id`, with whole-batch rollback on constraint or revision CAS failure. Split first-publication and republish commits, including durable retry receipts and protection against restoring an older pointer. Address continuation now requires server confirmation of the reservation save. Updated the downstream Phase 22/25, onboarding and baseline wording. These are future implementation contracts; reservations remain unimplemented. Verification: `git diff --check HEAD` passed, the final diff and section references were reviewed, and no links changed. No application tests were run for this documentation-only follow-up.

## Documentation impact

Changed assumption: address selection is no longer a non-reserving candidate, and the
"selection is not a reservation" invariant no longer applies to current guidance.

Updated guidance: `docs/product.md`, `docs/onboarding.md`, `docs/acceptance-criteria.md`,
`docs/architecture.md`, `docs/roadmap.md`, `docs/implementation-status.md` and
`docs/authentication.md` now describe the same reservation contract. Phase 11B and Phase 13 keep
their historical completion records with a dated October 21, 2026 supersession note where the old
behavior could still be read as current.

Unresolved prerequisites: the reservation registry and its forward migration, the delete-trigger
rewrite, the batched reservation save and the unavailable-name result (all Phase 22), the
required-setup check that the portfolio holds the reservation (Phase 22A), the publish conversion
(Phase 25), and the `packages/schema` and `packages/db` READMEs, fixtures and migration tests.
`packages/db/README.md` lines 53 and 65 and `packages/schema/README.md` line 19 still describe the
pre-migration behavior; they are correct for the implemented code today and are now named as
Phase 22 deliverables. `docs/rough-idea.md`, `docs/agent-workflow.md`,
`docs/appearance-catalog.md`, `docs/avatar-decorations.md` and `docs/ui-direction.md` needed no
change; historical `specs/` records were not edited, and the Phase 13 protocol file keeps its
pre-October 21 wording as the historical record for the completed work.

Review follow-up: replacement ordering and republish state assumptions are corrected in architecture, roadmap, onboarding and implementation status. Phase 22 still owns the atomic swap and its migration; Phase 25 owns the separate commit paths and retry guards. No implementation prerequisites or phase approvals changed.
