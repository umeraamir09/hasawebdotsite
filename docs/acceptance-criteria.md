# Acceptance criteria

This document defines how to verify each MVP feature in [product.md](product.md). Section numbers match the product's feature map. Each numbered criterion is a pass/fail requirement, not a claim that the current implementation passes it.

The [initial setup specification](onboarding.md) was confirmed October 16, 2026. Its required first-user setup and optional content steps replace the previous sample-starter journey. The ON checks in section 2 are additional MVP acceptance requirements, all pending implementation.

Verify owner behavior with a new account and a returning account. Verify public behavior as a signed-out visitor and, for access boundaries, as another signed-in owner. Use known test content and compare the saved draft and published output against it. Exercise failures with controlled authentication, network, upload, save, and delivery failures. Record the observed result for each criterion.

Publication tests must compare the profile, components, case studies, resume, appearance, and assets before and after Publish. Unless a criterion explicitly covers GitHub refreshes, private-access revocation, or contact delivery, draft changes must become public only after a successful Publish.

## 1. Discover and evaluate the builder

Source: [Discover and evaluate the builder](product.md#1-discover-and-evaluate-the-builder).

1. A signed-out visitor can open the entry page and inspect an example portfolio without authenticating.
2. The page names the included components and customization options, shows appearance examples, and states the limit of one portfolio per account.
3. The page states that the MVP is free, shows an example `username.hasaweb.site` address, and explains that publishing requires no purchased domain, hosting configuration, or code.
4. Selecting Start building opens the authentication flow.

## 2. Create an account and start a portfolio

Source: [Create an account and start a portfolio](product.md#2-create-an-account-and-start-a-portfolio).

1. GitHub and Google each support sign-up and sign-in. A signed-out user cannot edit a portfolio. Password and email-only sign-in are absent.
2. Signing in through either provider with the same verified email opens the same account and portfolio. Missing or unverified emails do not automatically merge accounts. Adding a provider requires successful proof of ownership.
3. A new account starts exactly one private portfolio with the preselected template, completes required Address/Profile/Links setup, and reaches Review before first editor entry. No template picker or second-portfolio creation option is available.
4. The initial editor shows the actual accepted profile and supplied optional content in the same draft and live preview. It inserts no sample profile/project and no empty optional component when no content was entered.
5. Required setup and publication reject missing owner profile values and unaccepted avatars. An owner-confirmed provider name is valid; an imported provider photo requires explicit acceptance, cropping, and a ready owned private asset. Any untouched required sample in a compatible older fixture/migrated draft still fails publication.
6. Partially entered optional content survives skips and uses normal publication validation. Existing sample-marker compatibility remains: untouched optional samples in older fixtures/migrated drafts are omitted, and editing a sample activates normal validation. New provisioning inserts no samples.
7. Cancelling or failing authentication displays a retry path. After session expiry, signing in again restores the same portfolio and recoverable edits.

### Initial setup checks

Source: [onboarding.md](onboarding.md). Apply the existing browser/viewport, privacy, upload, conflict, and provider-fixture prerequisites. A passed screen alone does not pass the complete journey.

- ON-01. A new signup starts at Address, then one combined Profile screen, Links, Skills, Projects, GitHub, and Review. Address/Profile/Links have no skip or direct-editor action. Direct URLs, forged progress/milestone values, refreshed pages, and API entry attempts cannot bypass required setup. Shared authenticated setup saves/uploads remain usable.
- ON-02. Address continuation requires valid format, non-reserved status, and a successful current availability check. Save the candidate across reload/devices without creating a claim or live URL. Two owners can save the same available candidate. If another owner claims it later, first Publish reports the conflict and permits a replacement in the editor without rerunning onboarding.
- ON-03. One profile screen collects name, bio, avatar, and banner with both image previews. Missing required values, unaccepted photos, or unready/foreign assets prevent continuation with actionable errors. The provider name is reviewed/confirmed; provider photo use is deliberate. No account email becomes public automatically.
- ON-04. Uploaded and imported avatar/banner images use crop dialogs with repositioning, zoom, Reset, Apply crop, and Cancel, with crop geometry matching the portfolio. Applied results match Review/editor/published output. Reset uses the local selection. Returning later does not promise original-source retention; recovering excluded regions requires reselecting the original file. Failed/cancelled replacements preserve the previous ready asset.
- ON-05. Links requires at least one valid labeled social/website URL or email placed in the fixed profile. Invalid nonempty destinations cannot pass. Adding account email requires deliberate acceptance and a public-visibility explanation. Repeated edits preserve shared link IDs and do not create a separate social component automatically.
- ON-06. After required setup, Skip this step advances one optional screen, and Skip remaining steps opens Review. Both work even with unfinished optional input. Entered content/grants are retained. Skipping empty Skills/Projects/GitHub creates no component; revisiting a step creates no duplicates.
- ON-07. Skills supports manually entered names and add/remove/reorder. Projects supports multiple entries, title/summary validation on Continue, and optional contribution/technologies/image/code/demo fields. Their saved values and order match the editor. Category organization and case studies remain editor capabilities.
- ON-08. Both signup providers explicitly add a graph. GitHub signup suggests a detected username; Google owners can enter one and fetch public activity without linking another sign-in provider. Public and private setup are both available. No graph or private consent is inferred merely from signup or a GitHub social link.
- ON-09. Private consent uses the separate activity grant, matching stable GitHub identity/username, one-use expiring owner/session-bound state, and PKCE. A Google owner authorizing activity gains no GitHub sign-in link. Reject wrong-account, replayed, expired, or other-owner callbacks without changing the selected username or reporting false connection success. Valid consent returns to the preserved graph step, including after supported session recovery.
- ON-10. Cancellation/failure/wrong-account private consent preserves the existing public graph and offers Retry, public-only setup, or later incomplete editor repair. Public-only clears the unfinished private request; it still requires a successful public fetch. Finish later retains an actionable publication-blocking incomplete configuration. First-fetch failure offers Retry/later repair, zero contributions succeed, and optional graph failures do not block editor entry.
- ON-11. Explicit graph removal explains and confirms private-access withdrawal, removes the draft component, disables private output/cache immediately, clears active credentials, and retries remote grant cleanup durably. GitHub sign-in still works. Skipping does not disconnect. Old refresh results/errors cannot restore data or invalidate a newer grant after removal, reconnect, or username changes. Exercise failed remote cleanup, attempted reauthorization, and an old cleanup retry; same-app/account consent waits for prior cleanup and stale provider calls cannot revoke fresh access. Public-only setup and editor entry remain available.
- ON-12. Before publication, Review and the editor show the actual owner profile and entered optional sections in initial Skills/Projects/GitHub order, omitting untouched empty sections. Incomplete entries/configuration have honest actionable statuses, not invented content or a publish-ready success claim. Setup grants and answers expose no private portfolio or private counts publicly before Publish.
- ON-13. Valid content and last-visited progress save with confirmed revision/status and resume across devices. Invalid unfinished input is recoverable in the same browser only, remains identifiable as unsaved, and transfers to applicable editor recovery on handoff. Owner changes cannot load another account's local recovery. Failures show Couldn't save and Retry instead of Saved.
- ON-14. Two setup tabs, or a setup tab and an entered editor, cannot overwrite newer content/progress or reset the permanent milestone. Load newer version and Keep my edits for review preserve values. Repeated provisioning, step submissions, consent callbacks, retries, and handoffs keep one portfolio and stable component/entry IDs.
- ON-15. Review uses the shared renderer, offers desktop/mobile switching and Back, states the portfolio is private, and offers Open editor. Signed-out visitors and other owners cannot fetch its data/assets or graph preview. Review is noindex/no-store. Skip remaining steps also reaches this review.
- ON-16. Open editor flushes valid saves, validates authoritative required content and ready owned assets, and records an idempotent permanent milestone only on successful handoff. Missing required content after Back edits, unsaved valid changes, or failed persistence cannot produce a false successful handoff. Retain optional local recovery and partial draft content without making optional completion a mandatory gate.
- ON-17. After successful first entry, returning sign-ins reopen the latest editor draft. Removing avatar/banner/name/bio/links later blocks publication but never reopens onboarding. Stale setup tabs cannot reapply initialization. There is no repeat-onboarding interface.
- ON-18. Every onboarding field/action has editor parity, including selected address editing until first publication, provider photo import/cropping, links, skills, all project fields, graph public/private setup, and explicit graph removal/access withdrawal. Editing does not republish content automatically. No AI, survey, or extra onboarding-only content store appears.
- ON-19. Keyboard navigation, visible focus, form labels/errors, progress, skip actions, crop dialogs, recovery controls, and preview switching work at the confirmed viewports. Dialog focus is managed and reduced-motion settings are respected. References influence composition while hasaweb.site branding is retained; screenshot copy, limits, and Linktree account requirements are not imported.

## 3. Edit, arrange, and preview the portfolio

Source: [Edit, arrange, and preview the portfolio](product.md#3-edit-arrange-and-preview-the-portfolio).

1. The editor provides a content and customization panel and live preview. Selecting a component opens fields and settings for that component.
2. The component picker explains the content, upload, link, or connected account each component needs. Adding a component places it in the draft and preview.
3. A second instance of any optional component type except general text is prevented. Multiple text sections and multiple entries within projects, skills, work experience, and social links are accepted.
4. Drag and drop and Move up/Move down change optional component order. The profile remains first. Entry ordering controls change the order inside entry-based components.
5. Removing a component with entered content requires confirmation. Cancelling preserves it; confirming removes it from the draft. The public component changes only after Publish, with the existing immediate-private-access exception for confirmed GitHub graph removal/disconnect. There is no independent hide/show setting.
6. On desktop and mobile, owners can enter content, add and remove components, reorder them, and access customization and publication controls. Desktop and mobile preview modes display the same draft in the selected viewport.
7. Content and appearance edits appear in the live preview without a manual refresh. A full-page preview shows the saved draft and supports navigation to case studies and `/resume`.
8. Preview links, internal navigation, and theme switching work. Submitting a preview contact form sends no visitor message and displays a preview-only notice. Contact settings expose a separate Send test message action.

## 4. Required profile, images, and social identity

Source: [Required profile, images, and social identity](product.md#4-required-profile-images-and-social-identity).

1. Owner-entered or confirmed provider name, owner-written bio, selected avatar and banner, and at least one valid social or contact link permit profile validation to pass. Removing any required value blocks publication and identifies the missing field. After first editor entry this never re-locks the editor. Sample values do not count.
2. The name appears prominently in the fixed top profile section. The published bio, avatar, banner, and optional location match the owner's published values. Leaving location empty does not block publication.
3. An email address, GitHub profile, supported social profile, or website URL satisfies the link requirement when valid. Invalid destinations fail validation. A configured contact form with no qualifying link does not satisfy it.
4. Owners can add, edit, remove, and order links. Each published link has an understandable label and opens its configured destination; email links open an email application with the configured address.
5. Owners can select profile visibility and separate social-component visibility for a single stored link. Editing that link updates both chosen placements after Publish without duplicate entry.
6. Owners can select, change, and remove Ginger cat (`cat`) or Hands (`hands`) from the curated gallery. The selected overlay appears on the avatar with Face Reveal on or off. There are no Leaf/Orbit/Frame static choices or custom decoration uploads. Preserve the imported art, placement and complete choreography; see criterion 4.15 for playback.
7. An explicitly displayed email link exposes that address. A contact-form recipient address does not appear in the public form or its public responses unless the owner separately displays it.
8. Face Reveal is off by default. Turning its editor toggle on shows a second image upload input; turning it off hides that input. Owners choose an original avatar and a real-face photo without automated face verification.
9. The second image supports upload, crop, replacement, and removal under the image format, size, failure recovery, and description requirements in section 13. Preview and published output match each image's saved crop. A failed replacement preserves the previous successful image.
10. With Face Reveal enabled, a missing, removed, failed, or incomplete second upload blocks publication and shows an error beside the input. Completing a valid upload or turning the add-on off resolves that requirement. Turning it off retains a successful second upload in the private draft for reuse; reenabling restores it.
11. Preview and published portfolios show the original avatar on each page load. One click or tap reveals the second image through a smooth diagonal wipe starting at the top-left and progressing toward the bottom-right. The next activation reverses the wipe to restore the original. Both images keep the same size and position. Reloading after revealing the photo restores the original avatar.
12. The interactive avatar has a subtle visual reveal cue, visible keyboard focus, and Enter and Space activation. Its accessible label is "Reveal face" while the original avatar is shown and "Show avatar" while the second photo is shown. With reduced motion enabled, activation switches images immediately without the wipe. A selected decoration remains visible over both images. With the add-on disabled, the avatar has no reveal cue or reveal interaction.
13. Owners can exercise the reveal in preview. Changing the toggle, either image, or its crop autosaves the draft without changing the public portfolio before Publish. After Publish, visitors see the saved configuration and images.
14. The editor explains that publishing Face Reveal makes the second photo publicly accessible before any reveal interaction. After publication, that photo can be fetched without activating the avatar. Disabling the add-on and republishing removes public access to the second photo while preserving it in the private draft. Signed-out visitors and other owners cannot fetch that retained draft photo through public asset routes.

15. The selected decoration autoplays the cleaned 32-frame cat loop or six-second hands sequence. A separate keyboard-accessible pause/play control stops/resumes playback without switching the portrait, including with Face Reveal off. Pausing or requesting reduced motion shows the cleaned cat still or stationary hands. Reduced motion takes priority over play, and changing motion preference applies immediately. Phase 38 implements these production controls.

## 5. Projects and case studies

Source: [Projects and case studies](product.md#5-projects-and-case-studies).

1. A portfolio without projects can publish. Owners can manually create, edit, delete, and reorder project entries through the CMS without editing code.
2. Each project offers title, summary, image, technologies, individual contribution, code link, and demo link fields. The editor prompts for the owner's individual contribution. A project with a title and summary can publish without an image or code/demo links; missing title or summary is identified before publication.
3. Published cards display the entered project information in the shared card layout and chosen order. Supplied code and demo links open their configured destinations. Absent optional links do not create empty controls.
4. An owner can add an optional case study to a project with headings, paragraphs, lists, links, and uploaded images. After Publish, its card links to its own public URL and those content types render correctly.
5. Case studies use the portfolio's theme and typography and provide working navigation back to the portfolio.
6. Editing or removing a project or case study leaves the existing public version intact until Publish. A successful Publish updates its card and case study together.
7. A missing or published removal of a case study shows an unavailable-page state and a working route back to the portfolio if it remains published.
8. No automatic GitHub project import is offered.

## 6. Skills and technologies

Source: [Skills and technologies](product.md#6-skills-and-technologies).

1. Owners can add one skills component with multiple manually entered skill or technology names. It is optional for publication.
2. Owners can add, edit, remove, and order entries and named categories. After Publish, the component displays the entered names, selected grouping, and order.
3. Entries can appear without categories. Proficiency ratings, percentage bars, and automatic skill extraction are absent.

## 7. Work experience

Source: [Work experience](product.md#7-work-experience).

1. Owners can add one optional work experience component and create, edit, delete, and reorder multiple entries.
2. Each entry exposes role, organization, start date, end date, current-role status, description, and optional organization link fields. Published values and order match the saved entries.
3. Selecting current-role status allows an entry without an end date and displays an ongoing date range. An end date before the start date is rejected with a field-specific explanation.
4. A supplied organization link opens its configured destination. Omitting it creates no empty link.
5. Education is absent from the component picker.

## 8. About and general text sections

Source: [About and general text sections](product.md#8-about-and-general-text-sections).

1. Owners can create multiple text sections with separate titles and bodies, including an About me section, then edit, remove, and reorder them.
2. Headings, paragraphs, lists, and links survive saving and publication and render with the portfolio's generated colors and selected typography.
3. The editor provides no arbitrary HTML, script, or custom CSS input. Pasted or submitted script and HTML payloads cannot execute in previews or public pages.

## 9. GitHub activity graph

Source: [GitHub activity graph](product.md#9-github-activity-graph).

1. Owners can add one optional graph. GitHub sign-in detects the username; owners can change it. Google users can enter a username and complete GitHub authorization when required.
2. Preview and published graph show the selected username and link to that exact GitHub profile.
3. A new graph or changed username/access configuration blocks publication until configuration is connected and a fetch succeeds. Retry can complete setup; removing the component permits publication without it. A successful zero-contribution response passes validation.
4. With a known contribution fixture, the graph displays the fetched activity. Updating the fixture and allowing the configured refresh interval to elapse updates a published graph without Publish.
5. Private activity requires explicit opt-in and authorization for the selected username. The control explains that visitors will see anonymized counts. A different authorized username cannot enable private activity for the selected account.
6. With known private contributions, public output exposes contribution counts but no private repository names, code, or contribution details. Inspect both rendered content and public data responses.
7. Changing the username disables private activity until the matching account is authorized. Repository statistics are absent.
8. After a successful publication, a failed automatic refresh retains the last successful graph and its last-updated date. The builder reports the failure and offers Retry or Reconnect as applicable.
9. Disconnecting GitHub or revoking private access stops private refreshes and removes private data from the public graph without Publish. The graph displays public-only data or a clear unavailable state during recovery.
10. Authorization scopes and returned public/private data comply with the provider rules linked in the product document. Verify with public-only and explicitly authorized private-activity test accounts.
11. Onboarding/editor share public/private setup and the recovery/removal rules in ON-08 through ON-11. Serve either the safe public calendar or the complete matching authorized calendar, never their sum or a subtraction-derived private calendar. Draft consent alone exposes no private data on a published public-only configuration. Stale success/error writes cannot survive a connection generation change.

## 10. Contact form and message delivery

Source: [Contact form and message delivery](product.md#10-contact-form-and-message-delivery).

1. Owners can add one optional contact form. Setup initially uses the account's verified email. An absent or changed recipient must be verified before the form can publish; an unverified address blocks publication.
2. Empty visitor name, email, or message and malformed email show errors beside the relevant fields and do not submit a message.
3. An accepted submission sends the entered visitor details and message to the owner's verified recipient. Public content and public responses do not expose that recipient address.
4. The visitor sees success only after the system accepts the message for delivery. A failed submission shows retry guidance and no success claim.
5. Controlled spam and submissions above the configured limit receive a clear blocked/limited response and do not produce a false success or accepted delivery.
6. A temporary delivery failure triggers retries according to the configured policy. A failure after retries are exhausted notifies the owner. Record delivery attempts and the owner notification as evidence.
7. Send test message sends a test to the configured verified recipient and reports its outcome. Normal preview submissions send no message.
8. There is no builder inbox, attachment input, or automatic visitor reply.

## 11. Resume download and public resume page

Source: [Resume download and public resume page](product.md#11-resume-download-and-public-resume-page).

1. Owners can upload one PDF resume, replace it, and remove it. A resume download control is optional and can be ordered among components. Including it without a valid PDF blocks publication.
2. After Publish, download controls and `/resume` use the same PDF. Compare downloaded file contents with the published upload.
3. `/resume` supports viewing, downloading, and Back to portfolio. With embedded viewing unavailable, a working download fallback remains available.
4. The resume page uses shared portfolio appearance and provides no structured resume authoring tool.
5. Uploading, replacing, or removing a resume affects only the draft until Publish. After Publish, the public page and controls use the new file or reflect removal. With no published resume, `/resume` shows an unavailable-page state.

## 12. Themes, custom color, fonts, and light/dark mode

Source: [Themes, custom color, fonts, and light/dark mode](product.md#12-themes-custom-color-fonts-and-lightdark-mode).

1. Exactly six preset themes are selectable: Leaf, Violet, Clay, Matcha, Strawberry and Coffee, each with light and dark palettes matching the approved catalog. Switching among them preserves profile content, component entries, component order, and the single template.
2. Selecting any curated font applies it consistently to the portfolio, case studies, and resume page in preview and after Publish.
3. Selecting one custom color generates light and dark values for page backgrounds, raised surfaces, text, borders, links, buttons, and interactive states. Both modes update in preview without a refresh.
4. The interface explains automatic color adjustments. Measure generated text/background pairs and control indicators in both modes against the recorded contrast standard in the verification prerequisites below. Every supported preset and generated palette passes.
5. Resetting custom colors restores the selected preset's palette. There are no controls to edit individual generated colors.
6. Owners can select initial light, dark, or system mode. A fresh visitor session opens in the selected mode; system mode follows the visitor's light/dark preference. Visitors can switch modes on all public page types.
7. Appearance settings apply across components and additional pages after Publish. Arbitrary positioning, custom CSS, per-component fonts, and alternative layouts are unavailable.

## 13. Upload handling

Source: [Upload handling](product.md#13-upload-handling).

1. JPEG, PNG, and WebP images at or below 5 MB are accepted. Images over 5 MB and unsupported formats are rejected. PDFs at or below 10 MB are accepted as resumes; larger files and non-PDF files are rejected. Test exact limits using the recorded byte definition.
2. Avatar and banner controls upload, replace, crop, and remove images. The saved and published result matches the chosen crop. Project and case-study images support upload, replacement, and removal.
3. Uploads show progress, completion, and actionable errors for unsupported formats, oversize files, interrupted transfers, and server failures. Retrying a failed upload can succeed.
4. A failed replacement leaves the previous successful asset intact in both draft and published use. A successful draft replacement does not change the published file before Publish.
5. Owners can enter descriptions for meaningful images. Public accessibility output includes those descriptions. Decorative images and avatar overlays do not produce redundant announcements.
6. Removing the required avatar or banner blocks republishing until a replacement completes. Existing published images remain accessible while the draft is incomplete.
7. Unpublished uploads cannot be fetched through public asset routes by a signed-out visitor or another owner. Publication exposes only the assets belonging to the published version.
8. Onboarding and editor share the crop/import behavior in ON-03 and ON-04. Only finished crops are stored. Imported images have the same format/byte/signature/ownership constraints and explicit acceptance as uploads; a remote provider URL is not a ready owned asset.

## 14. Automatic draft saving and recovery

Source: [Automatic draft saving and recovery](product.md#14-automatic-draft-saving-and-recovery).

1. Editing content, component order, appearance, and completed upload references automatically saves the draft. Onboarding shares this draft and separately stores private revision-aware progress. Reopening after Saved restores those exact values; onboarding resumes its last visited screen until first editor handoff.
2. An in-flight save displays Saving, a confirmed save displays Saved, and a failed save displays Couldn't save with Retry. A failed save never displays Saved for those edits.
3. After a controlled temporary save failure or interruption, recoverable unsaved edits remain locally available. Recovery and retry preserve the entered values and can save them successfully.
4. When two tabs or devices edit the same draft, saving from a stale version does not silently overwrite the newer saved version. The owner can load the newer version or preserve local edits for review before resolving the conflict.
5. Session expiry prompts reauthentication and preserves recoverable edits. Interrupted uploads can be retried. Publish cannot complete while current edits or required uploads remain unsaved.
6. Autosaving and recovery do not modify the published site. No version-history interface is offered.
7. Exercise ON-13 through ON-17 for content/progress races, invalid local input, interrupted handoff, and permanent editor entry. Neither unsaved invalid text nor an unuploaded original image is promised across devices.

## 15. Subdomain selection and publication

Source: [Subdomain selection and publication](product.md#15-subdomain-selection-and-publication).

1. The first required onboarding screen selects a subdomain and checks availability; the editor can change that saved candidate until first publication. Names of 3 and 30 valid characters pass format validation. Shorter/longer names, uppercase letters, unsupported characters, and leading/trailing hyphens fail. Reserved names cannot be claimed. ON-02 verifies that candidates create no reservation.
2. Invalid or unavailable names receive an explanation and can be replaced. Two accounts publishing concurrently for the same available name produce exactly one successful claim; the other receives an unavailable-name result.
3. A successful first publication produces `username.hasaweb.site`. The subdomain cannot be changed afterward, and later publications update that same address.
4. The checklist identifies missing required profile values, invalid links, incomplete uploads, and incomplete included components. Each issue opens the relevant editor control.
5. An owner-entered or confirmed provider name, owner-written bio, accepted avatar and banner, valid social/contact/website link, and available valid subdomain allow publication without projects, case studies, or custom styling. Untouched optional samples are omitted.
6. An edited optional sample must meet its component requirements. A graph without a successful fetch, form without a verified recipient, or resume control without a valid PDF blocks publication.
7. Publish saves and validates the current draft and changes the complete public portfolio and additional pages atomically. Requests during the operation see a complete old or new version, never a partial combination.
8. Injecting a publication failure leaves the previous public content and assets intact and offers Retry. A failed first publication reports neither a live site nor a successful address claim.
9. After success, Open opens the published portfolio and Copy places its exact public URL on the clipboard. Repeating Publish updates the existing address.

## 16. Public visitor experience

Source: [Public visitor experience](product.md#16-public-visitor-experience).

1. At phone, tablet, and desktop widths in the recorded test matrix, published content remains readable, controls remain usable, and content order and meaning stay consistent. No content or control is lost outside the viewport.
2. A signed-out visitor can read the profile and every published component, open case studies, follow code/demo/social links, view/download the resume, and submit the contact form when each capability is published.
3. Theme switching works on portfolio, case-study, and resume pages. All use the owner's published appearance.
4. All navigation and controls work by keyboard, show visible focus, and have understandable accessible labels. Meaningful images expose descriptions. Form errors and submission outcomes are understandable through assistive technology.
5. Signed-out visitors and other owners cannot edit a portfolio, open its private draft preview, or fetch its unpublished draft assets. Direct requests fail as well as UI access.
6. Missing pages and unavailable portfolios show clear states. Failed external data displays an unavailable state within the affected component while the rest of the portfolio still loads.
7. No visitor account is required. Visitor analytics and cookie-based tracking are absent.

## 17. Search and social sharing

Source: [Search and social sharing](product.md#17-search-and-social-sharing).

1. Page title, description, and sharing image start with defaults derived from the profile. Owners can edit each and inspect a sharing preview of the resulting values.
2. After Publish, inspect the served page metadata to verify the published title, description, and sharing image. Case studies and `/resume` have page-specific titles that identify the portfolio.
3. Published pages are publicly fetchable and contain no directive that excludes them from search indexing. No actual search ranking or indexing deadline is required to pass.
4. Drafts have no publicly accessible URL or assets that expose private content to search crawlers. An unauthenticated request cannot retrieve draft content.
5. After unpublication or published removal, old public URLs stop serving their former content and metadata. Test origin behavior; third-party search and sharing caches are outside the acceptance boundary.

## 18. Return, manage access, unpublish, and delete

Source: [Return, manage access, unpublish, and delete](product.md#18-return-manage-access-unpublish-and-delete).

1. Before first editor handoff, returning owners resume saved onboarding. After handoff, they reopen the editor draft directly, edit included capabilities, preview them, and explicitly publish or republish. Onboarding does not rerun after removing required publication content. Edits alone do not change the public version.
2. Settings list connected GitHub and Google providers. Connecting another provider requires proof of ownership. Disconnecting the last usable sign-in method is prevented; disconnecting one of two usable methods leaves the other functional.
3. Disconnecting GitHub removes its authorization and private activity access, including public private-count removal without Publish. Reconnecting allows authorized capabilities to be configured again.
4. Sign out ends authenticated editing access. Authentication failures and expired sessions offer sign-in recovery into the same account and portfolio.
5. Unpublish removes public access to the portfolio, case studies, resume, and their unpublished assets while preserving the draft and reserving the subdomain. Another account cannot claim it. Republish restores the site at that address.
6. Permanent deletion explains the loss and requires explicit confirmation. Cancelling preserves the account. Confirming removes public pages, draft content, stored uploads, and connected-account access; old page and asset URLs no longer expose deleted content.

## Cross-feature outcomes and scope

Source: [Desired outcomes](product.md#desired-outcomes), [User journey](product.md#user-journey), and [Deferred features](product.md#features-deferred-beyond-the-mvp-out-of-scope).

1. In a timed usability session, a participant from the target audience with name, bio, avatar, banner, and a valid link ready can authenticate, select an available address, complete required profile/links setup, skip all optional steps, review the real draft, enter the editor, and open a successfully published portfolio in under 15 minutes. Record elapsed time and any assistance. Optional content and personalization are not required in this test; do not invent a separate onboarding time or completion-rate target.
2. Run the complete journey from inspecting an example through first publication, copying/opening the public URL, returning to a saved draft, and republishing changes. Each step meets its corresponding criteria above without code or hosting configuration.
3. Audit the component picker, editor, account settings, and public visitor flows against the deferred-feature list. There are no additional portfolios/templates, education, billing/subscriptions/checkout/paid restrictions, custom domains, custom decoration uploads, stickers, arbitrary positioning, custom CSS, per-component fonts, or individual palette editing.
4. There are no automatic GitHub project imports, repository statistics, proficiency ratings, automatic skill extraction, structured resume editing, builder inbox, contact attachments, automatic replies, AI content generation, collaboration, visitor accounts, multilingual editing, version history, visitor analytics, or cookie-based tracking. Explicitly authorized private contribution activity remains included.
5. Gather owner and visitor feedback about confidence, readability, and understanding of skills and individual contributions. Report the observations separately from functional pass/fail results. The product specifies no acceptance threshold for these qualitative outcomes yet.
6. Run ON-01 through ON-19 and the complete journey with all selected optional content complete, all optional content skipped, and partial projects/private graph setup retained. Required setup cannot be skipped, every path keeps one private draft, and all collected content can be edited after handoff. No feature or roadmap phase is considered implemented by approval of these planning documents.

## Verification prerequisites

The catalog was approved in Phase 11E. Provider/deployment evidence remains a prerequisite. The numeric verification settings are already confirmed in architecture section 13; use those values rather than reopening them.

| Choice | Required test input or evidence |
| --- | --- |
| Theme, font, and decoration catalog | Use the six theme IDs and twelve palettes, three curated fonts, Ginger cat and Hands assets/geometry/playback policy, and draft defaults approved in Phase 11E from the [catalog](appearance-catalog.md). Test every supported choice, reduced motion and independent pause/play in the later production integration. |
| Provider configuration | Test accounts for GitHub and Google, verified/shared/missing/unverified email cases, and private-contribution authorization. |
| GitHub refresh and revocation handling | Use the confirmed six-hour on-visit TTL and daily private-activity sweep. Verify external revocation on the next refresh/sweep and explicit withdrawal immediately, without Publish. |
| Delivery retries and submission limits | Use architecture section 13's confirmed thresholds, UTC budgets and five-attempt, 24-hour retry schedule. Test boundaries, exhaustion and longer provider retry delays within that deadline. |
| Upload limit units | Use 5 MiB = 5,242,880 bytes and 10 MiB = 10,485,760 bytes. Test each limit and limit + 1. |
| Contrast verification | Use the confirmed WCAG 2.2 AA standard: 4.5:1 for normal text and 3:1 for large text and required control indicators. Verify declared pairs with unit checks and rendered interfaces with axe. |
| Browser and viewport coverage | Use the last two stable versions of Chrome, Firefox, Safari and Edge, plus iOS Safari and Android Chrome, at 360, 768 and 1280 px. Use automated browser/viewport checks and provider fixtures. Real-device and assistive-technology checks are excluded from the confirmed MVP verification scope. |

If a prerequisite is unresolved, mark the dependent check as pending with the missing decision. Do not mark it passed or silently invent a refresh deadline, retry count, submission limit, or usability success-rate target.
