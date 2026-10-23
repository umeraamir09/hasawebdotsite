# Phase 22A setup-aware entry and handoff

## Scope and acceptance

Implement [Phase 22A](../../docs/roadmap.md#phase-22a-add-setup-aware-account-entry-and-handoff-services) and the service portions of [ON-01, ON-13, ON-14, ON-16 and ON-17](../../docs/acceptance-criteria.md#2-create-an-account-and-start-a-portfolio). Preserve the [authentication boundaries](../../docs/authentication.md) and [shared recovery contract](../../apps/web/lib/draft/README.md).

Prerequisites 11, 11B, 12 through 15 and 17 through 22 are owner-approved and integrated into `main` at `598d3a5`. Phase 20's separate authorization/privacy review remains outstanding. Work uses `feat/22a-setup-handoff` in `/home/umer/hasawebdotsite/.wrangler/worktrees/phase22a`. Write boundaries cover entry resolution, required-setup validation, permanent handoff, their fixtures and affected guidance. No agents are delegated. Full guide and editor activation remain Phase 42E.

Workflow. Trace current contracts, define service boundaries, implement, self-review, drive fixtures and account routes, run the full local gate, and update guidance. Shipping and roadmap checkoff require separate owner authorization.

Throughput checkpoint. Prerequisites are integrated. Required validation, handoff, entry routing and recovery verification run sequentially in this session. The existing draft controller owns all saves and journals. D1 owns revisions, holds and the permanent milestone. R2 readiness checks stay in web because jobs has no private-bucket access. Shared auth and schema contracts require the full verification profile.

## Decisions

Read required-field facts with SQL rather than decoding the whole draft in a Worker. Check object existence through the existing private asset resolver. Recheck required facts, owned ready metadata, held address, revision, pending staging and persisted access in the milestone update. An already completed owner returns to the editor even after required content is removed. No migration is needed.

Normal callbacks and signed-in sign-in visits use fixed `/auth/entry`. It resolves persisted setup state but retains the account shell until Phase 42E. Direct `/editor` navigation sends incomplete owners to that shell. Fixed recovery callbacks remain unchanged.

Use the recovery coordinator's existing operation lock for handoff. Flush valid edits, pause the controller, preserve optional browser recovery and retain the pause after success. A persistence failure stops navigation. Recovery review cannot replace the controller while handoff is running. No second save queue or prepared setup-attempt conversion is added.

Read-only Figma context for action `326:590` supplies the Open editor label, DM Sans, lime accent, pill shape and 48-pixel height. The reusable action composes existing button styles. Desktop/mobile screenshots were inspected. The surrounding autosave fixture is test UI. No Figma file changes were made. Full Review layout remains Phase 42E.

## Results

All commands in the `full` local verification profile pass across two locked runs for the final implementation. The [main run](../../.wrangler/verification/2026-10-23T09-44-03.634Z-TZEo2I/summary.json) passes lint, type checks, 403 unit tests, all application builds, 27 renderer browser groups and authentication with 19 browser journey checks. Its persistence migration subprocess then exits during startup. The [locked resume](../../.wrangler/verification/2026-10-23T09-57-02.429Z-CV99Cu/summary.json) passes all eight remaining commands, including persistence with 80 groups, uploads with 11 groups, draft APIs, autosave with 49 browser groups, editor with 34 browser groups, three-Worker runtime, runtime correctness smoke and 31 routing boundaries. The resume repeats the failed migration rather than treating it as passed. No assertions or timeouts were relaxed. Later edits finalize documentation only.

The final API checks exercise empty requirements, strict bounded commands, owner isolation, sample fields and Unicode whitespace, accepted owned ready images, missing objects, held-address ownership, dynamic reserved names, pending work, legacy validity, write failures, revision/readiness races, expiry/deletion at commit, concurrent handoffs and repeat entry after content removal. Required setup also passes at the exact one-MiB draft ceiling. The main authentication browser run checks fixed normal/recovery callbacks and setup/editor routing through signed-in sign-in, account entry and direct navigation.

The final browser fixture saves a visible Name edit, retains optional raw input, loses a successful handoff reply and retries without changing the milestone. It then explicitly reviews the preserved setup record into a fresh content scope without replaying progress or converting a setup attempt. Optional raw input uses a controller setter; its preservation is controller proof, not a claim about typing through a complete guide. See the resume's `suite-4/browser-results.json`, `setup-handoff.png` and `setup-handoff-mobile.png`. The final code passes 44 focused handoff/coordinator unit tests. Earlier runs also pass the updated [entry skill journey](../../.wrangler/evidence/verify-hasaweb-6tWFQS/journey.json), including empty storage before/after, retained screenshots/trace, removed scratch storage and no cleanup errors.

Earlier unsuccessful gates remain under ignored evidence directories. The first run at `.wrangler/verification/2026-10-23T04-44-20.660Z-VItnWU/summary.json` encountered a fixture SQL HTTP 500 in the unchanged upload implementation. Repeated upload suites pass; the original transient cause remains unconfirmed. Fixture HTTP diagnostics now include the failed response body. Other attempts stopped at formatting, SIGTERM or a five-second subprocess test timeout. Formatting is corrected and the subprocess suite passes in isolation and in the final main run.

The self-review checked expected-owner authentication, exact origins/callback allowlists, bounded bodies, private responses, reservation and asset races, staging, revision CAS, permanent retry behavior and local recovery. It found and repaired persistence failure handling and the handoff/review pause lifecycle. No unresolved defect remains from that pass. Changed local links/anchors, skill metadata validation and `git diff --check` pass.

The separate authentication/privacy boundary review and explicit owner completion approval remain outstanding. The roadmap checkbox remains unchecked. This branch is not integrated into `main`. No deployment, live provider verification or deployed CPU claim is made. Full guide activation and publication validation remain separate work.

## Documentation impact

Updated authentication, architecture, onboarding, implementation status, package/client/asset contracts and the root README to distinguish implemented services from Phase 42E activation. The verification skill's entry helper and recipes now observe `/api/owner/entry`, with incomplete owners in `/auth/entry`. Required setup checks document authoritative held reservations and ready owned image objects. Publication validation, complete guide/editor activation, provider/runtime feasibility and the separate boundary review remain outstanding. Historical experiments, measurements and owner approvals are unchanged.
