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
- [x] Complete when remaining providers reopen the same editor portfolio without rerunning setup, and disconnect/reconnect reuses activity cleanup.
- #76: settings section in the editor's Sharing panel, ownership-proven linking, guarded disconnect; GitHub disconnect calls the Phase 41 withdrawal. Remote revocation of the sign-in app's own GitHub authorization is not done (the stored token is deleted).

### Phase 48. Add unpublish and restore

- Dependencies: 25–26 and the withdrawal cache policy. Integrate before completion: 38, 40–41, 44.
- Remove access to the portfolio, case studies, resume, live endpoints and public assets; keep the private draft and address claim; purge caches.
- [x] Complete when old page and asset URLs no longer expose content, no other account can claim the address, and republishing restores the portfolio at that address.
  - #77: `POST /api/owner/publication/unpublish` and `/site`, the durable `publication_withdrawal` cleanup (migration `0020`) and the editor's Unpublish control with confirmation. Deployed CDN absence after purge is still verified in 52 (S-9).

### Phase 49. Add permanent account deletion

- Dependencies: 10, 11B, 15, 18, 24–26, 41, 48.
- Explain the loss and require confirmation. Immediately deny public and owner access, invalidate sessions, revoke grants, then retry removal of draft, setup data, uploads, publication candidates/tasks/pages and output, and account rows. Cleanup records outlive the owner until output absence is confirmed.
- Browser side: dispose the owner's controllers and wait for their writes, then remove only that owner's IndexedDB range (including review copies, prepared replacements and tab continuations). Add owner-scoped tombstones and cross-tab coordination so late writes cannot recreate it. Leave other accounts' recovery alone.
- [x] Complete when cached sessions cannot bypass deletion, cleanup failures recover, a never-published reservation is released, only a published address survives as an ownerless claim, and cancelling keeps the account.
  - #78: `POST /api/owner/account/delete`, the durable `account_deletion` cleanup (migration `0021`), the editor's Delete account confirmation and owner-scoped IndexedDB tombstones with cross-tab disposal. Deployed CDN absence after purge is still verified in 52 (S-9).

### Phase 50. Complete discovery and the example portfolio

- Dependencies: 16–17, 35. Integrate before completion: 25, 38–39, 45–46 and every capability the page presents.
- Entry page with examples, the free one-portfolio offer, an explanation of public subdomains, and Start building. Explain required setup and optional steps (no direct editor bypass) and that choosing an address reserves it without creating a public site. Publish the internal example through the real pipeline.
- [x] Complete when visitors can inspect the example and appearance options, understand the offer and required setup, sign in, and reach the full first-user flow.
  - #79: entry page from the Figma landing frames with a live appearance preview and a setup section; the hero name prefills Address after sign-in; migration `0022` gives `example` to an internal account and `pnpm example:publish` publishes it through the owner routes. Running it against production is part of 52.

### Phase 51. Add operator controls and cleanup

- Dependencies: 11B, 13, 18, 25–26, 41, 45, 49.
- Operator scripts (no product UI): suspend/unsuspend, abuse reporting, rerender, purge, outbox inspection, audited email lookup, audit cleanup.
- Bounded garbage collection: abandoned unreachable uploads (never assets referenced by unfinished setup, partial drafts or sealed candidates, including references not yet in transfer rows); dormant staging attempts (protect active attempts and unreconciled receipts; never release address holds); candidate tombstones. Watch D1 size against a 350 MB alert. Keep GitHub cleanup state until revocation resolves.
- [x] Complete when suspension blocks serving, lookup audits exclude email and are removed with accounts, and cleanup can neither delete active setup assets nor retain a deleted account's data.
  - `pnpm ops` operator scripts (suspend reuses the Unpublish withdrawal), cron garbage collection in `apps/jobs/src/maintenance.ts` with upload collection through `PublicationAssets`, migration `0023` and the hourly 350 MB D1 size log. Wiring that log to an alert and running the scripts against production are part of 52.

Phases 51.1 to 51.5 move the editor and the setup guide to the Workbench design in the [Figma file](ui-direction.md). The editor design is on page "Editor / Workbench" (`392:2`). The setup guide design is the "Setup v2" sections of page "Onboarding / A little space to begin" (`325:2`); the older frames on that page are hidden and are not the target. These phases change layout and presentation. Draft contracts, autosave, validation and publication behavior stay the same, and existing e2e journeys move to the new controls instead of being dropped.

### Phase 51.1. Adopt the Workbench foundations

- Dependencies: 51.
- Add the "Workbench" variable collection as CSS custom properties with light and dark values (backgrounds, lines, text, ink, signal, status colors and the scrim). The editor and guide follow the operating system's color scheme as each moves over.
- Self-host Geist and Geist Mono (OFL, frozen by digest like the portfolio fonts) for the app only. Published portfolios keep their catalog fonts.
- Build the shared controls from the Components board (`394:2`) and the icon set (`393:2`): Button, IconButton, Toggle, Field, Area, Chip, FilterChip, StatusPill, SectionRow, a segmented control, a popover, and a dialog that is a centered modal on desktop and a bottom sheet on mobile.
- Update [ui-direction.md](ui-direction.md): Geist and the signal blue replace DM Sans and lime for the app, and the node table points to `392:2` and `325:2`.
- [x] Complete when every control renders in both schemes at WCAG 2.2 AA contrast with visible focus, dialogs trap and return focus, and `pnpm check` covers their keyboard behavior.
  - #84: `--wb-*` tokens, Geist fonts and the controls in `apps/web/components/workbench`, shown at `/catalog/workbench`; five Figma colors moved to reach AA, listed in `workbench.test.ts`.

### Phase 51.2. Rebuild the editor shell, canvas and page outline

- Dependencies: 51.1.
- Replace the Content, Customization and Sharing tabs in `editor-session.tsx` with the shell from "Editor shell" (`406:1147`). The top bar holds the address and status pill, the Desktop/Mobile preview switch, the preview scheme toggle, the save state, Preview and Publish. The rail holds Build, Style, Share and the account avatar. A 392 px panel sits beside the canvas.
- The canvas shows the real renderer with hover and selected outlines, a section tag and move up, move down and remove actions (frames `407:1232` and `411:3276`). Canvas, panel and keyboard share the existing `PreviewSelection`, so selecting in one place selects in all of them.
- The Build panel lists the profile card, the section rows with drag and keyboard reordering, and Add section. Add section opens a gallery whose tiles are scaled renders of each component type, with single-instance types marked once added (`411:4431`). Removal keeps the existing confirmation.
- On mobile the preview comes first (`417:11033`). Tapping a section shows a dock of that section's actions, and the outline and editors open as bottom sheets (`417:11661`). This replaces the "Edit content" and "View preview" toggle.
- [x] Complete when every `editor` journey passes on the new shell, selection stays in sync across canvas, outline and keyboard, and the shell works across the confirmed viewport matrix.
  - #85: shell, canvas outline with section actions, page outline and Add section gallery in `editor-session.tsx`, `page-outline.tsx` and `section-gallery.tsx`; the preview bridge gained `action` and `scheme` messages; below 1024 px the preview comes first with a dock and bottom sheets.

### Phase 51.3. Move the content editors into the panel

- Dependencies: 51.2.
- Profile (`409:2175`, mobile `417:12355`): banner and avatar with camera actions, then the Decoration and Face reveal rows, then name, bio, location and links with drag handles and visibility toggles.
- The Decoration row shows the current decoration and opens a gallery (`431:15145`, mobile sheet `433:17711`). Each tile shows the owner's avatar wearing one catalog decoration as a still, using the renderer's avatar markup, and choosing a tile updates the preview at once. The gallery reads the catalog, so a new decoration needs no editor change. Search and filter chips (`431:15358`) appear only once the catalog has more than eight entries. The concept decorations in Figma are not catalog entries.
- Section editors open in the panel under a back header (project `411:3276`). Case studies get the writing mode with an outline and a format toolbar (`415:10624`).
- Leave out the Role field the design shows. The profile keeps name, bio and location.
- [ ] Complete when every content type is editable in the panel on desktop and mobile, every `PublicationCorrection` path opens the right editor, the decoration gallery works with pointer and keyboard, and `editor` and `uploads` pass.

### Phase 51.4. Rebuild Style, Share, Publish and account

- Dependencies: 51.2.
- Style (`413:6305`): theme swatches from each catalog palette, Custom color with its generated light and dark pair, Mode, and font tiles. This finishes custom color from 36: editor controls, immediate preview, CSP-safe token delivery, and a renderer that reads `customColor`.
- Share (`413:7431`): address, sharing metadata and unpublish.
- Publish (`414:8373`, `414:9545`): the Publish button opens the checklist as a popover with an issue count, each issue opens its editor, and the button shows the first publish, ready, publishing, published and failed states.
- Account menu (`414:9669`): sign out, settings and account deletion.
- [x] Complete when a custom color renders the same in the preview and on the published page, every checklist issue lands on its control, and `editor`, `publication` and `renderer` pass.
  - #86 and this PR: custom color reaches previews through CSSOM properties and published pages through a retained palette stylesheet; the Style panel, Share panel, Publish popover and account menu use Workbench controls.

### Phase 51.5. Rebuild the setup guide on Setup v2

- Dependencies: 51.1. It can run alongside 51.2 to 51.4.
- Replace the guide layout in `setup-guide.tsx` and `setup-handoff.tsx` with the Setup v2 frames for desktop and mobile in both schemes. Each step is one centered card under a title with no subtitle. The top bar shows segmented progress, and once the address is held, the address with a Private pill. Back, Skip and Skip to review sit in one fixed row, and Continue stays in the same place on every step. Review keeps the real renderer with the device and scheme switch.
- Address has an inline `.hasaweb.site` suffix and an availability pill. On Profile the profile card is the form (banner, avatar, name, bio) and uses the shared crop dialogs. Links uses platform rows, Skills a token input with suggestions, Projects a project card, and GitHub a username lookup, a graph preview and a Public or Public + private choice.
- Setup v2 has no frames yet for a taken address, provider suggestions, cropping, a public email, private GitHub authorization or a failed save. Build these from the v2 kit (`471:11455`) and the hidden earlier states (`460:10192`) until v2 versions exist.
- The owner's decisions, recorded in [onboarding.md](onboarding.md): the design's pills and address bar replace the explanatory sentences; a bio holds at most 160 characters for setup and Publish; the Address step offers available names from the account name as chips; "Skip" and "Skip to review" are the optional steps' labels.
- [x] Complete when ON-01 to ON-19 pass on the new screens, required steps still offer no skip or bypass, and the guide matches the frames on desktop and mobile in both schemes.
  - This PR: Setup v2 shell and step cards in `setup-guide.tsx` and the `guide-*-step.tsx` files, `BIO_MAX` in the setup and publication check, and the guide journeys moved to the new controls.

Phases 51A to 51C test whether a beta of about 15 portfolios (5 editing sessions and 5 publishes a day) can launch on Workers Free instead of Paid. Every Free quota fits that load. The open question is the 10 ms CPU limit: October's native runs measured publication batches at about 30 ms p95, and the generated sharing card has never been measured. Free terminates a Worker only once it goes over the limit "consistently", so only a native run settles it.

### Phase 51A. Split the cron and bound each trigger

- Dependencies: 51.
- Replace the single every-minute trigger with separate Cron Triggers that `scheduled()` dispatches on `event.cron` (Free allows five per account): publication, withdrawal, unpublish and deletion sweeps plus GitHub grant cleanup every minute; the contact outbox every two minutes; maintenance every five minutes; the private GitHub refresh and the D1 size check hourly. Each sweep gets its own error handling, so one failure no longer skips the rest.
- Lower the per-tick batches to suit the beta: contact `SWEEP_MESSAGES` from 10 to 3 and `PRIVATE_SWEEP_BATCH` from 25 to 10. Read the publication batch from `PUBLICATION_TASK_BATCH` (default 16) instead of the literal in `apps/jobs/src/publication-routes.ts`.
- Add a local test that counts D1 queries per scheduled invocation with every sweep's work due. Update the per-tick numbers and schedules in [architecture](architecture.md) §6 and §9.
- [ ] Complete when every trigger stays at or under 50 D1 queries with all sweeps loaded (a `batch()` counts as one), a failing sweep leaves the others running, and `publication` and `api` pass in full.

### Phase 51B. Measure the Free plan natively

- Dependencies: 51A. Needs the owner's approval to deploy temporary Workers to the Cloudflare account.
- Bring back the native measurement harness from the archive tag (`scripts/cloudflare-analytics.py`, `deployed-runtime-tail.mjs`, `publication-dispatch-tail.mjs`) as a current script; 52 reuses it for its own native measurements. Deploy `main` as isolated workers.dev Workers with a dedicated D1 database and buckets, synthetic owners and no zone routes, and delete them afterwards.
- Cases: the owner API (the 22 draft cases and every route added since), warm and after 15 idle minutes; OpenNext auth routes and pages, warm and cold; `site` pages, `/_/github.json` and `/_/contact`; a 5 MiB image and a 10 MiB PDF upload; a realistic beta portfolio, the maximum draft and the dense draft, published five times each at batch 16 and batch 6, with and without an owner sharing image; and a loaded tick of every cron trigger.
- Record each invocation's outcome and CPU, plus Queue operations and D1 rows, in the PR description. Gates: G1 owner API, G2 publication batches (a dense publish within about 1,700 Queue operations), G3 the card stage, G4 OpenNext, G5 cron, G6 `site`, uploads and the other consumers. Each passes with no `exceededCpu` outcome; HTTP entry points also need p95 below 10 ms.
- If G2 fails at every batch size, stop the Free path and launch on Paid as 52 describes.
- [ ] Complete when every case has run, each gate has a recorded result, and the PR states the plan decision. If the decision is Free, the same PR updates [architecture](architecture.md) §2, 52 and 54.

### Phase 51C. Fix the paths that failed on Free

- Dependencies: 51B with a Free decision. Do only the items whose gate failed, then measure those paths again.
- G3: without an owner sharing image, publish the banner, then the avatar, then a static platform card, behind a variable that restores the generated card after an upgrade. This is visible to owners, so the owner confirms the order. Bump the renderer version.
- G2 passing only at a smaller batch: set `PUBLICATION_TASK_BATCH` in the production config.
- G4: handle `/api/auth/*` in `apps/web/worker.ts` before OpenNext (run `auth` and `api` in full), and serve the pages OpenNext already prerenders as Static Assets with their headers in `_headers`.
- G5: spread the triggers further or lower the batches again.
- [ ] Complete when every failed gate passes on a second native run and the docs that state the changed contracts are updated.

### Phase 52. Prepare production delivery and recovery

- Dependencies: every feature and lifecycle phase through 51, including 51.1 to 51.5.
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
