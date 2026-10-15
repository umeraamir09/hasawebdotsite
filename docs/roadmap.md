# MVP implementation roadmap

Build the full MVP in the order below. Each numbered phase is a small, reviewable increment with a concrete completion check. All phases start unchecked; this document plans work and does not claim that the app already passes any checks. Split a phase further if it cannot be reviewed as one focused change.

## Sources and scope

- [product.md](product.md) defines the required behavior and MVP scope.
- [acceptance-criteria.md](acceptance-criteria.md) defines pass/fail checks. References such as AC 15 refer to its matching feature section.
- [architecture.md](architecture.md) defines the implementation approach and confirmed decisions. Its section 13 resolves verification settings that the acceptance document originally left open.
- [rough-idea.md](rough-idea.md) explains the original concept. Use it for context; the agreed product scope controls what ships.

The release is free. Each account has one portfolio, one preselected template, and one fixed public subdomain after first publication. Implement the fixed profile and every optional MVP component. A component being optional for owners does not make its implementation optional for the release.

Keep drafts and uploads private. Publish changes content, appearance, assets, and additional pages together. GitHub refreshes, private-access removal, and contact delivery operate independently of Publish.

Follow the confirmed Next.js/OpenNext, Cloudflare D1/R2, three-Worker architecture with Better Auth, GitHub/Google, and Resend.

## How to complete a phase

Before starting feature work, create a branch named `Feature/Feature-name`, replacing `Feature` with the feature or work group's name and `Feature-name` with the specific feature name.

Create a directory at `specs/YYYY-MM-DD-feature-name/` for that work, using the start date and feature name. Add these files before implementation:

- `plan.md` contains a series of numbered task groups for the implementation.
- `requirements.md` records the scope, decisions, and context.
- `acceptance-criteria.md` defines how to verify that the implementation succeeded and is ready to merge.

Work sequentially unless a phase explicitly identifies an independent dependency. Read the relevant source sections before implementing; the short scopes below do not replace their detailed requirements. Complete the phase's check and record evidence against the acceptance criteria before checking its box. Run relevant failure and access-control checks as each capability arrives, then run the complete acceptance review before launch.

Use the confirmed settings in [architecture section 13](architecture.md#13-testing-strategy-mapped-to-acceptance-criteriamd), including upload byte limits, contrast standard, browser/viewport coverage, GitHub refresh intervals, contact budgets, retry deadlines, and provider fixtures. Do not invent replacement values. The theme/font/decoration catalog still needs a design decision and approval before appearance verification and launch.

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
- [ ] Complete when the framework and API approach meets the architecture's limits, or the required endpoint/runtime changes have been decided.

### Phase 04. Prove hostname and asset routing

- Run S-3 and S-4, with S-10's domain availability and registration dependency. Check the apex, wildcard portfolios, reserved hosts, asset-host exclusion, TLS, and static-request accounting.
- [ ] Complete when routing and quota assumptions have evidence. Document any external setup still required; local host simulation alone does not pass production routing checks.

### Phase 05. Prove authentication behavior

- Run S-5 with GitHub and Google fixtures, workerd/D1 sessions, cookie isolation, verified-email linking, and proof of ownership.
- [ ] Complete when both providers work and missing or unverified emails cannot merge accounts. Record the supported cookie and account-linking configuration.

### Phase 06. Prove GitHub permissions

- Run S-6 with public and explicitly authorized private contribution fixtures. Separate sign-in permissions from private-activity authorization.
- [ ] Complete when matching-account access, anonymized counts, and revocation detection meet the full MVP requirements.

### Phase 07. Prove email delivery

- Run S-7 with the sending domain, verification mail, contact mail, and failure notices. Confirm the provider's quota behavior and the planned email budget guard.
- [ ] Complete when each email type can be delivered and controlled rejection, timeout, and quota fixtures are available.

### Phase 08. Prove workflow execution and asset withdrawal

- Run S-8 with multi-page and concurrent publication, then S-9 with published asset removal and cache purge.
- [ ] Complete when bounded workflow steps can finish and withdrawn assets stop serving through the public origin and CDN. Record any required fallback before building the publish pipeline.

## Accounts and recoverable drafts

### Phase 09. Define the draft and component contracts

- Create the versioned draft schema, sample markers, rich-text allowlist, asset references, component registry, and migration contracts. Declare the full MVP component list and singleton rules, with multiple text sections allowed.
- [ ] Complete when valid drafts round-trip, unsafe content and invalid component structures fail validation, and schema/component migrations preserve content.

### Phase 10. Establish persistence and owner boundaries

- Add Drizzle migrations and owner-scoped repositories for portfolios, assets, publication versions, claims, connected services, outbox records, and counters. Enforce one portfolio per account.
- [ ] Complete when local migrations and fixtures work and another owner cannot read or mutate private records. Mutating APIs check origin and session state.

### Phase 11. Implement sign-up and sign-in

- Build GitHub and Google authentication using the proven configuration. Include cancellation, failure, retry, sign-out, and authenticated editor access.
- [ ] Complete when either provider opens the correct account, signed-out editing fails, and authentication recovery preserves account identity. Password and email-only sign-in are absent.

### Phase 12. Start the single sample portfolio

- Provision the preselected template with clearly marked sample profile and project content. Track required sample replacement and explicit provider-avatar acceptance.
- [ ] Complete when a new owner gets exactly one recoverable draft, with no template picker, and samples cannot satisfy required publication fields.

### Phase 13. Implement revision-aware draft APIs

- Add validated draft reads and saves using the stored revision and atomic compare-and-swap. Enforce the architecture's draft-size cap and ownership checks.
- [ ] Complete when saves return confirmed revisions and a stale save returns a conflict without overwriting the newer draft. Draft APIs never change the published version.

### Phase 14. Add autosave and local recovery

- Save content, order, appearance, and completed asset references automatically. Show Saving, Saved, and Couldn't save with Retry; retain recoverable unsaved edits locally.
- [ ] Complete when reopening after Saved restores exact values and controlled interruptions preserve unsaved input for successful retry.

### Phase 15. Handle conflicting edits and expired sessions

- Offer Load newer version or Keep my edits for review after a conflict. Reauthenticate after session expiry without discarding recoverable edits.
- [ ] Complete when two tabs/devices cannot silently overwrite each other and a recovered session can save the preserved draft.

## The minimum publishing journey

This group delivers the first complete profile-only publishing journey. It is an intermediate milestone; the remaining phases are required for the full MVP.

### Phase 16. Build the shared portfolio renderer

- Render the fixed profile and component order through shared markup-only components. Establish responsive styling, security headers, and the small public interaction script used by preview and snapshots.
- [ ] Complete when the same fixture renders consistently in browser preview and publish output, with safe links, readable layout, keyboard controls, and unavailable-page states.

### Phase 17. Build the editor and live preview

- Add the content/customization panel, component selection, and live preview. Support desktop/mobile editing and viewport-specific iframe preview without server-rendering drafts.
- [ ] Complete when selecting a component opens its controls and edits appear immediately at either preview width. Draft preview messages and routes remain owner-only.

### Phase 18. Implement private upload storage

- Accept JPEG, PNG, WebP, and PDF under the confirmed limits. Check file signatures and size on the server, track pending/ready/failed states, and serve drafts only through owner-authorized routes.
- [ ] Complete when exact-limit files pass, oversized or disguised files fail, and signed-out visitors and other owners cannot fetch draft assets.

### Phase 19. Add upload controls and image cropping

- Provide upload progress, crop, replace, remove, descriptions, and retry controls. Re-encode images as planned and reference a replacement only after successful upload.
- [ ] Complete when saved crops match preview, failed replacements retain the previous asset, and interrupted uploads can be retried without changing published files.

### Phase 20. Edit the required profile

- Add name, bio, optional location, required avatar/banner, and explicit acceptance of an imported avatar. Distinguish sample images and text from owner-selected values.
- [ ] Complete when required values can be replaced and saved, missing values identify their controls, and the fixed profile renders the owner's exact input.

### Phase 21. Manage social and contact identity

- Add, edit, remove, and order labeled links with valid destinations or email addresses. Store profile and social-component placement choices against the same link entry.
- [ ] Complete when a valid email or supported profile link satisfies the profile requirement, invalid links fail, and a contact form alone cannot satisfy it. Explain that displayed email links are public.

### Phase 22. Implement subdomain selection

- Add format validation, reserved-name checks, availability feedback, and atomic claim storage. Apply the permanent-reservation rules from the architecture.
- [ ] Complete when boundary and reserved-name tests pass, availability is presented without a claim guarantee, and the address becomes fixed only after successful first publication.

### Phase 23. Build publication validation and checklist

- Share authoritative validation between the server and editor. Check owner-entered profile data, valid links, ready assets, sample omission, subdomain rules, and the setup of included components.
- [ ] Complete when each issue opens its relevant control, untouched optional samples are omitted, and edited samples use normal component requirements. Extend these checks in each later component phase.

### Phase 24. Prepare immutable publication versions

- Flush autosave and capture the exact saved revision. Snapshot included content, copy only reachable assets, render pages in bounded workflow steps, and retain content-hashed platform assets.
- [ ] Complete when a candidate version has a complete manifest and does not change the live pointer. Injected preparation failures preserve the previous public version and clean up uncommitted public assets.

### Phase 25. Commit and serve a complete version

- Atomically claim the first subdomain and switch the published-version pointer. Build thin public serving for approved hosts, pages, assets, and unavailable states.
- [ ] Complete when competing first publications produce one claimant, failed commits leave no successful claim, and requests serve complete old or new versions. Draft routes and assets stay inaccessible to visitors.

### Phase 26. Finish first publication and republishing

- Add Publish progress, actionable errors, Retry, and the resulting URL's Open and Copy controls. Remove withdrawn public assets and purge their caches after a successful version change.
- [ ] Complete when a profile-only owner can publish, return to a saved draft, and republish at the same URL. Unsaved edits, unfinished uploads, and publication failures cannot produce a false success or corrupt the live site.

## Optional content and public pages

Add each capability through the shared registry, draft saving, validation, preview, and publishing path. None may update public content merely because the owner edits or removes it.

### Phase 27. Add the component picker and ordering controls

- Explain each component's requirements, enforce instance limits, and support drag and drop plus Move up/Move down. Confirm removal of entered content and provide entry-ordering controls.
- [ ] Complete when the profile remains first, multiple text sections work, singleton duplicates fail, and keyboard/mobile ordering and cancelled deletion preserve the intended draft.

### Phase 28. Add project cards

- Implement manual project creation, editing, deletion, and ordering with title, summary, image, technologies, individual contribution, and optional code/demo links.
- [ ] Complete when title/summary validation works, omitted optional fields create no empty controls, and published cards match the chosen content and order. The initial sample project remains optional.

### Phase 29. Add safe rich text and text sections

- Use Tiptap for headings, paragraphs, lists, and links. Render only allowed structured content and permit multiple titled text sections.
- [ ] Complete when formatting survives save and Publish, unsafe pasted/submitted HTML or scripts cannot execute, and sections can be edited, reordered, and removed.

### Phase 30. Add project case studies

- Extend the rich-text editor with uploaded images for case studies. Generate and freeze `/projects/{slug}` URLs using the architecture's collision and reuse rules.
- [ ] Complete when cards and case studies publish together, back navigation works, and a published removal returns the unavailable-page state. Title changes after first publication retain the URL.

### Phase 31. Add skills and technology categories

- Implement one skills component with manually entered names, optional named categories, and ordering for entries and categories.
- [ ] Complete when grouped and uncategorized entries render in the saved order and no proficiency ratings or automatic extraction appear.

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

### Phase 35. Choose the catalog and add preset styling

- Complete the later design task and obtain the catalog approval recorded in architecture Q-3. Add exactly three preset themes, curated self-hosted fonts, and initial light/dark/system mode.
- [ ] Complete when approved presets and fonts apply across portfolio, case-study, and resume pages without changing content, order, or template. Visitor mode switching works on every page type.

### Phase 36. Generate coordinated custom colors

- Generate both mode palettes from one selected color, explain automatic adjustments, and allow reset to the selected preset.
- [ ] Complete when supported presets and a seed-color sweep meet the confirmed contrast standard and all tokens update immediately in preview. Individual palette editing remains absent.

### Phase 37. Add decorations and Face Reveal setup

- Add the approved decoration gallery and optional Face Reveal toggle with a second image's upload, crop, replace, remove, and description controls. Explain that publishing makes that photo publicly accessible.
- [ ] Complete when Face Reveal defaults off, enabled incomplete uploads block publication, and disabling retains a successful second image privately. Custom decoration uploads remain absent.

### Phase 38. Add Face Reveal interaction and withdrawal

- Implement the reversible diagonal wipe, stable image dimensions, decoration overlay, keyboard controls, changing accessible label, visual cue, and reduced-motion switch.
- [ ] Complete when every page load starts with the original avatar and preview matches public behavior. Disabling and republishing removes the second photo from public storage/cache while preserving the private draft asset.

### Phase 39. Finish full-page draft preview

- Add authenticated saved-draft navigation for portfolio, case studies, and `/resume`. Exercise outbound links, theme switching, Face Reveal, and embedded/download resume behavior.
- [ ] Complete when preview routes are private, noindex, and no-store, and preview-only contact forms cannot send messages. Later contact phases add the explicit settings test action.

## Connected activity and message delivery

### Phase 40. Add public GitHub graph setup

- Add one graph component, detected or manually entered username, profile link, connection/fetch status, Retry, and successful contribution rendering.
- [ ] Complete when zero contributions are valid but missing/failed fetches block new or changed graph publication. Google owners can configure a username, and graph failures do not break the portfolio.

### Phase 41. Add private activity and revoke handling

- Require explicit matching-account authorization, encrypt tokens, and expose only anonymized counts. Disable private activity on username mismatch; remove private access/data on disconnect or detected revocation.
- [ ] Complete when no private repository details enter public responses and private counts disappear without Publish. Available public-only data or an unavailable state replaces them, including after cache purge.

### Phase 42. Refresh GitHub activity independently

- Add the confirmed six-hour refresh-on-visit TTL and daily private-activity sweep, with deduplicated bounded work and recovery of stuck jobs.
- [ ] Complete when graphs update without Publish, failures retain the last good graph/date, and Retry/Reconnect states work. Revocation fixtures confirm removal on the next refresh or sweep.

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

- Show connected providers, allow ownership-proven linking and disconnect, prevent removing the final usable sign-in method, and connect GitHub disconnect to private-activity cleanup.
- [ ] Complete when the remaining provider can reopen the same portfolio and disconnect/reconnect handles authorized capabilities correctly.

### Phase 48. Add unpublish and restore

- Remove access to portfolio, case studies, resume, live endpoints, and public assets while preserving the private draft and subdomain reservation. Purge public caches.
- [ ] Complete when old page/asset URLs no longer expose content, another account cannot claim the address, and republishing restores the saved portfolio at that address.

### Phase 49. Add permanent account deletion

- Explain the loss and require explicit confirmation. Immediately deny public and owner access, invalidate sessions, revoke grants, and run retryable removal of drafts, uploads, snapshots, and account records.
- [ ] Complete when cached sessions cannot bypass deletion and cleanup failures recover. Only a previously claimed subdomain's ownerless permanent reservation survives; cancellation preserves the account.

### Phase 50. Complete discovery and the example portfolio

- Build the entry page with component/customization examples, the free one-portfolio offer, public-subdomain explanation, and Start building. Publish the internal example through the real renderer.
- [ ] Complete when a signed-out visitor can inspect the example and appearance options, understand the offer, and enter authentication. This phase depends on the completed capabilities it presents.

## Operations and release checks

### Phase 51. Add operator controls and cleanup

- Add suspension/unsuspension, abuse reporting, rerender, purge, outbox inspection, and audited operator email lookup with a case reference. Add bounded garbage collection and audit retention cleanup.
- [ ] Complete when suspension blocks serving, operator email access leaves the required audit without logging the email, deletion removes account-linked audits, and unreferenced objects can be cleaned safely. Keep operator controls out of the product UI.

### Phase 52. Prepare production delivery and recovery

- Configure backward-compatible migrations and GitHub Environment approval for the `jobs`, `site`, `web` deployment order. Add structured operational logs, quota/CPU alerts, restore and rollback procedures, and renderer-version retention/rerender checks.
- [ ] Complete when CI runs the architecture's required checks and release configuration covers DNS/TLS, provider callbacks, secrets, cache purge, abuse email, and resource bindings. Re-verify current provider limits before launch and confirm the upgrade path requires no application rewrite.

### Phase 53. Run the complete acceptance review

- Run every numbered criterion with new/returning owners, signed-out visitors, and another owner. Compare all pages/assets before and after Publish; include races, injected failures, recovery, deletion, and live-data exceptions.
- [ ] Complete when functional checks pass with recorded evidence across the confirmed browser and viewport matrix. Audit keyboard/focus behavior, contrast, descriptions, reduced motion, forms, and all deferred-feature exclusions. Follow the architecture's confirmed verification scope rather than adding real-device or assistive-technology test requirements.

### Phase 54. Validate the journey and release the MVP

- Run the complete discovery-to-republish journey and timed profile-only publishing sessions with target users whose content is ready. Gather owner/visitor feedback separately from functional results; fix failures and repeat affected checks.
- [ ] Complete when the under-15-minute publishing target and the full acceptance review pass, the catalog is approved, and the production release passes smoke checks through the real public hostnames. Record qualitative findings without inventing additional success thresholds.

After launch, submit `hasaweb.site` to the Public Suffix List as architecture Q-5 requires. Submission acceptance is not an MVP launch prerequisite. Continue monitoring operational limits and failures; expanding the feature scope belongs in a separate roadmap.

## Coverage map

The phase checks are incremental. Phase 53 verifies each acceptance section in full, including interactions that span earlier phases.

| Product and acceptance section | Main implementation phases |
| --- | --- |
| 1. Discover and evaluate | 50 |
| 2. Account and starting portfolio | 05, 11, 12, 15, 47 |
| 3. Editor, ordering, and preview | 09, 16, 17, 27, 39, 45 |
| 4. Profile, images, and identity | 18 through 21, 33, 37, 38 |
| 5. Projects and case studies | 28 through 30 |
| 6. Skills and technologies | 31 |
| 7. Work experience | 32 |
| 8. General text sections | 09, 29 |
| 9. GitHub activity | 06, 40 through 42, 47 |
| 10. Contact and delivery | 07, 43 through 45 |
| 11. Resume | 18, 19, 34, 39 |
| 12. Appearance | 35, 36 |
| 13. Upload handling | 08, 18, 19, 24, 26, 34, 37, 38 |
| 14. Draft saving and recovery | 13 through 15 |
| 15. Subdomains and publication | 22 through 26 |
| 16. Visitor experience | 16, 25, 30, 34, 35, 38 through 45, 48, 49, 53 |
| 17. Search and sharing | 39, 46, 48, 49 |
| 18. Account lifecycle | 11, 15, 26, 41, 47 through 49 |
| Cross-feature outcomes and exclusions | 53, 54 |
| Architecture feasibility and operations | 01 through 10, 24, 25, 42 through 45, 49, 51, 52 |

## Deferred scope

Keep the exclusions in [product.md](product.md#features-deferred-beyond-the-mvp-out-of-scope) out of every phase. They include additional portfolios/templates, education, billing, custom domains, arbitrary layout/CSS, custom decoration uploads/stickers, individual palette editing, automatic project/skill imports, repository statistics, proficiency ratings, structured resume authoring, inbox/attachments/automatic replies, AI generation, collaboration, visitor accounts, multilingual editing, version history, and visitor analytics or cookie-based tracking. Private GitHub contribution activity remains required.
