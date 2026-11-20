# MVP roadmap

What is left before v1 ships. [product.md](product.md) sets scope, [acceptance-criteria.md](acceptance-criteria.md) sets pass/fail, and [architecture.md](architecture.md) has the contracts to keep. Phase IDs are stable and are referenced from code comments and docs.

## How phases work

- Start a phase when its dependencies are checked off on `main`. "Integrate before completion" items may land later, but the phase is not complete until they do.
- Implement on a branch, run `pnpm verify` (plus the e2e projects you touched), and open a PR.
- When the completion criteria pass, check the box in the same PR and add a one-line note under the phase (PR number, anything deliberately left open). Merging the PR is the approval. No separate approval commit.
- If a phase leaves known work behind, add it to [Open follow-ups](#open-follow-ups) rather than leaving the box ambiguous.

## Done

Every phase below is merged to `main`. Their records are in the `archive/specs-2026-11` tag (`git show archive/specs-2026-11:specs/<folder>/results.md`).

| Area | Phases |
| --- | --- |
| Foundation and feasibility | 01 repository and local runtime · 02 publish rendering · 03 app/API runtime · 04 host and asset routing · 05 auth behavior · 06 GitHub permissions · 07 email delivery · 08 workflow execution and asset withdrawal |
| Accounts and drafts | 09 draft/component contracts · 10 persistence and owner boundaries · 11 sign-up/sign-in · 11A owner API runtime · 11B setup contracts and storage · 11C public GitHub credential · 11D GitHub storage/refresh contracts · 11E appearance catalog and defaults · 12 private portfolio provisioning · 13 revision-aware draft/progress APIs · 14 autosave and local recovery · 15 conflicts and expired sessions |
| Editor and publication | 16 shared renderer · 17 editor and live preview · 18 private uploads · 19 upload and crop controls · 20 required profile and provider suggestions · 21 social and contact identity · 22 address reservation · 22A setup-aware entry and handoff · 23 publication validation · 24 immutable versions · 25 commit and serving · 26 publish/republish primitives |
| Content and pages | 27 component picker and ordering · 28 project cards · 29 rich text sections · 30 case studies · 31 skills and categories · 32 work experience · 33 social links component · 34 resume download and `/resume` |
| Appearance and preview | 35 preset appearance · 36 custom color generator · 37 decorations and Face Reveal setup · 38 Face Reveal interaction and withdrawal · 39 full-page draft preview |
| GitHub | 40 public graph setup · 41 private activity, consent and withdrawal · 42 independent refresh |
| Initial setup guide | 42A guide shell and Address · 42B Profile and Links · 42C Skills and Projects · 42D GitHub onboarding · 42E Review, handoff and gated activation · 42F recovery and new-user journey verification |

## Open follow-ups

Known work left by completed phases. Fold each into the phase that touches it, or do it on its own.

- **Custom color delivery (36).** The generator exists; editor controls, immediate preview and CSP-safe token delivery do not, and the renderer ignores `customColor`. Needed before 53.
- **Owner-entry activation (42E).** `OWNER_ENTRY_ACTIVATION` stays closed; contact delivery (43–45) is in place. Opening it is part of 52.
- **Boundary reviews** the owner asked for and that have not run: authorization/privacy for 20 and 23, withdrawal for 38, access and headers for 39. Do them before 52.

## Remaining phases

### Phase 43. Add email adapters and recipient verification

- Dependencies: 07, 10–11, 13. Integrate before completion: 17, 23 (recipient settings, publication blockers, public-data omission).
- Console development provider, Resend adapter, shared email budgets, and recipient setup from the verified account email or a newly verified address.
- [x] Complete when missing, changed or unverified recipients block form publication, public HTML and data never contain the recipient, and verification/owner notices stay within their reserved allowance.
  - Recipient routes, the editor's contact form panel, `/settings/contact/verify`, migration `0018` budgets and the Vitest-tested Resend/console adapters. Live Resend delivery and the `mail.hasaweb.site` domain are verified in 52.

### Phase 44. Accept contact submissions safely

- Dependencies: 16, 25, 43. Integrate before completion: 23, 26.
- Public form and same-origin `/_/contact` with field errors, Turnstile, submission limits, and atomic budget reservation plus outbox insertion.
- [x] Complete when success means accepted for delivery, blocked/limited/failed submissions never report success, competing requests cannot exceed budgets, and unavailable portfolios reject submissions.
  - Published form and preview form (`publication-v7`), site `/_/contact` with Turnstile, hourly visitor limits and the atomic reservation + outbox batch. Queue hand-off and delivery are Phase 45; a live Turnstile widget is configured in 52.

### Phase 45. Deliver messages, retry, and test setup

- Dependencies: 44. Integrate before completion: 17, 39.
- Idempotent delivery, the confirmed retry schedule and deadline, stuck-outbox recovery, payload deletion, final-failure notices and status. Send test message in settings under its daily limit.
- [x] Complete when controlled failures exercise delivery and exhaustion, test messages report outcomes, preview submissions send nothing, and deferred owner notices still show as failures in the editor. No inbox, attachments or automatic replies.
  - Queue hand-off, cron retries and stuck-lease recovery, owner notices and the editor's delivery section (migration `0019`). Live Resend delivery is verified in 52.

### Phase 46. Add search and sharing metadata

- Dependencies: 16–17. Integrate before completion: 20, 25, 30, 34, 39.
- Derive title, description and sharing image from the profile, with owner overrides and a sharing preview. Render page-specific metadata, robots and sitemap into published versions.
- [x] Complete when served metadata matches published values, public pages allow indexing, drafts stay private, and removed pages stop serving their metadata.
  - Shared `resolveSeo` defaults (name, bio and a generated profile card image), the editor's Sharing panel with a 1.91:1 sharing image and card preview, and per-page title, description, canonical, Open Graph and card tags in immutable documents (`publication-v8`).

### Phase 47. Finish connected-provider settings

- Dependencies: 11, 22A, 41.
- Show providers; allow ownership-proven linking and disconnect; prevent removing the last usable sign-in method. Disconnecting GitHub sign-in reuses the Phase 41 activity-grant cleanup; activity consent or removal alone never adds or removes a sign-in provider.
- [ ] Complete when remaining providers reopen the same editor portfolio without rerunning setup, and disconnect/reconnect reuses activity cleanup.

### Phase 48. Add unpublish and restore

- Dependencies: 25–26 and the withdrawal cache policy. Integrate before completion: 38, 40–41, 44.
- Remove access to the portfolio, case studies, resume, live endpoints and public assets; keep the private draft and address claim; purge caches.
- [x] Complete when old page and asset URLs no longer expose content, no other account can claim the address, and republishing restores the portfolio at that address.
  - #77: `POST /api/owner/publication/unpublish` and `/site`, the durable `publication_withdrawal` cleanup (migration `0020`) and the editor's Unpublish control with confirmation. Deployed CDN absence after purge is still verified in 52 (S-9).

### Phase 49. Add permanent account deletion

- Dependencies: 10, 11B, 15, 18, 24–26, 41, 48.
- Explain the loss and require confirmation. Immediately deny public and owner access, invalidate sessions, revoke grants, then retry removal of draft, setup data, uploads, publication candidates/tasks/pages and output, and account rows. Cleanup records outlive the owner until output absence is confirmed.
- Browser side: dispose the owner's controllers and wait for their writes, then remove only that owner's IndexedDB range (including review copies, prepared replacements and tab continuations). Add owner-scoped tombstones and cross-tab coordination so late writes cannot recreate it. Leave other accounts' recovery alone.
- [ ] Complete when cached sessions cannot bypass deletion, cleanup failures recover, a never-published reservation is released, only a published address survives as an ownerless claim, and cancelling keeps the account.

### Phase 50. Complete discovery and the example portfolio

- Dependencies: 16–17, 35. Integrate before completion: 25, 38–39, 45–46 and every capability the page presents.
- Entry page with examples, the free one-portfolio offer, an explanation of public subdomains, and Start building. Explain required setup and optional steps (no direct editor bypass) and that choosing an address reserves it without creating a public site. Publish the internal example through the real pipeline.
- [ ] Complete when visitors can inspect the example and appearance options, understand the offer and required setup, sign in, and reach the full first-user flow.

### Phase 51. Add operator controls and cleanup

- Dependencies: 11B, 13, 18, 25–26, 41, 45, 49.
- Operator scripts (no product UI): suspend/unsuspend, abuse reporting, rerender, purge, outbox inspection, audited email lookup, audit cleanup.
- Bounded garbage collection: abandoned unreachable uploads (never assets referenced by unfinished setup, partial drafts or sealed candidates, including references not yet in transfer rows); dormant staging attempts (protect active attempts and unreconciled receipts; never release address holds); candidate tombstones. Watch D1 size against a 350 MB alert. Keep GitHub cleanup state until revocation resolves.
- [ ] Complete when suspension blocks serving, lookup audits exclude email and are removed with accounts, and cleanup can neither delete active setup assets nor retain a deleted account's data.

### Phase 52. Prepare production delivery and recovery

- Dependencies: every feature and lifecycle phase through 51.
- Production Wrangler configs, secrets and bindings; backward-compatible migrations; GitHub Environment approval and `jobs` → `site` → `web` deploy order. Include both provider callbacks, the recovery callbacks, the activity OAuth app, cache purge, abuse email, logs, quota/CPU alerts, restore/rollback and renderer retention/rerender.
- Launch preparation: upgrade to Workers Paid, confirm account settings, then measure the final dispatcher and owner handlers natively, reconcile monthly operations, D1 size and R2 retention, verify S-9 withdrawal, callbacks/TLS and rollback. Open the owner-entry gate.
- [ ] Complete when CI and release config cover these checks, the full guide is live before routing depends on it, and rollback preserves drafts and milestones.

### Phase 53. Run the complete acceptance review

- Dependencies: everything through 52.
- Run every numbered criterion, including ON-01 to ON-19, with new and returning owners, visitors and another owner, across the confirmed browser/viewport matrix. Cover optional paths, reservations and claims, races, failures, recovery and deletion, live-data exceptions, keyboard/focus, contrast across all twelve palettes, crop dialogs, private consent, reduced motion, both decoration loops and pause/play, flashing limits and deferred-scope exclusions.
- [ ] Complete when all checks pass with recorded results. No real-device or assistive-technology testing beyond the confirmed scope.

### Phase 54. Validate the journey and release the MVP

- Dependencies: 11E, 50, 52–53.
- Target users with ready content run discovery through required setup (with reservation), skipped optional steps, Review, editor, first Publish and a later republish. Gather feedback on optional/partial paths; fix and repeat affected checks.
- [ ] Complete when the under-15-minute profile-only publish target and the full acceptance review pass, and production smoke checks pass through real hosts and consent returns after the paid upgrade.

After launch, submit `hasaweb.site` to the Public Suffix List (acceptance is not a launch prerequisite).

## Out of scope

The exclusions in [product.md](product.md#features-deferred-beyond-the-mvp-out-of-scope) apply to every phase: additional portfolios or templates, education, billing, custom domains, arbitrary layout/CSS, custom decoration uploads, per-color palette editing, automatic project/skill imports, repository statistics, proficiency ratings, structured resume authoring, inbox/attachments/auto-replies, AI generation, collaboration, visitor accounts, multilingual editing, version history and visitor analytics. Private GitHub activity stays in scope. The setup guide excludes repeat onboarding, an editor bypass before required setup, surveys, retained source images and screens for editor-only features.
