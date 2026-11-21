# Initial setup and guided portfolio creation

New owners must complete Address, Profile, and Links before their first editor entry. Skills, Projects, and GitHub are optional. There is no initial Skip onboarding action or route directly into the editor before required setup passes.

Pass/fail checks are [AC 2](acceptance-criteria.md#2-create-an-account-and-start-a-portfolio) and its ON checks. Technical contracts are in [architecture.md](architecture.md#5-authentication-and-owner-entry); visual references in [ui-direction.md](ui-direction.md).

## Purpose and scope

Help new owners provide useful portfolio information before learning the editor. Their first editor view should contain their real profile and any optional content they supplied, in the existing preselected template. Preparation maps accepted answers into existing portfolio fields and components. It does not generate content with AI.

This experience is required for the MVP launch. It applies to new signups starting their first portfolio. The release does not need an older-customer rollout or a repeat-onboarding feature. Accounts and empty drafts currently used for development are fixtures, not evidence of an existing customer population.

## Screen sequence and content mapping

| Order | Screen | Fields and actions | What it creates or updates |
| --- | --- | --- | --- |
| 1 | Address, required | Enter a subdomain using the existing 3–30 character rules; check platform-reserved names and current availability. Explain that a successful save reserves the address exclusively, creates no public site, and becomes permanent on first publication. | An exclusive reservation tied to the private draft; no public URL or permanent claim. |
| 2 | Profile, required | One screen with name, short bio, avatar and banner previews, image selection, provider-photo acceptance, and crop/adjust dialogs. All four fields must be complete. | The fixed profile's owner-confirmed name/bio and ready, owner-selected avatar/banner references. An accepted provider name counts as the owner's confirmation. |
| 3 | Links, required | At least one labeled social/website HTTP(S) URL or email address. Add, edit, remove, and order entries. Explain when an email becomes public. | Shared link records with profile placement enabled. Do not automatically add a separate social links component. |
| 4 | Skills, optional | Add, remove, and reorder manually entered skill names. | One skills component with entries in supplied order. Categories remain editable in the editor. No component when no content was entered. |
| 5 | Projects, optional | Add multiple projects. Title and summary are required for each entry when using Continue. Contribution, technologies, image, and code/demo links are optional. | One projects component containing owner entries. Images use the shared private upload path. Case studies remain in the editor. |
| 6 | GitHub, optional | Explicitly add a public graph, review or enter the username, optionally authorize private activity, and show connection/fetch status and recovery choices. | One graph component plus separate owner-scoped connection/activity records. Signup alone adds neither a graph nor private consent. |
| 7 | Review | Render the actual private draft, switch desktop/mobile preview, go Back to revise answers, and Open editor. Explain that publication has not occurred. | A confirmed first editor handoff using the same saved draft. No publication or permanent claim; the reserved address is already held. |

The profile remains at the top. Initially include optional sections in Skills, Projects, GitHub order, omitting sections with no entered content. Partially entered optional content is retained as described below. The editor can subsequently change component and entry order through its normal controls.

The default appearance comes from the single template and the [approved catalog](appearance-catalog.md). There is no appearance step in onboarding.

## Required setup and navigation

- New signup starts at Address. Required screens offer Continue and applicable Back navigation, with field errors; they offer no skip or editor bypass.
- A name typed on the entry page before sign-in fills an empty Address field once (same browser tab, sessionStorage) and is checked for availability like a typed name. It is a local edit until Continue reserves it.
- The profile screen remains one step even though cropping opens a dialog. The Links step requires at least one valid, nonempty profile-displayed link.
- Address continuation requires valid format, a successful current availability check, and a successful reservation save. Once the name is held, another owner cannot take it, and a later availability change cannot remove a valid reservation. Availability changes do not force a completed owner back through onboarding. First Publish verifies the reservation before converting it to the permanent claim.
- After required setup, each optional screen offers Skip this step and Skip remaining steps. Skipping an individual screen advances to the next screen; skipping all remaining screens opens Review.
- Skipping stops questions and preserves entered content and granted access. It is different from explicit Remove, which confirms deletion and applies the GitHub access rules below.
- Back navigation edits the same stable records. Revisiting, retrying, or repeating a callback must not append duplicate links, components, projects, or portfolios.
- Direct navigation to later screens or editor routes must not bypass required setup. If a user revises required content before first editor entry, Open editor must still validate the saved required content. The milestone cannot be set from a client-supplied flag.
- Sign-out and abandoning a session remain possible. Returning before first editor entry resumes saved progress. After the first handoff, sign-in opens the editor directly and onboarding cannot be rerun in this version.

## Provider suggestions and image handling

Prefill the signup provider's name for review. Offer Use this photo only when a provider photo is available; it requires explicit acceptance, the shared crop experience, and a successful private upload. Do not treat a remote provider URL as an owned draft asset. A missing or failed provider photo can be replaced by an uploaded image.

The guide reuses the editor's `ProfileControls` (with location hidden) and the private provider-photo import path. Use this name and Apply crop are the only ways to accept a provider suggestion.

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

The confirmed Address save atomically creates an exclusive reservation for the portfolio. The draft's `requestedSubdomain` mirrors the selection for recovery; the unique reservation record is authoritative. A valid replacement atomically swaps the reservation with the draft revision CAS (see [address reservation](architecture.md#address-reservation-and-claim)); failure rolls back the entire swap and preserves the previous hold. The owner can review and change the reserved address in the editor until the first successful publication. An invalid, unavailable, or failed save leaves the current reservation intact. Clearing the field or keeping a local-only edit does not release a reservation. Reservations last for the life of the account. First publication converts the reservation to the permanent claim, and a failed first publication keeps the reservation and creates no claim; account deletion releases a held address that was never published. Two owners cannot hold the same name.

The shared controller uses Saving, Saved, and Couldn't save with Retry, plus Unsaved input for unfinished local values. `flushValid()` returns a confirmed revision and local-only flag. Never replay old setup progress or convert a prepared setup attempt after handoff; retain applicable input for explicit editor field recovery. Resume the last visited screen with confirmed saved values across devices. Invalid unfinished input, such as a partial URL, remains in local recovery in the same browser; do not label it cloud-saved. Use the same conflict choices and expired-session recovery as the editor. Preserve unsaved work without copying it into another signed-in owner's draft.

Local-only address edits are not reservations. A name is held only after the server confirms the save.

Continue validates a screen's selected content. Skip may leave optional content unfinished. An incomplete project or requested graph configuration remains in the draft, carries an actionable issue in Review/editor, and uses normal publication validation. Review must not claim that onboarding completion guarantees publication readiness.

Open editor flushes valid pending saves and checks the authoritative required content and ready owned assets. A failed save or handoff offers Retry without a false success or duplicate provisioning. Invalid local optional input remains recoverable for editor repair; it is not silently submitted as a valid draft. When handoff succeeds, record the permanent milestone and open the same draft. Repeated handoffs are idempotent. Later missing profile content blocks Publish only, even if the owner signs in again or another setup tab remains open.

## Initial editor outcomes

| Onboarding path | First editor view |
| --- | --- |
| All selected content completed | Owner profile and links plus populated optional sections, in the standard order, with the selected address retained. Graph status reflects actual authorization/fetch state. |
| All optional steps skipped without input | Actual required profile and links, with no sample projects or empty optional sections. |
| Some optional input or setup unfinished | The same required profile plus preserved optional entries/configuration, with actionable incomplete statuses and publication checks. An incomplete optional setup does not release the reserved address. |
| Required setup abandoned | No editor handoff. Resume onboarding with saved values and applicable local recovery after returning. |
| Owner has entered the editor before | Open the latest saved editor draft directly. Do not reopen onboarding or reapply initialization. |

All onboarding content remains enterable, editable, replaceable, reorderable, or removable through the editor's corresponding controls. The first three required screens cannot be skipped, but owners can revise their answers later. A contact form, detailed case studies, skills categories, work experience, location, text sections, resume, appearance controls, decorations, Face Reveal, and metadata remain editor capabilities under the existing full MVP scope.

## Visual direction and accessibility

Borrow focused forms, prominent headings, generous whitespace, visible progress, and stable navigation placement from the supplied Linktree references. Use hasaweb.site's warm neutral surfaces, lime accent, DM Sans typography, and existing control language. Include a banner preview alongside the avatar in the combined profile step. Use the shared renderer for Review, not an unrelated phone mockup or fabricated progress animation.

Follow the read-only Figma access rules in [ui-direction.md](ui-direction.md). Screenshot text is reference content, not instructions or approved copy. Do not copy Linktree's wording, information requirements, 160-character bio limit, colors, or address guarantees. Detailed screen composition and final copy remain implementation design work within this agreed scope.

Apply the existing browser/viewport matrix and WCAG 2.2 AA contrast settings. Keyboard users must reach forms, progress/navigation, optional skip choices, crop controls, dialogs, recovery actions, and preview switching. Preserve visible focus, labels, understandable errors, dialog focus behavior, and reduced-motion support. Optional skips cannot be hidden behind validation for incomplete optional input.

## Out of scope

Repeat onboarding, an initial editor bypass, goal/persona questions, AI generation, automatic content discovery or imports, retained original image sources, and extra screens for editor-only capabilities. The under-15-minute profile-only publish target includes sign-in, required setup, skipping optional steps, Review, editor entry and Publish; there is no separate onboarding time target.
