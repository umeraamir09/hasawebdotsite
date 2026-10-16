# Phase 11B implementation evidence

Implemented October 16, 2026 on `feat/initial-setup-storage`. The owner approved Phase 11B completion on October 16, 2026; the roadmap is checked off.

## Delivered behavior

- Draft version 2 adds optional `requestedSubdomain`. The version 1 reader preserves existing content, component/link IDs, order and sample markers. It changes only the envelope version and does not grow an exact 1 MiB document. Successful validated saves persist that upgrade through D1.
- The candidate stays in private JSON. Different owners save the same candidate without populating the claimed-subdomain column or inserting a claim. The existing permanent-claim behavior remains intact.
- Separate versioned `setup_progress` stores only the last visited step. Content, progress and first editor entry share `draft_rev`. Direct changes and staged commits compare revisions, update content/progress atomically and update the save timestamp.
- `first_editor_entered_at` is a permanent private timestamp. The internal handoff persistence operation compares the authoritative revision and is idempotent. Ordinary save payloads cannot set it. Setup writes and prepared commits fail after entry. Database triggers freeze progress and reject milestone resets or changes while permitting later editor content changes.
- Existing rows default to validation generation 0. Incremental writes require generation 2, established by current-schema creation or successful reference validation. Invalid legacy destinations are rejected without truncation or silently marking them valid.
- Migration `0003_initial_setup.sql` adds columns in place and promotes the bounded-save staging tables into tracked migrations. It preserves existing draft JSON, asset children and permanent claims/triggers. Account deletion removes private setup and staging data without reserving candidates.
- `toPublicContent` projects only content fields, excluding candidates and setup/sample metadata. The owner-status endpoint selects portfolio identity alone.

## Verification

| Check | Result |
| --- | --- |
| `pnpm check` | Pass on the implementation: Biome, all 12 package typechecks and 167 unit tests across 17 files. See the subsequent unrelated-file lint finding below. |
| `pnpm build` | Pass: all 12 package builds, OpenNext bundle and Worker dry-run bundles |
| `pnpm test:persistence` | Pass: 45 workerd/D1 groups, including 14 setup groups, tracked migration reapplication, repeatable fixtures and restart persistence |
| `pnpm test:auth` | Pass: 21 provider/session/access groups, including Chromium cookie isolation |
| `pnpm test:runtime` | Pass: three Workers, D1, three R2 buckets, bindings, Queue, Workflow and restart persistence |
| Bounded-save regression | Pass: all 17 groups, including full 1 MiB string assembly, atomic commits, conflicts, retries, revocation and D1 failures |
| Drizzle generation consistency | Pass: no schema changes after generating and reviewing migration 0003 |
| `git diff --check` | Pass |

The persistence harness now populates the original schema before applying migration 0003. Its fixture includes version 1 content, sample markers, an owned asset and a permanent claim. New setup checks cover exact-size legacy upgrades, duplicate candidates, repeated/concurrent creation, content/progress races, stale handoff, forged flags, cross-owner staging access, staged commit retries, permanent entry, old prepared writes, revoked/expired sessions, deleting accounts and cleanup cascades.

See [persistence-evidence.json](persistence-evidence.json), [auth-evidence.json](auth-evidence.json) and [bounded/local-results.json](bounded/local-results.json). Historical Phase 11 evidence is preserved. Use the Linux pnpm executable in this WSL environment, with `/home/umer/.local/share/pnpm/bin` first in PATH. Reproduce the bounded regression with `BOUNDED_SAVE_EVIDENCE=specs/2026-10-16-initial-setup-storage/bounded node scripts/bounded-save-runtime.mjs` after the build finishes. An initial attempt was interrupted by concurrent replacement of OpenNext build files; the completed rerun passes.

After the successful `pnpm check`, an unrelated untracked root file, `understanding.html`, appeared during this work. A final unrestricted `pnpm lint` reports one `useSemanticElements` error at its line 805 and 15 warnings. That file was left untouched. Running Biome over all Git-listed tracked/untracked files except that unrelated file passes, checking 267 files. No Phase 11B file has a remaining lint error.

## Limits and next dependencies

This increment implements contracts and persistence. No new save/handoff HTTP endpoint or onboarding screen is activated. The authoritative handoff service must validate saved required fields and ready owned assets at the same revision before invoking the internal milestone operation. Route guards and complete guide activation remain in their planned phases.

`setup.validateLegacyDraft()` is a whole-document reference validator for offline maintenance. It is not a Free hot HTTP save path. Phase 13 must implement bounded legacy validation/correction and strict product action schemas before enabling incremental saves for unvalidated legacy content. Later editor saves must preserve the frozen setup progress/milestone and clean up old prepared attempts; dormant-owner cleanup remains Phase 51.

Public projection is an allowlist, not publication validation. The later publication pipeline still needs to omit untouched samples, validate readiness and collect reachable assets before rendering. Appearance identifiers remain fixtures until Phase 11E approval.

All new verification is local functional evidence. No production deployment or new deployed CPU/quotas claim is made. Figma was not modified; this phase changes no UI.
