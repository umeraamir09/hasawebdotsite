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
D-15/A-4/ADR-16/ADR-19/Q-1, [roadmap](../../docs/roadmap.md) Phases 22, 25, 26, 42A, 42F, 48, 49,
and [implementation status](../../docs/implementation-status.md).

Write boundaries: `docs/` only, plus this record. Shared base `main` at `9c4014c`; branch
`docs/address-reservation-contract` in its own worktree. No approved prerequisites apply because
no phase is implemented and no phase checkbox changed.

## Decisions

- Terminology: "platform-reserved name" is the blocklist; "address reservation" / "held address" is
  the owner's exclusive hold; "permanent claim" is the published state.
- One namespace record with `held`/`claimed` states enforces both holds and claims. `portfolio.subdomain`
  stays the published-address pointer.
- The reservation lasts for the life of the account. No expiry was invented; dormant-account
  reclamation can release holds later without changing the selection contract.
- Existing Phase 11B `requestedSubdomain` values are not auto-promoted. The next confirmed Address
  save attempts the reservation.

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

Limitations: no runtime behavior changed, so no application gate was required. The reservation
behavior itself remains unimplemented; Phase 22 owns the migration and registry.

## Documentation impact

Changed assumption: address selection is no longer a non-reserving candidate, and the
"selection is not a reservation" invariant no longer applies to current guidance.

Updated guidance: `docs/product.md`, `docs/onboarding.md`, `docs/acceptance-criteria.md`,
`docs/architecture.md`, `docs/roadmap.md`, `docs/implementation-status.md` and
`docs/authentication.md` now describe the same reservation contract. Phase 11B and Phase 13 keep
their historical completion records with a dated October 21, 2026 supersession note where the old
behavior could still be read as current.

Unresolved prerequisites: the reservation registry and its forward migration (Phase 22), the
publish conversion (Phase 25), and the `packages/schema` README, fixtures and migration tests.
`docs/rough-idea.md`, `docs/agent-workflow.md`, `docs/appearance-catalog.md`,
`docs/avatar-decorations.md` and `docs/ui-direction.md` needed no change; historical `specs/`
records were not edited.
