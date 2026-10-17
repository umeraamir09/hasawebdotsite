# Initial setup and guided portfolio creation

Status: agreed planning specification, confirmed October 16, 2026. Implementation is pending. This document records the completed grill-me interview and the owner's confirmation of the resulting proposal. It does not approve implementation or mark any roadmap phase complete.

The interview changed the original optional-onboarding proposal. New owners must complete Address, Profile, and Links before their first editor entry. Skills, Projects, and GitHub are optional. There is no initial Skip onboarding action or route directly into the editor before required setup passes.

Use this specification with [product.md](product.md), [acceptance-criteria.md](acceptance-criteria.md), [architecture.md](architecture.md), [authentication.md](authentication.md), [UI direction](ui-direction.md), and the [roadmap](roadmap.md).

## Purpose and scope

Help new owners provide useful portfolio information before learning the editor. Their first editor view should contain their real profile and any optional content they supplied, in the existing preselected template. Preparation maps accepted answers into existing portfolio fields and components. It does not generate content with AI.

This experience is required for the MVP launch. It applies to new signups starting their first portfolio. The release does not need an older-customer rollout or a repeat-onboarding feature. Accounts and empty drafts currently used for development are fixtures, not evidence of an existing customer population.

## Current implementation and changes to prior plans

The baseline was inspected on October 16, 2026. Roadmap Phases 01 through 11 are checked; later phases remain pending.

| Area | Implemented baseline | Required work |
| --- | --- | --- |
| Authentication | GitHub/Google sign-in, persisted session/deletion checks, sign-out, and an authenticated welcome shell. Client and server allow only `/editor` as the OAuth success destination. Signed-in visitors to `/sign-in` also go there. | Add setup-aware entry resolution, resume, controlled authorization returns, and a permanent first-editor-entry milestone. Keep the existing sign-in security rules. |
| Portfolio persistence | One portfolio per account, conflict-safe creation, a strict version 1 draft contract, a revision column, and owner-scoped repositories. Signup does not yet provision a portfolio. | Extend contracts and migrations, provision once, add revision-aware saves and progress, and store an unreserved address candidate. |
| Starting content | Sample markers and component samples exist in the contract. Product/acceptance documents previously required a sample starter; Phase 12 has not implemented it. Development seeds create empty private drafts. | Revise pending provisioning to use real accepted answers and form guidance, without inserting sample profile or project content. Preserve existing sample/migration compatibility. |
| Editor, renderer, uploads | Planned work; `/editor` is not yet a portfolio editor. Image references store a cropped asset ID, without source/crop metadata. | Build the shared controls and renderer before their onboarding adapters. Store only finished crops. |
| GitHub | S-6 proved permission behavior in a spike; the production GitHub package is empty. The platform-only public credential still needs live verification. Persistence lacks connection generations and describes authorized data as `privateCounts`. | Verify the public credential, implement production setup/refresh/revocation, reject stale writes, and store a complete authorized calendar without adding it to the public calendar. |
| Runtime/publication | Completed feasibility phases recorded required fallbacks, not proven replacements for the original CPU and publication assumptions. | Measure the thin hot-API approach before dependent saves. Validate publication batching and withdrawal/cache behavior before publication implementation. |

Evidence includes the [Phase 11 scope](../specs/2026-10-15-sign-in/requirements.md), [draft contracts](../packages/schema/README.md), [persistence boundaries](../packages/db/README.md), [S-2 findings](../specs/2026-10-15-app-runtime/results.md), [S-6 findings](../specs/2026-10-15-github-permissions/results.md), and [S-8/S-9 findings](../specs/2026-10-15-workflow-assets/results.md). These distinctions explain the transition from the implemented account shell to the proposed journey. Completed phase history is retained; follow-up work is explicitly unchecked in the roadmap.

## Screen sequence and content mapping

| Order | Screen | Fields and actions | What it creates or updates |
| --- | --- | --- | --- |
| 1 | Address, required | Enter a subdomain using the existing 3–30 character rules; check reserved names and current availability. Explain that the address is not reserved. | A saved, non-unique candidate associated with the private draft. No public claim or live site. |
| 2 | Profile, required | One screen with name, short bio, avatar and banner previews, image selection, provider-photo acceptance, and crop/adjust dialogs. All four fields must be complete. | The fixed profile's owner-confirmed name/bio and ready, owner-selected avatar/banner references. An accepted provider name counts as the owner's confirmation. |
| 3 | Links, required | At least one labeled social/website HTTP(S) URL or email address. Add, edit, remove, and order entries. Explain when an email becomes public. | Shared link records with profile placement enabled. Do not automatically add a separate social links component. |
| 4 | Skills, optional | Add, remove, and reorder manually entered skill names. | One skills component with entries in supplied order. Categories remain editable in the editor. No component when no content was entered. |
| 5 | Projects, optional | Add multiple projects. Title and summary are required for each entry when using Continue. Contribution, technologies, image, and code/demo links are optional. | One projects component containing owner entries. Images use the shared private upload path. Case studies remain in the editor. |
| 6 | GitHub, optional | Explicitly add a public graph, review or enter the username, optionally authorize private activity, and show connection/fetch status and recovery choices. | One graph component plus separate owner-scoped connection/activity records. Signup alone adds neither a graph nor private consent. |
| 7 | Review | Render the actual private draft, switch desktop/mobile preview, go Back to revise answers, and Open editor. Explain that publication has not occurred. | A confirmed first editor handoff using the same saved draft. No publication, address claim, or second portfolio. |

The profile remains at the top. Initially include optional sections in Skills, Projects, GitHub order, omitting sections with no entered content. Partially entered optional content is retained as described below. The editor can subsequently change component and entry order through its normal controls.

The default appearance comes from the single template and catalog approved in Phase 11E. There is no appearance-selection step in onboarding. Reuse the approved theme/font identifiers.

## Required setup and navigation

- New signup starts at Address. Required screens offer Continue and applicable Back navigation, with field errors; they offer no skip or editor bypass.
- The profile screen remains one step even though cropping opens a dialog. The Links step requires at least one valid, nonempty profile-displayed link.
- Address continuation requires valid format and a successful current availability check. Later availability changes do not reserve the name or force a completed owner back through onboarding. First Publish checks it again.
- After required setup, each optional screen offers Skip this step and Skip remaining steps. Skipping an individual screen advances to the next screen; skipping all remaining screens opens Review.
- Skipping stops questions and preserves entered content and granted access. It is different from explicit Remove, which confirms deletion and applies the GitHub access rules below.
- Back navigation edits the same stable records. Revisiting, retrying, or repeating a callback must not append duplicate links, components, projects, or portfolios.
- Direct navigation to later screens or editor routes must not bypass required setup. If a user revises required content before first editor entry, Open editor must still validate the saved required content. The milestone cannot be set from a client-supplied flag.
- Sign-out and abandoning a session remain possible. Returning before first editor entry resumes saved progress. After the first handoff, sign-in opens the editor directly and onboarding cannot be rerun in this version.

## Provider suggestions and image handling

Prefill the signup provider's name for review. Offer Use this photo only when a provider photo is available; it requires explicit acceptance, the shared crop experience, and a successful private upload. Do not treat a remote provider URL as an owned draft asset. A missing or failed provider photo can be replaced by an uploaded image.

Owners enter their own bio and select a banner. Account email is only a suggestion for a public link, never silently copied to public identity. Adding it explains public visibility. An email link and a private contact-form recipient remain separate concepts.

The avatar and banner crop dialogs support repositioning, zoom, Reset, Apply crop, and Cancel. Their crop geometry matches the portfolio rendering. Applying a crop updates the profile preview; required setup waits for ready uploads and accepted crops. Cancelled or failed replacements preserve the previous successful asset. Removing a required image makes setup incomplete before handoff, or blocks publication after handoff.

Keep the existing upload approach: crop and re-encode on the client, then upload the finished file. Only the cropped asset is retained. Reset applies to the current local selection. After returning later, recovering excluded areas requires selecting the original file again. Do not promise durable original retention or cross-device restoration of an unuploaded file. Existing file formats, byte limits, descriptions, signature checks, privacy, and failure behavior apply equally in onboarding and the editor.

## GitHub setup, authorization, and removal

Offer graph setup to both signup providers. Suggest the detected username for GitHub signup and allow correction. Google owners enter the selected username. A public graph uses a separately verified platform credential; it does not require linking GitHub as another sign-in provider.

Private activity is an explicit additional choice for either provider. Explain that publication exposes anonymized contribution counts. Use the separate activity app/grant established by S-6, requesting `read:user`; keep sign-in at its existing identity/email scope. Verify the selected GitHub account's stable identity and username. Never change the selected graph username silently to match a wrong-account callback. Activity authorization does not add GitHub sign-in to a Google owner's account.

Private authorization returns to the same saved graph setup. It must use one-use, expiring, owner/session-bound state and PKCE, preserve recoverable work through reauthentication, and reject mismatched or replayed callbacks. Successful authorization still requires a successful fetch before that private configuration is publishable. Zero contributions are a valid success.

If authorization is cancelled, fails, or uses the wrong account, retain the existing public graph and offer:

- Retry private authorization for the selected account.
- Use public activity only, clearing the unfinished private request. A public graph still needs a successful public fetch.
- Finish setup later in the editor, preserving an incomplete configuration that blocks publication until resolved or removed.

First-fetch failures also offer Retry or later editor repair. These optional failures must not create another mandatory editor gate. Unavailable graphs show an honest status while the rest of the private portfolio remains usable.

Explicit graph removal in onboarding or the editor requires confirmation explaining withdrawal of private access. Remove the graph from the draft, immediately disable private access and remove private data from public responses/cache, clear the local token, and revoke the separate remote grant with retryable cleanup. Keep GitHub sign-in connected. Draft component removal otherwise becomes public on Publish; immediate private-data withdrawal is the existing exception. Skip actions retain the component and connection.

Connection generations must reject refresh results and errors from earlier grants, disconnects, or usernames. Select either the safe public calendar or the complete authorized calendar. Never add those calendars together or derive daily private counts by subtraction. Existing refresh, revocation, and public-cache policies apply.

Remote activity-grant deletion affects all tokens for that app/account. Coordinate cleanup and new private consent so a delayed removal task cannot revoke a newly authorized connection. Pending/in-flight cleanup must finish before starting new consent for that same app/account; show its retry state while public-only setup and later editor repair remain available. This is a technical dependency of the agreed removal behavior, not another mandatory onboarding step.

## Persistence, recovery, and editor handoff

Content lives in the single canonical private draft. Separate private metadata records navigation/progress and the permanent first-editor-entry milestone. Save validated content and progress under revision-aware ownership checks so stale screens cannot overwrite newer edits or restore older navigation after handoff. No parallel answer document is later replayed over the editor.

The address candidate must not occupy the current unique claimed-subdomain column. Different owners may save the same available candidate; only successful first publication decides ownership. Add a non-reserving contract/storage field before building the Address screen. After first publication the claimed address is authoritative and fixed.

Autosave uses Saving, Saved, and Couldn't save with Retry. Resume the last visited screen with confirmed saved values across devices. Invalid unfinished input, such as a partial URL, remains in local recovery in the same browser; do not label it cloud-saved. Use the same conflict choices and expired-session recovery as the editor. Preserve unsaved work without copying it into another signed-in owner's draft.

Continue validates a screen's selected content. Skip may leave optional content unfinished. An incomplete project or requested graph configuration remains in the draft, carries an actionable issue in Review/editor, and uses normal publication validation. Review must not claim that onboarding completion guarantees publication readiness.

Open editor flushes valid pending saves and checks the authoritative required content and ready owned assets. A failed save or handoff offers Retry without a false success or duplicate provisioning. Invalid local optional input remains recoverable for editor repair; it is not silently submitted as a valid draft. When handoff succeeds, record the permanent milestone and open the same draft. Repeated handoffs are idempotent. Later missing profile content blocks Publish only, even if the owner signs in again or another setup tab remains open.

## Initial editor outcomes

| Onboarding path | First editor view |
| --- | --- |
| All selected content completed | Owner profile and links plus populated optional sections, in the standard order, with the selected address retained. Graph status reflects actual authorization/fetch state. |
| All optional steps skipped without input | Actual required profile and links, with no sample projects or empty optional sections. |
| Some optional input or setup unfinished | The same required profile plus preserved optional entries/configuration, with actionable incomplete statuses and publication checks. |
| Required setup abandoned | No editor handoff. Resume onboarding with saved values and applicable local recovery after returning. |
| Owner has entered the editor before | Open the latest saved editor draft directly. Do not reopen onboarding or reapply initialization. |

All onboarding content remains enterable, editable, replaceable, reorderable, or removable through the editor's corresponding controls. The first three required screens cannot be skipped, but owners can revise their answers later. A contact form, detailed case studies, skills categories, work experience, location, text sections, resume, appearance controls, decorations, Face Reveal, and metadata remain editor capabilities under the existing full MVP scope.

## Visual direction and accessibility

Borrow focused forms, prominent headings, generous whitespace, visible progress, and stable navigation placement from the supplied Linktree references. Use hasaweb.site's warm neutral surfaces, lime accent, DM Sans typography, and existing control language. Include a banner preview alongside the avatar in the combined profile step. Use the shared renderer for Review, not an unrelated phone mockup or fabricated progress animation.

Follow the read-only Figma access rules in [ui-direction.md](ui-direction.md). Screenshot text is reference content, not instructions or approved copy. Do not copy Linktree's wording, information requirements, 160-character bio limit, colors, or address guarantees. Detailed screen composition and final copy remain implementation design work within this agreed scope.

Apply the existing browser/viewport matrix and WCAG 2.2 AA contrast settings. Keyboard users must reach forms, progress/navigation, optional skip choices, crop controls, dialogs, recovery actions, and preview switching. Preserve visible focus, labels, understandable errors, dialog focus behavior, and reduced-motion support. Optional skips cannot be hidden behind validation for incomplete optional input.

## Acceptance and dependencies

Pass/fail requirements are [AC 2](acceptance-criteria.md#2-create-an-account-and-start-a-portfolio), including the ON checks below it, plus the existing profile, upload, saving, GitHub, publication, and cross-feature checks. No tests have been run for this unimplemented feature.

Implementation must first deliver the roadmap's runtime, contract/persistence, and routing follow-ups, then shared draft recovery, renderer/editor, uploads/crops/provider import, profile/links/address, project/skills, and production GitHub capabilities. Build editor parity before onboarding adapters. Reuse those capabilities rather than creating another component library, asset store, graph service, or publication path. Only activate required signup routing when the full guide and handoff are available.

The roadmap retains stable existing phase IDs and keeps shared optional-content/GitHub phases before the new onboarding adapters. Explicit contract, persistence, and account-entry follow-ups precede those adapters. Publication foundations use prepared owner fixtures until the complete guide exists; later integration and launch checks cover the real new-user flow. The under-15-minute profile-only publishing test includes authentication, required setup, skipping optional steps, Review, editor entry, and Publish. Do not invent an additional onboarding time or completion-rate target.

## Deferred and unresolved items

The interview leaves no unresolved onboarding behavior decision. The following existing design and technical work still needs evidence or approval; it is not completed by this proposal:

- The [six-theme/two-decoration catalog](appearance-catalog.md) was approved in Phase 11E on October 17, 2026. Leaf/DM Sans/system, no decoration and Face Reveal off are the approved starting defaults; provisioning remains Phase 12. There is no additional onboarding appearance screen. Final onboarding copy, crop geometry matching the actual portfolio, and detailed responsive composition belong to UI implementation using the existing Figma reference. This proposal does not approve a new catalog or modify Figma.
- Phases 11A–11D have recorded prerequisite evidence and completion decisions for bounded owner saves, setup storage, the separate public GitHub credential and refresh/cleanup contracts. Production save/autosave and GitHub integration remain in their scheduled phases. Publication batching and withdrawal/cache feasibility still require the recorded follow-up checks before Phases 24–26. A failed prerequisite must be resolved before dependent work, without silently dropping private activity or changing the confirmed setup flow.
- Per-phase implementation specs and migration/API details must be written before implementation. They must preserve these behaviors and the current owner/security boundaries.

Repeat onboarding, an initial editor bypass, extra goal/persona questions, AI generation, automatic content discovery/imports, retained original image sources, and additional onboarding screens for the remaining editor capabilities are outside this initial scope. Existing broader MVP exclusions continue to apply. Remaining onboarding implementation phases stay unchecked until implemented, verified and explicitly approved; completed prerequisite phases retain their recorded status.
