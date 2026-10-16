# MVP implementation roadmap

Build the full MVP in the written order below. Existing phase IDs remain stable for references; lettered phases are explicit additions. Phases 01 through 11 retain their historical completion and evidence. All new and revised pending work remains unchecked. Each phase is a small, reviewable increment with a concrete completion check; split it further if it cannot be reviewed as one focused change.

## Sources and scope

- [product.md](product.md) defines the required behavior and MVP scope.
- [onboarding.md](onboarding.md) records the October 16, 2026 agreement: mandatory Address/Profile/Links, optional Skills/Projects/GitHub public/private setup, private Review, and permanent first editor handoff.
- [acceptance-criteria.md](acceptance-criteria.md) defines pass/fail checks. References such as AC 15 refer to its matching feature section.
- [architecture.md](architecture.md) defines the implementation approach and confirmed decisions. Its section 13 resolves verification settings that the acceptance document originally left open.
- [rough-idea.md](rough-idea.md) explains the original concept. Use it for context; the agreed product scope controls what ships.

The release is free. Each account has one portfolio, one preselected template, and one fixed public subdomain after first publication. Implement the fixed profile and every optional MVP component. A component being optional for owners does not make its implementation optional for the release.

Keep drafts and uploads private. Publish changes content, appearance, assets, and additional pages together. GitHub refreshes, private-access removal, and contact delivery operate independently of Publish.

Follow the confirmed Next.js/OpenNext, Cloudflare D1/R2, three-Worker architecture with Better Auth, GitHub/Google, and Resend.

## How to complete a phase

Before starting feature work, create a branch named `<type>/<short-description>` using the types and lowercase kebab-case convention in [AGENTS.md](../AGENTS.md), such as `feat/initial-setup` or `docs/onboarding-plan`. Leave existing shared branch names unchanged.

Create a directory at `specs/YYYY-MM-DD-feature-name/` for that work, using the start date and feature name. Add these files before implementation:

- `plan.md` contains a series of numbered task groups for the implementation.
- `requirements.md` records the scope, decisions, and context.
- `acceptance-criteria.md` defines how to verify that the implementation succeeded and is ready to merge.

Work sequentially unless a phase explicitly identifies an independent dependency. Read the relevant source sections before implementing; the short scopes below do not replace their detailed requirements. Complete the phase's check and record evidence against the acceptance criteria, then ask the owner whether to check it off. Check it only after explicit owner approval of implementation completion. Approval of this planning update does not complete any implementation phase. Run relevant failure and access-control checks as each capability arrives, then run the complete acceptance review before launch.

Use the confirmed settings in [architecture section 13](architecture.md#13-testing-strategy-mapped-to-acceptance-criteriamd), including upload byte limits, contrast standard, browser/viewport coverage, GitHub refresh intervals, contact budgets, retry deadlines, and provider fixtures. Do not invent replacement values. The theme/font/decoration catalog still needs its separate design decision and approval. Phase 11E extracts that existing decision from pending appearance work so draft defaults are approved before provisioning and dependent validation. It does not add an onboarding appearance step.

## Foundation and feasibility

Resolve the [architecture spikes](architecture.md#15-risks-and-spikes) before depending on their assumptions. Record measurements and decisions. If a spike fails, choose a compatible implementation or revisit the architecture before continuing. Deferring private GitHub activity, as one architecture fallback suggests, would change the agreed MVP and cannot count as completing this roadmap.

### Phase 01. Establish the repository and local runtime

- Set up the planned workspace, `web`, `site`, and `jobs` apps, shared packages, strict TypeScript, pinned dependencies, and local Cloudflare bindings. Add the baseline build, lint, and test commands.
- [x] Complete when all three apps run locally with persisted development resources and CI can build the skeleton. Production configuration remains separate from local fixtures and secrets.

### Phase 02. Measure publish rendering

- Run spike S-1 with representative worst-case portfolio, case-study, and resume pages in workerd.
- S-1 ran on October 15, 2026. Whole-page rendering exceeded the local budget; [measurements and a revised bounded approach](../specs/2026-10-15-publish-render/results.md) are recorded. The owner approved Phase 02 completion on October 15, 2026, under the recorded-revised-approach condition.
- [x] Complete when CPU measurements support a bounded rendering approach within the intended plan, or a revised approach has been recorded before implementing publication.

### Phase 03. Measure the app and API runtime

- Run S-2 with an OpenNext skeleton, Better Auth session check, and D1 write. Measure startup and request CPU.
- October 15, 2026: [deployed/local evidence and the required hot-API runtime revision](../specs/2026-10-15-app-runtime/results.md) are recorded. Startup passes; the original request CPU assumption fails. The replacement still needs measurement. The owner approved completion on October 15, 2026 under the criterion that the required endpoint/runtime changes have been decided.
- [x] Complete when the framework and API approach meets the architecture's limits, or the required endpoint/runtime changes have been decided.

### Phase 04. Prove hostname and asset routing

- Run S-3 and S-4, with S-10's domain availability and registration dependency. Check the apex, wildcard portfolios, reserved hosts, asset-host exclusion, TLS, and static-request accounting.
- October 15, 2026: [production routing/TLS and asset-accounting evidence](../specs/2026-10-15-host-routing/results.md) is recorded. The owner already registered the domain and approved temporary test routing. All 36 deployed host/path/method checks pass; accounting observations retain adaptive-sampling limitations. The owner approved completion on October 15, 2026.
- [x] Complete when routing and quota assumptions have evidence. Document any external setup still required; local host simulation alone does not pass production routing checks.

### Phase 05. Prove authentication behavior

- Run S-5 with GitHub and Google fixtures, workerd/D1 sessions, cookie isolation, verified-email linking, and proof of ownership.
- October 15, 2026: [26 local provider-fixture and Chromium cookie checks](../specs/2026-10-15-auth-behavior/results.md) pass. The tested configuration includes strict apex/Origin guards and verified-only linking. Live provider applications and deployed callbacks remain unverified; owner approval to check off the phase is pending.
- [x] Complete when both providers work and missing or unverified emails cannot merge accounts. Record the supported cookie and account-linking configuration.

### Phase 06. Prove GitHub permissions

- Run S-6 with public and explicitly authorized private contribution fixtures. Separate sign-in permissions from private-activity authorization.
- October 15, 2026: [fixture and live provider evidence](../specs/2026-10-15-github-permissions/results.md) are recorded. Forty workerd/D1/Web Crypto checks pass. Live matching-account authorization, both profile-visibility settings, anonymized calendar projection, grant deletion, independent sign-in, and external-revocation detection pass. Visibility-off results separate 425 public from 818 authorized contributions. The owner approved Phase 06 completion on October 15, 2026, with the separate no-scope platform credential check explicitly recorded as untested.
- [x] Complete when matching-account access, anonymized counts, and revocation detection meet the full MVP requirements.

### Phase 07. Prove email delivery

- Run S-7 with the sending domain, verification mail, contact mail, and failure notices. Confirm the provider's quota behavior and the planned email budget guard.
- October 15, 2026: [local fixture and live delivery evidence](../specs/2026-10-15-email-delivery/results.md) are recorded. All 63 workerd/D1 checks pass. Resend confirms the sending domain and SPF/DKIM, and all three authorized email types reached delivered status. Quota behavior uses controlled fixtures. The owner approved Phase 07 completion on October 15, 2026.
- [x] Complete when each email type can be delivered and controlled rejection, timeout, and quota fixtures are available.

### Phase 08. Prove workflow execution and asset withdrawal

- Run S-8 with multi-page and concurrent publication, then S-9 with published asset removal and cache purge.
- October 15, 2026: [workflow/storage experiments, live asset withdrawal evidence and required fallback](../specs/2026-10-15-workflow-assets/results.md) are recorded. The deployed three-page stress test hits the per-invocation API cap, and the fragment-per-step design exceeds the Free daily step allowance at the planned volume; Queue/D1 batching and browser/query cache policy require validation before publication. The owner approved Phase 08 completion on October 15, 2026, with these fallback requirements recorded.
- [x] Complete when bounded workflow steps can finish and withdrawn assets stop serving through the public origin and CDN. Record any required fallback before building the publish pipeline.

## Accounts and recoverable drafts

### Phase 09. Define the draft and component contracts

- Create the versioned draft schema, sample markers, rich-text allowlist, asset references, component registry, and migration contracts. Declare the full MVP component list and singleton rules, with multiple text sections allowed.
- October 15, 2026: [contract implementation and validation evidence](../specs/2026-10-15-draft-component-contracts/results.md) are recorded. All 123 contract tests and all 139 repository tests pass, along with lint, typechecks and the full build. The owner approved Phase 09 completion on October 15, 2026.
- [x] Complete when valid drafts round-trip, unsafe content and invalid component structures fail validation, and schema/component migrations preserve content.

### Phase 10. Establish persistence and owner boundaries

- Add Drizzle migrations and owner-scoped repositories for portfolios, assets, publication versions, claims, connected services, outbox records, and counters. Enforce one portfolio per account.
- October 15, 2026: [persistence implementation and access-control evidence](../specs/2026-10-15-owner-persistence/results.md) are recorded. All 29 workerd/D1 integration groups, 139 unit tests, lint, typechecks, builds, and the three-Worker runtime smoke test pass. The owner approved Phase 10 completion on October 15, 2026.
- [x] Complete when local migrations and fixtures work and another owner cannot read or mutate private records. Mutating APIs check origin and session state.

### Phase 11. Implement sign-up and sign-in

- Build GitHub and Google authentication using the proven configuration. Include cancellation, failure, retry, sign-out, and authenticated editor access.
- October 15, 2026: [implementation, automated checks and real-provider evidence](../specs/2026-10-15-sign-in/results.md) are recorded. All 21 workerd/D1 auth groups, nine Chromium journey checks, 143 unit tests, lint, typechecks, builds, 31 persistence groups and runtime smoke checks pass. The owner completed real GitHub/Google sign-in, returning sign-in, sign-out, Google cancellation and retry locally; D1 confirms the same verified account without duplicates. Production callback/TLS and CPU checks remain for deployment verification. The owner approved Phase 11 completion on October 15, 2026.
- [x] Complete when either provider opens the correct account, signed-out editing fails, and authentication recovery preserves account identity. Password and email-only sign-in are absent.

### Phase 11A. Verify the revised owner API runtime

- Dependencies: completed Phases 01, 03, 05, 10, 11 and the recorded S-2 revision.
- Implement and measure the thin Hono/jobs owner-API approach through internal bindings with the real session/deletion checks, representative draft validation, and the 1 MiB boundary. Include the planned content/progress write path; keep source identities scoped to each request.
- October 16, 2026: [thin owner API measurements](../specs/2026-10-16-owner-api-runtime/results.md) fail for full-body 1 MiB saves. The owner requested implementation/testing of the [bounded-save follow-up](../specs/2026-10-16-free-owner-saves/results.md) and approved URL/email byte limits. The reusable repository, isolated integration, CPU/quotas and rollback points are recorded there. Production mapping and autosave remain in their phases. The owner approved Phase 11A completion on October 16, 2026.
- [x] Complete when measured CPU/startup evidence supports dependent APIs under the confirmed budget, or a revised compatible approach has been agreed before proceeding. No paid-plan assumption or old completion checkbox substitutes for this follow-up.

### Phase 11B. Extend contracts and persistence for initial setup

- Dependencies: 09, 10, 11A and the agreed onboarding specification.
- Add a versioned non-unique `requestedSubdomain` draft field, separate private progress, and a permanent first-editor-entry milestone with revision-aware owner-scoped storage. Preserve content/sample-marker compatibility and exclude setup metadata from public snapshots. Do not put an unclaimed candidate in the current unique claimed-subdomain column.
- [ ] Complete when migrations preserve version 1 fixtures/content, two owners can save the same candidate without a claim, repeated creation retains one portfolio, and stale updates/another owner cannot reset milestones or overwrite content/progress. This is follow-up work to completed Phases 09 and 10.

### Phase 11C. Verify the separate public GitHub credential

- Dependencies: 06 and its recorded outstanding platform-credential check.
- Close S-6's untested live public baseline using a separate platform-only credential and controlled accounts with public/private visibility cases. Do not substitute a sign-in token that can expose authorized activity.
- [ ] Complete when live evidence establishes the safe public contribution baseline and a documented failure/retry setup for dependent graph work. Preserve Phase 06's historical completion and its original limitations.

### Phase 11D. Reconcile GitHub storage and refresh contracts

- Dependencies: 09, 10, 11A, 11C and S-6's tested projection/generation rules.
- Add connection generations and conditional writes for refresh successes and errors. Reconcile `privateCounts` with the complete authorized calendar; select public or authorized data without addition/subtraction. Gate public output by matching published configuration and current authorization. Define encrypted retryable activity-grant cleanup and serialize grant-wide revocation with new consent for the same app/account, so stale cleanup cannot revoke a fresh grant.
- [ ] Complete when migrations/fixtures prove non-additive counts, no pre-Publish private exposure, and stale jobs cannot restore withdrawn data or invalidate newer grants. Include remove, failed remote cleanup, attempted reconnect, and delayed cleanup retry. Unknown legacy authorized caches require safe refetch rather than reinterpretation as complete calendars. Production graph/OAuth UI remains Phases 40–42.

### Phase 11E. Approve catalog identifiers and portfolio defaults

- Dependencies: architecture Q-3, the existing read-only Figma direction, and the product's single-template/three-theme scope.
- Perform the existing catalog decision previously grouped into Phases 35 and 37: obtain approval of themes, curated fonts, decoration assets, and the configured default theme/font/mode used by new drafts. Record identifiers/assets for later controls and verification. This is an extracted prerequisite, not a new theme picker or an approved catalog by implication.
- [ ] Complete when the owner has approved the catalog and the default identifiers can be used by provisioning, the basic renderer, and validation. Phases 35 and 37 implement their respective controls using this decision.

### Phase 12. Provision the single private starting portfolio

- Dependencies: 11B, 11E and completed authentication.
- Provision the preselected template and approved defaults once, with empty owner fields, no inserted sample profile/project, and recoverable private setup metadata. Keep provider identity separate until reviewed/accepted. Initialization must never overwrite an existing draft.
- [ ] Complete when new/repeated/concurrent authenticated setup returns exactly one recoverable private draft, no template picker or invented content, and explicit provider-avatar acceptance remains required.

### Phase 13. Implement revision-aware draft and progress APIs

- Dependencies: 11A, 11B, 12.
- Add validated reads/saves with stored revision and atomic compare-and-swap. Save content and private progress consistently, enforce the draft-size cap and ownership checks, and protect the permanent milestone against stale updates.
- Integrate the [measured bounded-save repository](../specs/2026-10-16-free-owner-saves/protocol.md) with the permanent 11B progress contract and portfolio columns. Add staging tables through a production migration and strict product action schemas. Preserve changed-field saves, explicit recovery and bounded cleanup; do not expose the failed full-body save experiment.
- [ ] Complete when saves return confirmed revisions, stale content/progress saves return conflicts without overwriting newer state, and no save changes a published version or claims a candidate address.

### Phase 14. Add shared autosave and local recovery

- Dependencies: 13.
- Share autosave for onboarding/editor content, order, appearance, ready asset references, and setup progress. Show Saving, Saved, and Couldn't save with Retry. Preserve invalid unfinished input locally without claiming it is saved across devices; make applicable recovery available after handoff.
- Coalesce changed-field updates and orchestrate the bounded protocol for large edits. Coordinate the single owner attempt across tabs/devices, recover lost start/commit replies, and offer explicit resume/discard after reauthentication. Respect the [measured request/read/write budgets](../specs/2026-10-16-free-owner-saves/quotas.md); a full upload after each keystroke is outside that model.
- [ ] Complete when reopening after Saved restores exact valid values/progress across sessions, same-browser invalid input survives controlled interruption, recovery stays owner/portfolio-scoped, and failures never report false Saved.

### Phase 15. Handle conflicting edits and expired sessions

- Dependencies: 14 and existing auth recovery.
- Offer Load newer version or Keep my edits for review for setup/editor conflicts. Reauthenticate without discarding recoverable input and return to the controlled pending flow. Prevent a stale setup tab from resetting a later editor-entry milestone.
- [ ] Complete when two tabs/devices cannot silently overwrite content/progress, reauthentication saves the preserved draft, and post-handoff setup tabs cannot reinitialize the portfolio.

## Shared editor and publication foundations

Build the shared primitives before onboarding adapters. Earlier editor/publication checks use explicit owner fixtures representing a successful first-editor handoff; they do not claim that the new signup journey is usable yet. The complete first-user journey becomes testable in Phases 42E–42F after all required setup and optional graph capabilities exist. No partially usable mandatory signup flow is released before then.

### Phase 16. Build the shared portfolio renderer

- Dependencies: 09, 11E, 12 and the recorded rendering constraints.
- Render the fixed profile and component order through shared markup-only components with the approved default styling/font. Establish responsive styling, security headers, and the small public interaction script used by previews and snapshots. Permit honest private rendering of incomplete drafts.
- [ ] Complete when the same fixture renders consistently in private browser preview and publish output with safe links, readable layout, keyboard controls, and unavailable/incomplete states. Onboarding Review later reuses this renderer.

### Phase 17. Build the editor and live preview

- Dependencies: 13–16.
- Add the content/customization panel, component selection, and live preview. Support desktop/mobile editing and viewport-specific iframe preview without server-rendering drafts. The editor must open the existing prepared draft without applying initialization again.
- [ ] Complete when selecting a component opens its controls and edits appear immediately at either preview width. Private preview routes/messages stay owner-only. Use handoff fixtures until setup routing is activated in 42E.

### Phase 18. Implement private upload storage

- Dependencies: 10, 11A, 13.
- Accept JPEG, PNG, WebP, and PDF under the confirmed limits. Check signatures and size server-side, track pending/ready/failed states, and serve drafts only through owner-authorized routes usable during setup and editing.
- [ ] Complete when exact-limit files pass, oversized/disguised files fail, and visitors/other owners cannot fetch assets. Pending/failed/foreign assets cannot satisfy required setup or publication.

### Phase 19. Add shared upload controls and image cropping

- Dependencies: 14, 17, 18.
- Provide upload progress, descriptions, retry, crop/replace/remove, and shared avatar/banner dialogs with repositioning, zoom, Reset, Apply crop, and Cancel. Re-encode locally and reference replacements only after readiness. Store only finished crops, with original-file reselection required to recover excluded regions after returning.
- [ ] Complete when preview matches saved crops, profile controls are usable by keyboard/mobile, cancelled/failed replacements preserve the previous asset, and interruption/retry affects no published file. Reset must not promise durable original retention.

### Phase 20. Edit the required profile and accept provider suggestions

- Dependencies: 17–19 and Phase 11's existing authenticated session/owner boundary.
- Add name, bio, optional editor location, required avatar/banner, and explicit provider-name/photo acceptance. Implement new owner-authorized provider name/photo/email suggestion retrieval and a validated private photo import path using the same crop/upload/readiness checks. Phase 11 did not implement these suggestion/import capabilities. New profiles use no sample identity; compatible older samples still cannot satisfy requirements.
- [ ] Complete when owner-confirmed values/images can be entered, cropped, saved, replaced, or removed and rendered exactly. Provider URLs alone are not assets; failed imports offer upload/retry without false acceptance. These controls later supply the combined onboarding Profile screen.

### Phase 21. Manage social and contact identity

- Dependencies: 13–17, 20.
- Add, edit, remove, and order labeled links with valid HTTP(S) destinations or email addresses. Store profile/social-component placement against one entry. Suggest account email only for deliberate public acceptance; explain its visibility.
- [ ] Complete when one valid profile-displayed email/social/website link satisfies setup/profile requirements, invalid links fail, and a contact form alone cannot substitute. The same controls/data are reused in onboarding.

### Phase 22. Implement unreserved address selection

- Dependencies: 11B, 13–15, 17 and the existing reserved-name/claim contracts.
- Add format/reserved-name/current-availability validation and save the non-unique candidate for onboarding/editor use. Explain that selection is not reservation and allow editor changes until first publication. Atomic claim mutation belongs to Phase 25.
- [ ] Complete when boundary/reserved-name checks pass, two owners can select the same candidate without a claim, and later conflicts are actionable. The address becomes fixed only after successful first publication.

### Phase 22A. Add setup-aware account entry and handoff services

- Dependencies: 11B, 12–22 and completed Phase 11's auth boundaries.
- Implement controlled post-auth resolution for client callbacks, server allowlists, signed-in `/sign-in`, direct editor navigation, and recovery. Add shared authoritative required-setup validation and the idempotent permanent handoff service. Setup saves/uploads/private previews must remain accessible without an editor milestone.
- [ ] Complete when server/fixture checks reject bypass and stale milestone resets, repeated callbacks/handoffs preserve one draft, required-content/save failures remain recoverable, and completed owners always return to the editor. This is explicit follow-up to Phase 11. Activate the complete new-user journey only in Phase 42E after its screens exist.

### Phase 23. Build publication validation and checklist

- Dependencies: 11E, 13, 18–22A and the current component contracts.
- Extend shared authoritative setup checks into publication validation for required profile values, links, ready assets, catalog membership, compatible sample omission, selected address/claim rules, and included components. Resolve a taken onboarding candidate in the editor rather than restarting setup.
- [ ] Complete when each issue opens its control, untouched compatible samples are omitted, and owner-edited/incomplete optional content uses normal validation. Extend checks during later component phases. Setup completion alone must never count as publication readiness.

### Phase 24. Prepare immutable publication versions

- Dependencies: 02, 08, 11A, 16, 18, 23 and successful measurement of the S-8 Queue/D1 batching fallback with the full shared quota/CPU model. Also validate the S-9 browser/query cache requirements before dependent withdrawal behavior.
- Flush autosave and capture the exact saved revision. Snapshot only public portfolio content, exclude private setup/progress metadata, copy only reachable assets, and render using the measured bounded task dispatch. Retain content-hashed platform assets.
- [ ] Complete when a candidate version has a complete manifest without changing the live pointer, and injected failures preserve the old public version and clean uncommitted public assets. Old recorded fallback decisions alone do not prove the implementation feasible.

### Phase 25. Commit and serve a complete version

- Dependencies: 04, 22–24 and the permanently reserved subdomain rules.
- Atomically claim the selected candidate on first Publish and switch the published-version pointer. Build thin public serving for approved hosts, pages, assets, and unavailable states. Keep setup/progress private and exclude unvalidated private graph access from public output.
- [ ] Complete when concurrent first publications produce one claimant, failed commits create no successful claim, and requests serve complete old or new versions. Another owner saving the same candidate earlier confers no ownership; draft routes/assets remain inaccessible.

### Phase 26. Finish publication and republishing primitives

- Dependencies: 14–15, 23–25 and verified S-9 withdrawal/cache policy.
- Add Publish progress, actionable errors, Retry, and public URL Open/Copy. Remove withdrawn public assets and purge caches after successful version changes. Recheck candidate availability and permit a replacement before first publication without rerunning setup.
- [ ] Complete when a profile-only handoff fixture can publish, reopen its saved editor draft, and republish at the same URL. Unsaved edits, unfinished uploads, and failures cannot report false success or corrupt the live site. The real signup-to-publication journey is verified in 42F and 54.

## Optional content and public pages

Add each capability through the shared registry, draft saving, validation, preview, and publishing path. Draft component changes become public on Publish. Confirmed GitHub graph removal also withdraws private access/data immediately under the existing live-data exception; the public component itself is removed on Publish.

### Phase 27. Add the component picker and ordering controls

- Dependencies: 17, 23–26.
- Explain each component's requirements, enforce instance limits, and support drag and drop plus Move up/Move down. Confirm removal of entered content and provide entry ordering. Build controls reusable by guided content adapters; private GitHub withdrawal is integrated in 41.
- [ ] Complete when profile stays first, multiple text sections work, singleton duplicates fail, and keyboard/mobile ordering and cancelled deletion preserve the intended draft.

### Phase 28. Add project cards

- Dependencies: 19, 23–27.
- Implement manual project creation/editing/deletion/ordering with title, summary, image, technologies, individual contribution, and optional code/demo links. Reuse controls and stable entry IDs during onboarding. New owners receive no sample project.
- [ ] Complete when title/summary validation works, partial owner entries remain recoverable and block publication until repaired/removed, omitted optional fields create no empty controls, and published cards match chosen content/order.

### Phase 29. Add safe rich text and text sections

- Use Tiptap for headings, paragraphs, lists, and links. Render only allowed structured content and permit multiple titled text sections.
- [ ] Complete when formatting survives save and Publish, unsafe pasted/submitted HTML or scripts cannot execute, and sections can be edited, reordered, and removed.

### Phase 30. Add project case studies

- Extend the rich-text editor with uploaded images for case studies. Generate and freeze `/projects/{slug}` URLs using the architecture's collision and reuse rules.
- [ ] Complete when cards and case studies publish together, back navigation works, and a published removal returns the unavailable-page state. Title changes after first publication retain the URL.

### Phase 31. Add skills and technology categories

- Dependencies: 23–27.
- Implement one skills component with manually entered names, optional named categories, and entry/category ordering. Onboarding reuses simple name entry; category controls stay in the editor.
- [ ] Complete when grouped/uncategorized entries render in saved order and no ratings or automatic extraction appear. Verify the empty-step-to-no-component adapter behavior later in 42C rather than making this increment depend on onboarding screens.

### Phase 32. Add work experience

- Implement role, organization, dates, current-role status, description, optional organization link, and entry ordering.
- [ ] Complete when ongoing roles require no end date, reversed dates fail with a field error, and published entries and links match the draft. Education remains outside the component library.

### Phase 33. Add the separate social links component

- Render links selected for social-component placement from the shared identity records, while preserving independent profile placement choices.
- [ ] Complete when editing one link updates both selected placements after Publish without duplicate entry and the component follows ordering/removal rules.

### Phase 34. Add resume download and `/resume`

- Manage one PDF with upload, replacement, and removal. Add the optional ordered download component and the themed resume page with embed, download fallback, and Back to portfolio.
- [ ] Complete when page and controls use the same published PDF, invalid included controls block publication, and a removed/unpublished resume stops serving its former file after Publish.

## Appearance and complete preview

### Phase 35. Add preset appearance controls across pages

- Dependencies: the approved catalog/defaults from 11E, renderer 16, and completed portfolio/case-study/resume capabilities through 34.
- Reuse the catalog decision rather than repeat it. Add exactly three preset-theme controls, curated self-hosted fonts, and initial light/dark/system mode across page types. The existing default styles support setup without adding an appearance step.
- [ ] Complete when approved presets/fonts apply across all pages without changing content, order, or template, and visitor mode switching works on each page type.

### Phase 36. Generate coordinated custom colors

- Generate both mode palettes from one selected color, explain automatic adjustments, and allow reset to the selected preset.
- [ ] Complete when supported presets and a seed-color sweep meet the confirmed contrast standard and all tokens update immediately in preview. Individual palette editing remains absent.

### Phase 37. Add decorations and Face Reveal setup

- Dependencies: 11E, 19, 35–36 and the existing Face Reveal publication rules.
- Reuse the approved decoration gallery and add editor controls plus the optional Face Reveal second-image toggle/upload/crop/replace/remove/description. Explain public accessibility of the published photo. Keep these controls out of onboarding.
- [ ] Complete when Face Reveal defaults off, enabled incomplete uploads block publication, disabling retains a ready second photo privately, and custom decoration uploads remain absent.

### Phase 38. Add Face Reveal interaction and withdrawal

- Implement the reversible diagonal wipe, stable image dimensions, decoration overlay, keyboard controls, changing accessible label, visual cue, and reduced-motion switch.
- [ ] Complete when every page load starts with the original avatar and preview matches public behavior. Disabling and republishing removes the second photo from public storage/cache while preserving the private draft asset.

### Phase 39. Finish full-page draft preview

- Add authenticated saved-draft navigation for portfolio, case studies, and `/resume`. Exercise outbound links, theme switching, Face Reveal, and embedded/download resume behavior.
- [ ] Complete when preview routes are private, noindex, and no-store, and preview-only contact forms cannot send messages. Later contact phases add the explicit settings test action.

## Connected activity and message delivery

### Phase 40. Add public GitHub graph setup

- Dependencies: 06, 11C–11D, 13–17, 23–27 and the shared preview/serving path.
- Implement the production graph service, safe public fetch, detected/manual username, profile link, status, Retry, and rendering. Both signup providers explicitly add a graph. Provide owner-authorized draft data and public endpoints that use the matching published configuration.
- [ ] Complete when zero contributions succeed, missing/failed initial fetches block publication of that graph but do not break the draft/portfolio, Google owners can use a username without sign-in linking, and tested public responses contain no authorized private calendar. Onboarding reuses this setup.

### Phase 41. Add private activity, consent recovery, and withdrawal

- Dependencies: 06, 11D, 15, 40 and the existing cache-purge boundary.
- Implement separate `read:user` activity consent for either signup provider with state/PKCE/owner-session/identity checks. Encrypt tokens, select the authorized calendar safely, require a successful fetch, and expose no private repository details. Add Retry/public-only/later-repair states and reusable controlled consent returns.
- Implement immediate local/cache withdrawal and durable remote revocation on disconnect, mismatch/revocation, or confirmed graph removal. Advance generation and reject stale results/errors. Coordinate grant-wide cleanup and new private consent for the same app/account; do not start new consent while prior cleanup is pending/in flight. Graph removal explains withdrawal and preserves GitHub sign-in; Skip preserves content/grants. Phase 47 later reuses this cleanup.
- [ ] Complete when public/private preview and published output obey consent and Publish boundaries, failure/mismatch never silently changes the selected user, incomplete setup is repairable in the editor, and withdrawal removes private data without Publish despite racing jobs or failed remote revocation. A delayed old cleanup must not revoke newly authorized access; pending private cleanup cannot block public-only setup or editor entry.

### Phase 42. Refresh GitHub activity independently

- Dependencies: 40–41 and the shared job/runtime/quota checks.
- Add six-hour refresh-on-visit TTL and daily private sweep with deduplication, bounded work, stuck-job recovery, and connection-generation writes. Reuse the same graph service for editor and onboarding.
- [ ] Complete when graphs update without Publish, transient failures preserve last good data/date, Retry/Reconnect works, revocation withdraws data on next refresh/sweep, and stale responses/errors cannot restore removed access or corrupt a new grant.

## Initial setup and guided content

All shared editor/content/GitHub phases above are prerequisites rather than duplicate onboarding implementations. Keeping Phases 27–42 before these adapters preserves their existing IDs and provides every editor capability that the guide collects. Location, categories, case studies, other components, and appearance controls remain editor-only. All checks below include the applicable ON criteria in AC 2.

### Phase 42A. Build the guide shell, progress, and Address screen

- Dependencies: 11A–11B, 12–17, 22–22A, 35, and the confirmed read-only UI direction.
- Add the focused responsive step shell, progress/navigation, saved-step resume, and first required Address screen. Use the same unreserved candidate and availability checks as the editor, with no initial skip/editor bypass. Preserve local recovery and revision conflicts.
- [ ] Complete when ON-01/02/13/14/19 pass for this increment, two owners can select the same name without a claim, and required navigation cannot be forged. Do not activate an incomplete required signup journey yet.

### Phase 42B. Add the combined Profile and required Links screens

- Dependencies: 19–22A, 42A.
- Adapt shared profile/import/crop controls into one name/bio/avatar/banner screen with both previews. Add required labeled profile links, provider suggestions, explicit acceptance, and public-email disclosure. There is no skip until these required screens pass.
- [ ] Complete when ON-03/04/05 and relevant upload/ownership checks pass, ready owned images and at least one valid displayed link are required, and no sample starter or duplicate links are inserted.

### Phase 42C. Add optional Skills and Projects adapters

- Dependencies: 27–28, 31, 42B and shared saving/recovery.
- Reuse the entry controls for ordered skill names and multiple projects with the agreed fields. Add Skip this step and Skip remaining steps after required setup; preserve entered partial content and stable IDs. Keep categories and case studies in the editor.
- [ ] Complete when the available content/persistence portions of ON-06/07/12/13 pass: empty skips create no components, incomplete projects survive with normal publication blockers, and Back/retry does not duplicate entries. Verify a stable remaining-steps navigation intent here. Actual Review navigation and full ON-06/12 integration are completed in 42E–42F, not prerequisites to this increment.

### Phase 42D. Integrate optional public/private GitHub onboarding

- Dependencies: 40–42, 42B–42C and controlled account/consent routing from 22A.
- Adapt the shared graph service for both signup providers and return private consent to the preserved step. Offer explicit Add graph, Retry/public-only/later repair, and confirmed removal/withdrawal. No separate onboarding OAuth app, fetch implementation, or sign-in linking behavior.
- [ ] Complete when ON-08 through ON-11 pass in the guide, cancellation/mismatch/session expiry preserves input, zero/failure/private states are honest, and no optional graph failure becomes a mandatory editor gate.

### Phase 42E. Add Review, first editor handoff, and route activation

- Dependencies: 16–17, 22A–26, 35, 40–42, 42A–42D.
- Render the actual saved private portfolio with desktop/mobile switching, Back, incomplete statuses, and Open editor. Route all remaining-step skips here. Flush valid saves and reuse the authoritative idempotent handoff service; retain applicable local optional recovery. Activate the complete controlled post-auth entry resolver only now.
- [ ] Complete when ON-06/12/15/16/17/18 pass, including actual Skip remaining navigation to Review. The editor receives exact prepared content, all-optional-skipped owners see only their real profile/links, no route exposes drafts publicly, and later missing required content blocks Publish without rerunning onboarding.

### Phase 42F. Verify onboarding recovery and the full new-user journey

- Dependencies: 42E and the actual publication/GitHub paths through 42.
- Run ON-01 through ON-19 with both signup providers, completed/skipped/partial optional content, two tabs/devices, another owner, invalid local input, failures, crop/import retry, authorization return/removal, address collisions, and permanent handoff. Compare saved values with Review/editor and published output.
- [ ] Complete when recorded automated browser/viewport/provider-fixture checks pass and no new work is marked complete without owner approval. Phase 53 still performs the full cross-feature acceptance review, and Phase 54 retains target-user timing/launch checks.

## Message delivery

### Phase 43. Add email adapters and recipient verification

- Implement the console development provider and Resend adapter, shared email budgets, and recipient setup using the verified account email or a newly verified address.
- [ ] Complete when missing/changed/unverified recipients block form publication and public HTML/data never expose the recipient. Verification and owner notices respect their reserved allowance.

### Phase 44. Accept contact submissions safely

- Add the public form and same-origin endpoint with field errors, Turnstile, submission limits, and atomic budget reservation plus durable outbox insertion.
- [ ] Complete when success means accepted for delivery, blocked/limited/failed submissions report no false success, and competing requests cannot exceed the confirmed budgets. Public endpoints reject unavailable portfolios.

### Phase 45. Deliver messages, retry, and test setup

- Add idempotent delivery, the confirmed retry schedule/deadline, stuck-outbox recovery, payload deletion, and final-failure notices/status. Add explicit Send test message in settings under its daily limit.
- [ ] Complete when controlled failures exercise delivery and exhaustion, test messages report outcomes, and preview submissions send nothing. Deferred owner notices remain visible as failures in the editor. No inbox, attachments, or automatic replies appear.

## Sharing and account lifecycle

### Phase 46. Add search and sharing metadata

- Derive title, description, and sharing-image defaults from the profile; provide owner overrides and sharing preview. Render page-specific metadata, robots, and sitemap output into published versions.
- [ ] Complete when served metadata matches the published values, public pages permit indexing, and drafts remain private. Removed pages stop serving former metadata at the origin.

### Phase 47. Finish connected-provider settings

- Dependencies: 11, 22A, 41 and the existing account ownership/linking rules.
- Show providers, allow ownership-proven sign-in linking/disconnect, and prevent removing the final usable sign-in method. Reuse Phase 41's separate activity-grant cleanup when GitHub sign-in is explicitly disconnected; activity consent/removal alone must not add/remove a sign-in provider.
- [ ] Complete when remaining sign-in providers reopen the same editor portfolio without rerunning setup, and disconnect/reconnect integrates activity cleanup without duplicating its implementation.

### Phase 48. Add unpublish and restore

- Remove access to portfolio, case studies, resume, live endpoints, and public assets while preserving the private draft and subdomain reservation. Purge public caches.
- [ ] Complete when old page/asset URLs no longer expose content, another account cannot claim the address, and republishing restores the saved portfolio at that address.

### Phase 49. Add permanent account deletion

- Dependencies: 10, 11B, 18, 24–26, 41, 48 and retryable cleanup.
- Explain loss and require confirmation. Immediately deny public/owner access, invalidate sessions, revoke grants, and retry removal of draft content, private setup/progress/milestone data, uploads, snapshots, local recovery, and account records. An unclaimed candidate leaves no reservation.
- [ ] Complete when cached sessions cannot bypass deletion and cleanup failures recover. Only a previously claimed subdomain's ownerless permanent reservation survives; cancellation preserves the account.

### Phase 50. Complete discovery and the example portfolio

- Dependencies: the full capabilities presented, including 42E–42F.
- Build the entry page with examples, free one-portfolio offer, public-subdomain explanation, and Start building. Explain required initial setup with optional content steps; do not promise a direct editor bypass or early address reservation. Publish the internal example through the real renderer.
- [ ] Complete when visitors can inspect the example/appearance options, understand the offer and required setup, authenticate, and reach the complete first-user flow.

## Operations and release checks

### Phase 51. Add operator controls and cleanup

- Dependencies: shared publication/lifecycle/GitHub/email capabilities and setup persistence from 11B.
- Add suspension/unsuspension, abuse reporting, rerender, purge, outbox inspection, audited operator lookup, bounded garbage collection, and audit cleanup. Protect assets referenced by unfinished setup/partial drafts and delete abandoned unreachable uploads under the existing GC policy. Keep operator controls out of the product UI.
- [ ] Complete when suspension blocks serving, lookup audits exclude email and are removed with accounts, and cleanup cannot delete active setup assets or retain deleted-account setup data. No source-image retention is introduced.

### Phase 52. Prepare production delivery and recovery

- Dependencies: all feature/lifecycle increments, including 11A–11D, 22A, 42A–42F and the measured publication/withdrawal revisions.
- Configure backward-compatible migrations and GitHub Environment approval for jobs/site/web deployment order. Include setup state/candidate migrations, activity OAuth returns/revocation cleanup, both signup callbacks, secrets, cache purge, abuse email, and bindings. Add operational logs, quota/CPU alerts, restore/rollback, and renderer retention/rerender checks.
- [ ] Complete when CI and release config cover the architecture's required checks, the full guide is available before required routing is activated, and rollback preserves drafts/milestones. Re-verify provider limits before launch; no application rewrite is needed for the approved upgrade path.

### Phase 53. Run the complete acceptance review

- Dependencies: all preceding implementation and operational phases.
- Run every numbered criterion, including ON-01 through ON-19, with new/returning owners, visitors, and another owner. Cover all optional completion paths, publication/claims, races/failures/recovery/deletion, and live-data exceptions. Compare actual values across onboarding, Review, editor, and public output.
- [ ] Complete when checks pass with recorded evidence across the confirmed browser/viewport matrix, including keyboard/focus, contrast, crop dialogs, recovery, private consent, reduced motion, and deferred-scope exclusions. Do not add real-device/assistive-technology verification requirements beyond the confirmed scope.

### Phase 54. Validate the journey and release the MVP

- Dependencies: 11E, 50, 52–53 and the full new-user journey from 42F.
- Run discovery through required Address/Profile/Links, skipped optional steps, Review, editor, first Publish, and later republish with target users whose content is ready. Also gather feedback on optional/partial paths and owner/visitor understanding; fix failures and repeat affected checks.
- [ ] Complete when the unchanged under-15-minute profile-only publishing target and full acceptance review pass, the catalog is approved, and production smoke checks pass through real hosts and controlled consent returns. Record qualitative findings without inventing new onboarding timing/completion targets.

After launch, submit `hasaweb.site` to the Public Suffix List as architecture Q-5 requires. Submission acceptance is not an MVP launch prerequisite. Continue monitoring operational limits and failures; expanding the feature scope belongs in a separate roadmap.

## Coverage map

The phase checks are incremental. Phase 53 verifies each acceptance section in full, including interactions that span earlier phases.

| Product and acceptance section | Main implementation phases |
| --- | --- |
| 1. Discover and evaluate | 42E–42F, 50 |
| 2. Account, setup, ON-01 through ON-19 | 05, 11, 11A–11B, 12–15, 22A, 42A–42F, 47 |
| 3. Editor, ordering, and preview | 09, 16–17, 27, 39, 42E–42F, 45 |
| 4. Profile, images, and identity | 18–21, 33, 37–38, 42B |
| 5. Projects and case studies | 28–30, 42C |
| 6. Skills and technologies | 31, 42C |
| 7. Work experience | 32 |
| 8. General text sections | 09, 29 |
| 9. GitHub activity | 06, 11C–11D, 40–42, 42D, 47 |
| 10. Contact and delivery | 07, 43 through 45 |
| 11. Resume | 18, 19, 34, 39 |
| 12. Appearance | 11E, 16, 35–36 |
| 13. Upload handling | 08, 18–19, 24, 26, 34, 37–38, 42B |
| 14. Draft saving and recovery | 11A–11B, 13–15, 22A, 42A–42F |
| 15. Subdomains and publication | 11B, 22–26, 42A, 42E–42F |
| 16. Visitor experience | 16, 25, 30, 34, 35, 38 through 45, 48, 49, 53 |
| 17. Search and sharing | 39, 46, 48, 49 |
| 18. Account lifecycle | 11, 11B, 15, 22A, 26, 41, 42E–42F, 47–49 |
| Cross-feature outcomes and exclusions | 42F, 53–54 |
| Architecture feasibility and operations | 01–10, 11A–11D, 24–25, 42–45, 49, 51–52 |

## Deferred scope

Keep the exclusions in [product.md](product.md#features-deferred-beyond-the-mvp-out-of-scope) out of every phase. They include additional portfolios/templates, education, billing, custom domains, arbitrary layout/CSS, custom decoration uploads/stickers, individual palette editing, automatic project/skill imports, repository statistics, proficiency ratings, structured resume authoring, inbox/attachments/automatic replies, AI generation, collaboration, visitor accounts, multilingual editing, version history, and visitor analytics or cookie-based tracking. Private GitHub contribution activity remains required. The initial guide also excludes repeat onboarding, an editor bypass before required setup, goal/persona surveys, retained source images, and extra screens for editor-only capabilities. These exclusions do not remove any existing full MVP editor feature.
