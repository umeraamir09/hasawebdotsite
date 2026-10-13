# Acceptance criteria

This document defines how to verify each MVP feature in [product.md](product.md). Section numbers match the product's feature map. Each numbered criterion is a pass/fail requirement, not a claim that the current implementation passes it.

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
3. A new account opens exactly one portfolio with the preselected template. No template picker or second-portfolio creation option is available.
4. The initial editor shows a live preview, sample profile content, and a sample project, all clearly identified as examples.
5. Publishing with any untouched sample name, bio, avatar, or banner fails with an explanation. An imported provider photo satisfies the avatar requirement only after the owner explicitly accepts it.
6. Untouched optional samples are absent from the published site. Editing an optional sample makes its normal publication validation apply.
7. Cancelling or failing authentication displays a retry path. After session expiry, signing in again restores the same portfolio and recoverable edits.

## 3. Edit, arrange, and preview the portfolio

Source: [Edit, arrange, and preview the portfolio](product.md#3-edit-arrange-and-preview-the-portfolio).

1. The editor provides a content and customization panel and live preview. Selecting a component opens fields and settings for that component.
2. The component picker explains the content, upload, link, or connected account each component needs. Adding a component places it in the draft and preview.
3. A second instance of any optional component type except general text is prevented. Multiple text sections and multiple entries within projects, skills, work experience, and social links are accepted.
4. Drag and drop and Move up/Move down change optional component order. The profile remains first. Entry ordering controls change the order inside entry-based components.
5. Removing a component with entered content requires confirmation. Cancelling preserves it; confirming removes it from the draft. The public version changes only after Publish. There is no independent hide/show setting.
6. On desktop and mobile, owners can enter content, add and remove components, reorder them, and access customization and publication controls. Desktop and mobile preview modes display the same draft in the selected viewport.
7. Content and appearance edits appear in the live preview without a manual refresh. A full-page preview shows the saved draft and supports navigation to case studies and `/resume`.
8. Preview links, internal navigation, and theme switching work. Submitting a preview contact form sends no visitor message and displays a preview-only notice. Contact settings expose a separate Send test message action.

## 4. Required profile, images, and social identity

Source: [Required profile, images, and social identity](product.md#4-required-profile-images-and-social-identity).

1. Owner-entered name and bio, selected avatar and banner, and at least one valid social or contact link permit profile validation to pass. Removing any required value blocks publication and identifies the missing field. Sample values do not count.
2. The name appears prominently in the fixed top profile section. The published bio, avatar, banner, and optional location match the owner's published values. Leaving location empty does not block publication.
3. An email address, GitHub profile, or supported social profile satisfies the link requirement when valid. Invalid destinations fail validation. A configured contact form with no qualifying link does not satisfy it.
4. Owners can add, edit, remove, and order links. Each published link has an understandable label and opens its configured destination; email links open an email application with the configured address.
5. Owners can select profile visibility and separate social-component visibility for a single stored link. Editing that link updates both chosen placements after Publish without duplicate entry.
6. Owners can select, change, and remove an avatar decoration from the curated gallery. The selected overlay appears on the avatar; custom decoration upload is unavailable.
7. An explicitly displayed email link exposes that address. A contact-form recipient address does not appear in the public form or its public responses unless the owner separately displays it.
8. Face Reveal is off by default. Turning its editor toggle on shows a second image upload input; turning it off hides that input. Owners choose an original avatar and a real-face photo without automated face verification.
9. The second image supports upload, crop, replacement, and removal under the image format, size, failure recovery, and description requirements in section 13. Preview and published output match each image's saved crop. A failed replacement preserves the previous successful image.
10. With Face Reveal enabled, a missing, removed, failed, or incomplete second upload blocks publication and shows an error beside the input. Completing a valid upload or turning the add-on off resolves that requirement. Turning it off retains a successful second upload in the private draft for reuse; reenabling restores it.
11. Preview and published portfolios show the original avatar on each page load. One click or tap reveals the second image through a smooth diagonal wipe starting at the top-left and progressing toward the bottom-right. The next activation reverses the wipe to restore the original. Both images keep the same size and position. Reloading after revealing the photo restores the original avatar.
12. The interactive avatar has a subtle visual reveal cue, visible keyboard focus, and Enter and Space activation. Its accessible label is "Reveal face" while the original avatar is shown and "Show avatar" while the second photo is shown. With reduced motion enabled, activation switches images immediately without the wipe. A selected decoration remains visible over both images. With the add-on disabled, the avatar has no reveal cue or reveal interaction.
13. Owners can exercise the reveal in preview. Changing the toggle, either image, or its crop autosaves the draft without changing the public portfolio before Publish. After Publish, visitors see the saved configuration and images.
14. The editor explains that publishing Face Reveal makes the second photo publicly accessible before any reveal interaction. After publication, that photo can be fetched without activating the avatar. Disabling the add-on and republishing removes public access to the second photo while preserving it in the private draft. Signed-out visitors and other owners cannot fetch that retained draft photo through public asset routes.

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

1. Exactly three preset themes are selectable. Switching among them preserves profile content, component entries, component order, and the single template.
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

## 14. Automatic draft saving and recovery

Source: [Automatic draft saving and recovery](product.md#14-automatic-draft-saving-and-recovery).

1. Editing content, component order, appearance, and completed upload references automatically saves the draft. Reopening the editor after Saved restores those exact values.
2. An in-flight save displays Saving, a confirmed save displays Saved, and a failed save displays Couldn't save with Retry. A failed save never displays Saved for those edits.
3. After a controlled temporary save failure or interruption, recoverable unsaved edits remain locally available. Recovery and retry preserve the entered values and can save them successfully.
4. When two tabs or devices edit the same draft, saving from a stale version does not silently overwrite the newer saved version. The owner can load the newer version or preserve local edits for review before resolving the conflict.
5. Session expiry prompts reauthentication and preserves recoverable edits. Interrupted uploads can be retried. Publish cannot complete while current edits or required uploads remain unsaved.
6. Autosaving and recovery do not modify the published site. No version-history interface is offered.

## 15. Subdomain selection and publication

Source: [Subdomain selection and publication](product.md#15-subdomain-selection-and-publication).

1. Before first publication, owners can enter a subdomain and check availability. Names of 3 and 30 valid characters pass format validation. Shorter/longer names, uppercase letters, unsupported characters, and leading/trailing hyphens fail. Reserved names cannot be claimed.
2. Invalid or unavailable names receive an explanation and can be replaced. Two accounts publishing concurrently for the same available name produce exactly one successful claim; the other receives an unavailable-name result.
3. A successful first publication produces `username.hasaweb.site`. The subdomain cannot be changed afterward, and later publications update that same address.
4. The checklist identifies missing required profile values, invalid links, incomplete uploads, and incomplete included components. Each issue opens the relevant editor control.
5. An owner-entered name and bio, accepted avatar and banner, valid social/contact link, and available valid subdomain allow publication without projects, case studies, or custom styling. Untouched optional samples are omitted.
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

1. Returning owners reopen the saved draft, edit included capabilities, preview them, and explicitly republish to the existing public URL. Edits alone do not change the public version.
2. Settings list connected GitHub and Google providers. Connecting another provider requires proof of ownership. Disconnecting the last usable sign-in method is prevented; disconnecting one of two usable methods leaves the other functional.
3. Disconnecting GitHub removes its authorization and private activity access, including public private-count removal without Publish. Reconnecting allows authorized capabilities to be configured again.
4. Sign out ends authenticated editing access. Authentication failures and expired sessions offer sign-in recovery into the same account and portfolio.
5. Unpublish removes public access to the portfolio, case studies, resume, and their unpublished assets while preserving the draft and reserving the subdomain. Another account cannot claim it. Republish restores the site at that address.
6. Permanent deletion explains the loss and requires explicit confirmation. Cancelling preserves the account. Confirming removes public pages, draft content, stored uploads, and connected-account access; old page and asset URLs no longer expose deleted content.

## Cross-feature outcomes and scope

Source: [Desired outcomes](product.md#desired-outcomes), [User journey](product.md#user-journey), and [Deferred features](product.md#features-deferred-beyond-the-mvp-out-of-scope).

1. In a timed usability session, a participant from the target audience with name, bio, avatar, banner, and a valid link ready can authenticate, replace required samples, choose an available address, and open a successfully published portfolio in under 15 minutes. Record elapsed time and any assistance. Projects and personalization are optional in this test.
2. Run the complete journey from inspecting an example through first publication, copying/opening the public URL, returning to a saved draft, and republishing changes. Each step meets its corresponding criteria above without code or hosting configuration.
3. Audit the component picker, editor, account settings, and public visitor flows against the deferred-feature list. There are no additional portfolios/templates, education, billing/subscriptions/checkout/paid restrictions, custom domains, custom decoration uploads, stickers, arbitrary positioning, custom CSS, per-component fonts, or individual palette editing.
4. There are no automatic GitHub project imports, repository statistics, proficiency ratings, automatic skill extraction, structured resume editing, builder inbox, contact attachments, automatic replies, AI content generation, collaboration, visitor accounts, multilingual editing, version history, visitor analytics, or cookie-based tracking. Explicitly authorized private contribution activity remains included.
5. Gather owner and visitor feedback about confidence, readability, and understanding of skills and individual contributions. Report the observations separately from functional pass/fail results. The product specifies no acceptance threshold for these qualitative outcomes yet.

## Verification prerequisites

The product leaves the following implementation choices open. Record them before running dependent checks; an unspecified value cannot produce an objective pass.

| Choice | Required test input or evidence |
| --- | --- |
| Theme, font, and decoration catalog | Names and assets for the three themes, curated fonts, and decorations. Test every supported choice. |
| Provider configuration | Test accounts for GitHub and Google, verified/shared/missing/unverified email cases, and private-contribution authorization. |
| GitHub refresh and revocation handling | Configured refresh interval and how revocation is detected. Exercise refresh and revocation without Publish and record when public data changes. |
| Delivery retries and submission limits | Retry schedule, exhaustion condition, spam test cases, and exact submission threshold/window. Test below, at, and above the limit. |
| Upload limit units | Exact byte values used for 5 MB and 10 MB. Test at the limit and one byte above. |
| Contrast verification | Record the chosen measurable standard and tool before palette checks. A proposed baseline is WCAG AA contrast: 4.5:1 for normal text, 3:1 for large text, and 3:1 for required control indicators against adjacent colors. This numeric baseline is a verification proposal, not an existing numeric commitment in product.md. |
| Browser and viewport coverage | Record supported browsers, phone/tablet/desktop widths, mobile editing devices, and assistive technology used for verification. |

If a prerequisite is unresolved, mark the dependent check as pending with the missing decision. Do not mark it passed or silently invent a refresh deadline, retry count, submission limit, or usability success-rate target.
