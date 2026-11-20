# hasaweb.site

hasaweb.site is a component-based portfolio builder for developers. Users add their profile and work to a ready-made layout, personalize its appearance, and publish at an address such as `username.hasaweb.site` without writing code or configuring hosting.

This document defines the target audience, the problem the product addresses, and the complete MVP scope. It describes how owners build and maintain their portfolios and what visitors can do on the published sites.

See [UI direction](ui-direction.md) for the project's Figma visual reference, agent access through Figma MCP, and the read-only rule during development.

The [initial setup specification](onboarding.md) defines mandatory Address, Profile, and Links steps followed by optional Skills, Projects, and GitHub steps. This document describes target behavior; the [roadmap](roadmap.md) tracks what is built.

## Target audience

hasawebsite should initially target computer science and software engineering students and developers seeking their first professional role who have projects to share with employers. Their portfolio should explain what they built, their individual contributions, and their technical skills, with links to code and working demos.

For this audience, the builder should offer a ready-made layout and simple controls for adding content. This audience is a starting recommendation based on the research reviewed. Demand for a separate personal website still needs validation with prospective users.

## Core problem

Developers need a clear way to present their skills, projects, experience, and professional identity online. Yet creating a personal website also asks them to make design and layout decisions and iterate on the result. For developers without design experience, this work can make building a personal website harder than preparing the information they want to share. The founder identified this problem while building a portfolio.

## Desired outcomes

Users should be able to publish a portfolio they feel confident sharing with prospective employers. Visitors should be able to understand their skills, what they built, and their individual contributions, with clear links to inspect their work and contact them.

With their content ready, users should be able to publish a usable portfolio in under 15 minutes. Publishing requires a real name and bio, an owner-selected avatar and banner, at least one valid social or contact link, and a reserved subdomain. An email address, GitHub profile, another supported social profile, or website URL can satisfy the link requirement. Projects and detailed case studies are optional. If users add projects, they should explain their individual contributions and include relevant code or demo links. Users should receive a public subdomain they can share without buying a domain or configuring hosting.

New owners should receive guidance before learning the editor. Required initial setup collects their address selection, profile, and links; optional steps prepare skills, projects, and GitHub activity. Their first editor view uses their actual accepted content. Skipping optional steps preserves entered work, and every collected value remains editable in the editor.

Users should be able to build a polished, readable portfolio without design knowledge. The MVP should provide a bio section at the top, followed by ready-made components that users can add, remove, configure, and reorder through drag and drop. Each component should guide users through adding the content, accounts, or links it needs.

Users should be able to make the portfolio feel like their own through six preset themes, a single custom color that generates coordinated light and dark palettes, a curated font selection, uploaded banners and profile pictures, and optional avatar decorations. These settings should apply consistently across components. Extensive customization is deferred beyond the MVP. Custom image stickers are deferred beyond the MVP.

After publication, users should be able to keep their portfolio current without editing code or rebuilding the site. A lightweight CMS should let them create, edit, and publish project cards and optional linked case studies.

These outcomes should be tested with users and portfolio visitors. Apart from the 15-minute publishing target, measurable targets will be set after that testing.

## User journey

Reference: [hasawebsite user journey map in FigJam](https://www.figma.com/board/QthkSwSGQGuZtA13BJlNAe/Customer-Journey-Map--Copy-?node-id=5683-3660).

The table records the agreed experience for the first release, including the October 16 initial-setup decisions. The linked FigJam map is earlier journey context and has not been edited by this planning change. The journey follows a computer science or software engineering student or developer seeking their first professional role, with their bio, avatar, banner, project details, and links ready. It starts when they decide they need a portfolio and ends when they update it after sharing it with employers.

Feelings, thoughts, and pain points remain blank until user evidence is available. Unsupported demographic details also remain blank. The opportunities below are planned product capabilities.

| Journey steps | Evaluate the builder | Start a portfolio | Build and personalize | Publish and share | Return and update |
| --- | --- | --- | --- | --- | --- |
| User actions | Inspect an example portfolio.<br>Review available capabilities and customization.<br>Review how public subdomains work. | Sign up.<br>Select an available address, complete the combined profile screen, and add a social/contact link.<br>Optionally add skills, projects, and public/private GitHub activity, or skip optional steps.<br>Review the private portfolio and open the editor. | Customize the prepared profile and any optional content.<br>Add other components or finish incomplete setup.<br>Optionally personalize styling and component order. | Review or change the selected address before first Publish.<br>Resolve validation and availability issues, then explicitly publish.<br>Open or copy the public URL to share with employers. | Return directly to the editor after first handoff.<br>Reopen the saved draft, edit content, and review the preview.<br>Explicitly publish changes at the same public URL. |
| Intended goals | Decide whether the builder suits their portfolio needs. | Provide information through guided screens and see actual progress before learning the editor. | Present their identity and work without designing a layout. Optional content and personalization remain optional. | Publish a shareable portfolio with a real name and bio, avatar, banner, social or contact link, and a reserved subdomain. | Keep the portfolio current without editing code or rebuilding the site. |
| Feelings and thoughts | | | | | |
| Planned opportunities | Show example portfolios.<br>Explain customization options.<br>Explain the public subdomain. | Require initial setup before first editor access.<br>Preselect the template and save progress.<br>Offer accepted provider suggestions, image cropping, optional content, and a real review preview. | Provide all onboarding fields and actions in the editor.<br>Offer live preview, themes, colors, fonts, light/dark mode, images, and component order.<br>Save edits automatically as a draft. | Validate required and included content.<br>Reserve the selected address during setup; claim it on successful first publication.<br>Provide the public URL with Open and Copy options. | Keep drafts separate from the published site.<br>Update the public site only on Publish.<br>Keep the existing URL and do not rerun onboarding. |
| Pain points | | | | | |

The feature map below defines the agreed MVP capabilities and recovery behavior. Discovery channels and evidence about user feelings and pain points remain outside this feature scope.

## MVP features map

This map describes the agreed first release. An owner is the signed-in person building a portfolio. A visitor is anyone viewing a published portfolio. Each account has one portfolio, one template, and one public subdomain. The release is free to portfolio owners and has no product billing or subscriptions. Operator hosting moves to Workers Paid at launch ([architecture](architecture.md#2-platform-budget-and-release-gates)); local development needs no upgrade.

The portfolio has a fixed profile section at the top and optional components below it. Project case studies and the resume have additional public pages. Owners edit a private draft; visitors see the last successfully published version. Content, appearance, uploads, component order, project pages, and resume changes become public through an explicit Publish action.

GitHub activity refreshes and contact message delivery continue after publication. These operations do not require owners to republish. Revoking private GitHub access also removes private activity from the public graph without waiting for publication.

### 1. Discover and evaluate the builder

- The public entry page shows an example portfolio that visitors can inspect before creating an account.
- It explains the included components, customization choices, and the one-portfolio limit. It shows appearance examples and explains how an address such as `username.hasaweb.site` works, including that choosing an address reserves it until the first publication and creates no public site.
- It states that the MVP is free and provides a clear Start building action leading to authentication.
- Prospective owners can understand what they can publish without buying a domain, configuring hosting, or writing code.

### 2. Create an account and start a portfolio

- Owners sign up or sign in with GitHub or Google before editing. Password and email-only sign-in are outside the MVP.
- Both providers open the same account when they supply the same verified email, unless the owner disconnected that provider in settings; then only connecting it again from settings restores it. Linking an additional provider requires proof of ownership; a linked Google account must use the account email, while a GitHub account may use another verified email; an unverified or missing email must not cause automatic account merging.
- A new account starts one private portfolio in the preselected template. There is no template picker or alternative layout in this release.
- The sequence is Address, Profile, Links, Skills, Projects, GitHub, Review, then Editor. Address, Profile, and Links are required before first editor entry, with no initial skip or direct-editor bypass. Profile is one screen containing name, bio, avatar, banner, image previews, and cropping/adjustment controls.
- Address checks format and current availability; a successful save reserves the name. Links requires at least one valid labeled social/website URL or email shown in the profile.
- Skills, Projects, and GitHub are optional. Owners can skip each step or all remaining optional steps. Skipping preserves entered content, including unfinished projects or graph setup, which remains subject to normal publication validation.
- Provider name is prefilled for review. A provider photo requires explicit acceptance, cropping, and a successful private upload. Account email is never silently made public. Forms offer examples, but the prepared portfolio contains real accepted content and no inserted sample profile or project.
- Review uses the shared renderer and desktop/mobile preview. The fixed profile appears first, followed by supplied skills, projects, and GitHub sections in that order. Empty optional steps create no sections. Review explains that the portfolio is private and offers Back and Open editor.
- Valid content and progress save automatically to the same draft. Interrupted setup resumes the last visited screen; invalid unfinished input has same-browser local recovery. First editor handoff checks saved required content and ready owned assets and permanently ends onboarding. Returning owners go directly to the editor, even if later edits remove required publication content. No rerun interface is included.
- Every onboarding field and action remains available in the editor. The initial release has no older-customer rollout requirement. See [onboarding.md](onboarding.md) for mappings, partial completion, recovery, authorization, and implementation dependencies.
- Existing sample-marker contracts remain compatible: any untouched optional samples in older fixtures/migrated drafts are omitted from publication, required samples never satisfy owner content, and edited samples use normal component validation. New account provisioning inserts none.
- Cancelled or failed authentication provides a retry path. An expired session prompts sign-in again while preserving recoverable edits.

### 3. Edit, arrange, and preview the portfolio

- The builder has a content and customization panel alongside a live portfolio preview. Selecting a component opens its relevant content fields and settings.
- Owners add optional components through a component picker. Each component explains the content, upload, link, or connected account it requires.
- Owners can add one instance of each optional component type, except general text sections, which can have multiple instances. Projects, skills, work experience, and social links support multiple entries within their component.
- The profile stays at the top. Owners reorder the optional components through drag and drop or Move up and Move down controls. Entry-based components also provide ordering controls for their entries.
- Owners can remove optional components. Deleting entered content requires confirmation. There is no separate hide/show setting; removal affects the draft until Publish. Removing a GitHub graph also immediately withdraws its separate private-activity access after confirmation, as described in section 9.
- Desktop and mobile editing are supported. Desktop and mobile preview modes help owners inspect how the same content adapts to different screen sizes.
- The live preview reflects content and appearance edits immediately. A separate full-page preview displays the saved draft, including navigation to case studies and `/resume`.
- Owners can test outbound links, internal page navigation, and theme switching in preview. Contact forms show a preview-only notice and do not send visitor messages accidentally. Contact settings provide an explicit Send test message action.

### 4. Required profile, images, and social identity

| Profile field | MVP behavior |
| --- | --- |
| Name | Required owner-entered or explicitly confirmed provider name displayed prominently in the fixed profile section. Untouched sample content does not satisfy setup or publication. |
| Bio | Required owner-written short introduction. Samples do not satisfy setup or publication. |
| Avatar | Required owner-selected profile image. Owners can upload and crop an image or explicitly accept an imported provider photo. |
| Banner | Required owner-selected banner image with upload and cropping controls. |
| Social or contact link | At least one valid link or contact method is required. An email address, GitHub profile, another supported social profile, or website URL qualifies. A contact form alone does not replace this requirement. |
| Location | Optional location text displayed with the profile. |
| Avatar decoration | Optional Ginger cat (`cat`) or Hands (`hands`) animation from the curated gallery. Owners can change or remove it. Both retain the imported artwork and choreography. Custom decoration uploads are deferred. |
| Face Reveal | Optional avatar add-on. An editor toggle shows a second image upload input for a real-face photo, such as a selfie. Visitors toggle between the original avatar and that photo. |

- Face Reveal is off by default. The original avatar is intended for an illustrated or graphical identity, and the second image for the owner's real face. Owners choose the images; the builder does not verify faces automatically.
- Enabling Face Reveal shows upload, crop, replace, and remove controls for the second image. Both images follow the existing image format and size limits. Enabling the add-on without a successfully uploaded second image blocks publication and shows an error beside that input.
- Turning Face Reveal off hides the second upload input and permits publication with the original avatar. It retains a successfully uploaded second photo in the private draft for reuse. Removing the second photo while the add-on is enabled blocks publication until the owner replaces it or turns the add-on off.
- Preview and published portfolios initially show the original avatar on every page load. Clicking or tapping the avatar reveals the second image with a smooth diagonal wipe from the top-left toward the bottom-right. Both images remain fixed in size and position. Activating it again reverses the wipe to restore the original avatar. The revealed state is not remembered across page loads.
- A subtle visual cue identifies the interactive avatar. Visitors can toggle it with Enter or Space, with visible keyboard focus and an accessible label that changes between "Reveal face" and "Show avatar". Visitors who prefer reduced motion get an immediate image switch. Any selected avatar decoration remains over both images.
- Owners can test the reveal in preview. Toggle settings, images, and crops save as draft changes and become public only after Publish. The editor explains that the second photo becomes publicly accessible when Face Reveal is published, even before a visitor reveals it. Disabling the add-on and republishing excludes the second photo from public assets while retaining it in the private draft.

- Owners add, edit, remove, and order social or contact links. Each link has an understandable label and a valid destination or email address.
- Each URL supports up to 2,048 UTF-8 bytes; each email address supports up to 254 UTF-8 bytes. Free-text content retains the overall 1 MiB draft limit.
- Owners choose which links appear in the profile and which also appear in the separate social links component. They do not need to re-enter the same link to display it in both places.
- Visitors can follow social links or open their email application through an email contact link. Displaying an email link makes that address public; contact-form recipient addresses stay private unless separately displayed.

### 5. Projects and case studies

- The project component is optional. A lightweight CMS lets owners create, edit, delete, and order project entries without editing code.
- Each project has a title and summary, with fields for an image, technologies, individual contribution, code link, and working demo link. The editor prompts owners to explain what they personally built. Images and code/demo links are optional.
- Project cards display the entered information in a consistent layout. Visitors can open supplied code and demo links and follow a case-study link when one exists.
- Each project can have an optional case study at its own public URL. The case-study editor supports headings, paragraphs, lists, links, and uploaded images.
- Case studies use the portfolio's theme and typography and provide navigation back to the portfolio. Project cards and case studies publish together with the rest of the portfolio.
- Removing a project or its case study affects the public version only after Publish. A missing or removed public page shows a clear unavailable-page state with a route back to the portfolio when it remains published.
- Automatic GitHub project imports are deferred. Owners enter project content manually.

### 6. Skills and technologies

- Owners can add one optional skills and technologies component containing multiple manually entered entries.
- Each entry names a skill or technology. Owners may organize entries under named categories, such as Languages or Tools.
- Owners add, edit, remove, and order entries and categories. The published component displays their chosen grouping and order.
- The MVP does not include proficiency ratings, percentage bars, or automatic skill extraction.

### 7. Work experience

- Owners can add one optional work experience component containing multiple entries.
- Each entry provides fields for role, organization, start date, end date, current-role status, description, and an optional organization link.
- A current role displays an ongoing date range instead of requiring an end date. Date validation prevents an end date before the start date.
- Owners add, edit, delete, and order entries. Visitors see the saved role, organization, dates, and description and can follow an organization link when supplied.
- Education is intentionally excluded from the MVP component library.

### 8. About and general text sections

- Owners can add multiple optional text sections, including an About me section, each with its own title and body.
- The text editor supports headings, paragraphs, lists, and links. Owners can update, remove, and reorder these sections like other optional components.
- Published text uses the portfolio's generated colors and curated typography. The editor does not accept arbitrary HTML, scripts, or custom CSS.

### 9. GitHub activity graph

- Owners can add one optional GitHub activity component. GitHub sign-in automatically detects its username; owners can change the username in the component settings. Google users can set up a GitHub username and authorize GitHub when needed.
- The selected username appears clearly on the live preview and published graph, with a link to the corresponding GitHub profile.
- Onboarding and the editor both offer explicit public graph setup and optional private authorization. GitHub signup suggests a username but adds no graph automatically. Google owners can configure public activity without adding GitHub sign-in; a separate activity grant does not link a sign-in provider.
- The component fetches contribution activity and refreshes automatically. A successfully fetched graph with zero contributions is valid; a failed or missing fetch is not.
- A new graph, or a graph whose username or access configuration has changed, cannot be published until its account configuration is connected and its data has been fetched successfully. Owners can retry setup or remove the component to proceed without it.
- Owners can explicitly enable private activity and authorize the matching GitHub account. Private activity is available only when the selected graph username matches the authorized account.
- Private activity appears as anonymized contribution counts. Private repository names, code, and contribution details do not appear publicly. The component explains that enabling this option makes those counts visible to visitors.
- Switching to another username disables private activity until the matching account is authorized. Repository statistics remain deferred.
- If a later automatic refresh fails, the published site retains the last successfully fetched graph and shows its last-updated date. The builder displays the failure and offers Retry or Reconnect as appropriate.
- Disconnecting GitHub or revoking private access stops private refreshes and removes private contribution data from the public graph. The graph uses available public-only data or shows a clear unavailable state while it recovers.
- Failed, cancelled, or wrong-account private authorization preserves the existing public graph and offers Retry for the selected account, public-only setup, or later editor repair with an incomplete publication-blocking state. Optional graph failures never block editor entry after required setup.
- Explicit graph removal in onboarding or the editor confirms removal and withdrawal of the separate private grant. It removes the draft component, immediately disables private access/data, and revokes the grant with retryable cleanup. GitHub sign-in remains connected. Skipping questions retains the component and grant.
- GitHub documents anonymized private contributions and additional GraphQL access through `read:user`. Implementation must follow the provider's visibility and authorization rules. See [GitHub contribution visibility](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile) and [GitHub GraphQL user reference](https://docs.github.com/en/graphql/reference/users).

### 10. Contact form and message delivery

- Owners can add one optional contact form. Its setup requires a verified recipient email, initially the account's verified email. If a provider does not supply one, the owner must add and verify an address before publishing the form.
- Visitors enter their name, email, and message. The form validates required fields and email format and explains errors beside the relevant fields.
- Spam protection and submission limits protect message delivery. Blocked or excessive submissions receive a clear response rather than a false success message.
- The system sends accepted messages to the owner's verified recipient email. That address is not exposed through the public form.
- Visitors see success once the system accepts a message for delivery. Submission failures offer retry guidance and do not claim that a message was accepted.
- The system retries temporary delivery failures and notifies the owner if delivery ultimately fails. Form setup and explicit test messages let owners check delivery before sharing their portfolio.
- The MVP has no message inbox inside the builder, visitor attachments, or automatic replies.

### 11. Resume download and public resume page

- Owners can upload one PDF resume and replace or remove it. The same file supplies resume download buttons and the public `/resume` page.
- Owners can add the optional resume download control and choose its position among the portfolio components. It must have a valid uploaded PDF before publication.
- Visitors can view the PDF on `/resume`, download it, and use Back to portfolio navigation. The page provides a download fallback if embedded viewing is unavailable.
- The resume page uses the portfolio's shared appearance. It does not provide a structured resume authoring tool.
- Uploading, replacing, or removing a resume changes the draft. Publish updates the file available to visitors and any associated download controls. When no resume is published, `/resume` shows a clear unavailable-page state.

### 12. Themes, custom color, fonts, and light/dark mode

- Owners can choose among six preset visual themes: Leaf, Violet, Clay, Matcha, Strawberry and Coffee. Each has light and dark palettes. All use the single template; switching themes preserves content and component order. The [appearance catalog](appearance-catalog.md) records the approved IDs, colors, assets and defaults.
- Owners can select a font from a curated list. Typography applies consistently to the portfolio, case studies, and resume page.
- Custom color control accepts one owner-selected color. The builder automatically generates the other colors needed for both light and dark themes, including page backgrounds, raised surfaces, text, borders, links, buttons, and interactive states.
- Generated palettes adjust colors for readable contrast. The builder explains automatic adjustments and previews both light and dark results immediately.
- Owners can reset custom colors to a preset. Editing every generated color individually is deferred.
- Owners choose light, dark, or the visitor's system preference as the initial mode. Visitors can switch between light and dark on public pages.
- Shared settings apply across components and additional pages. Arbitrary positioning, custom CSS, per-component fonts, and extensive layout customization are deferred.

Animated decorations autoplay unless the visitor requests reduced motion. A separate, keyboard-accessible pause/play control stops or resumes the decoration without toggling Face Reveal. A paused or reduced-motion cat uses the cleaned still; hands remain stationary with their original art. Changing motion preference takes effect immediately. Decoration selection works with Face Reveal off and remains above both images when it is on. These are trusted platform assets, not additional owner upload formats.

### 13. Upload handling

- Image uploads accept JPEG, PNG and WebP files up to 5 MiB each, exactly 5,242,880 bytes. Resume uploads accept PDFs up to 10 MiB, exactly 10,485,760 bytes.
- Avatar and banner controls support uploading, replacing, cropping, and removing images. Project cards and case studies support image uploads, replacement, and removal.
- The combined onboarding profile screen and editor share crop dialogs with repositioning, zoom, Reset, Apply crop, and Cancel. Imported provider photos use the same controls. Save only the finished cropped image; Reset uses the current local selection, and recovering excluded areas after returning requires selecting the original file again. Required profile setup waits for ready uploads and accepted crops.
- Owners see upload progress, completion, and errors for unsupported formats, oversized files, interrupted transfers, or failed uploads. Failed uploads offer a retry path and do not replace the previous successful asset.
- Owners can provide descriptions for meaningful images so visitors using assistive technology can understand them. Decorative images and avatar overlays must not introduce redundant announcements.
- Removing a required avatar or banner blocks republishing until a replacement is ready. The current published images remain visible while the owner completes the draft.
- Uploaded assets belong to the private draft until publication. Replacing an asset must not silently change the file used by the currently published version.

### 14. Automatic draft saving and recovery

- The builder automatically saves content, component order, appearance settings, and completed upload references to the owner's draft.
- Onboarding uses that same canonical draft and save/conflict behavior, with private progress metadata. Valid saved values resume across devices; invalid unfinished input is recovered only in the same browser and is not labeled cloud-saved. Successful first editor handoff is permanent and prevents stale setup tabs from reinitializing the portfolio.
- Save status distinguishes Saving, Saved, and Couldn't save. The builder reports a failed save and offers retry rather than presenting unsaved work as saved.
- Reopening the builder restores the latest saved draft. Recoverable unsaved edits remain locally available after a temporary failure or interruption.
- The builder detects changes saved by another tab or device and prevents silent overwrites. Owners can load the newer saved version or preserve their local edits for review before resolving the conflict.
- Expired sessions prompt reauthentication without discarding recoverable work. Interrupted uploads can be retried. Publishing waits until current edits and required uploads have saved successfully.
- Local recovery is a safeguard for unsaved work, not a version-history feature. Saved drafts remain separate from the published website.

### 15. Subdomain selection and publication

- The first required onboarding screen selects a subdomain, checks availability, and reserves it when the save succeeds. Before first publication, owners can review or change the reserved address in the editor. Names contain 3–30 lowercase letters, numbers, or hyphens, with no leading or trailing hyphen. Platform-reserved names cannot be selected.
- The builder explains invalid or unavailable names and lets owners choose another. An availability check alone does not reserve. A successful save atomically creates an exclusive reservation owned by that portfolio and prevents another owner from selecting or publishing the name. Concurrent selections produce exactly one reservation; the other owner receives an unavailable-name result and chooses another.
- A reservation creates no public site and is not a permanent claim. Owners can change it until first publication; a confirmed change reserves the new name and releases the old one in one transaction. An invalid, unavailable, or failed change leaves the current reservation intact.
- First Publish verifies the portfolio still owns the reservation and converts it to the permanent claim in the same operation that switches the live version. A failed first publication keeps the reservation and reports neither a live website nor a successfully claimed address.
- The public address follows `username.hasaweb.site`. The address is fixed after first publication for the MVP.
- A publication checklist identifies missing required profile content, invalid links, incomplete uploads, and included components that lack their required setup. Each issue links to the relevant editor control.
- The minimum publishable portfolio has a real name and bio, accepted avatar and banner, at least one valid social or contact link, and a valid reserved subdomain. Optional projects, case studies, and personalization are not required.
- Untouched optional samples are omitted. Owner-edited optional components must be complete enough to function: a GitHub graph needs a successful fetch, a contact form needs a verified recipient, and resume controls need a valid PDF.
- Publish saves and validates the current draft, then updates the complete portfolio and its additional pages as one operation. Visitors must not see a mixture of old and new page content.
- A failed publication leaves the previous public version intact and offers Retry. A failed first publication must not report a live website or a successfully claimed address.
- A reservation is held for the life of the account. Account deletion releases an address that was never published; a published address remains permanently reserved.
- After success, owners receive the public URL with Open and Copy actions. Later publications update that same address.

### 16. Public visitor experience

- Published portfolios adapt to phones, tablets, and desktops. Content order and meaning stay consistent as the layout changes.
- Visitors can read the profile, inspect the owner's selected components, open project case studies, follow code/demo/social links, view and download the resume, and send contact messages when those capabilities are published.
- Visitors can switch light/dark mode. All public pages use the owner's shared appearance settings.
- Navigation and controls support keyboard use, visible focus, understandable labels, and readable generated colors. Meaningful images have descriptions, and forms provide understandable validation and submission feedback.
- Draft previews stay private to the owner. Public visitors cannot edit content or access unpublished draft assets.
- Missing pages, unavailable portfolios, and unavailable external data show clear states. An unavailable GitHub component must not prevent the rest of a published portfolio from loading.
- Visitors do not need accounts. Visitor analytics and cookie-based tracking are deferred.

### 17. Search and social sharing

- Owners can edit the portfolio's page title, description, and social sharing image. Defaults come from the profile, and preview explains how the portfolio will appear when shared.
- Published pages provide search and sharing metadata. Case studies and `/resume` use appropriate page-specific titles within the portfolio identity.
- Published portfolios are publicly accessible and eligible for search indexing. Drafts are private and must not appear in search results through public draft URLs.
- Unpublished and removed pages stop serving the former public content. Search engines and third-party sharing services may retain cached results outside the builder's control.

### 18. Return, manage access, unpublish, and delete

- Owners returning before first editor entry resume onboarding. After first entry, they reopen their saved editor draft directly, edit any included capability, preview the result, and explicitly publish or republish. Onboarding does not rerun when required publication content is removed later.
- Account settings show connected GitHub and Google providers. Owners can connect or disconnect providers after proving ownership, but must retain at least one usable sign-in method.
- Disconnecting GitHub removes its authorization and private activity access as described in the GitHub component rules. Owners can reconnect when they want to restore authorized capabilities.
- Owners can sign out. Authentication failures and expired sessions offer a route back into the same account and portfolio.
- Owners can unpublish their portfolio. This removes public access to the portfolio, case studies, and resume while retaining the draft and its published address claim. Owners can later republish at the same address.
- Permanent account deletion requires explicit confirmation. It removes the public portfolio, draft content, stored uploads, and connected-account access. It releases a never-published reservation; a previously published address remains permanently unavailable. The confirmation explains the loss before deletion proceeds.

## Features deferred beyond the MVP (Out of Scope)

- Education components; additional portfolios per account; additional templates and alternative layouts.
- Billing, subscriptions, checkout, paid feature restrictions, and custom domains.
- Custom decoration uploads, image stickers, arbitrary positioning, custom CSS, per-component fonts, and individual editing of generated palette colors.
- Automatic GitHub project imports and repository statistics. Private contribution activity is included in the MVP.
- Proficiency ratings and automatic skill extraction.
- Structured resume editing, a builder message inbox, contact attachments, and automatic message replies.
- AI content generation, collaboration, visitor accounts, multilingual editing, version history, and visitor analytics or cookie-based tracking.
- Repeat onboarding, an editor bypass before required initial setup, goal/persona surveys, automatic content discovery, and retained original image sources for later uncropping. Additional onboarding steps for capabilities designated editor-only in [onboarding.md](onboarding.md) are outside the initial onboarding scope; those capabilities remain required in the full MVP editor.

The feature scope is agreed. The [appearance catalog](appearance-catalog.md) lists the approved themes, fonts and decorations, and [architecture.md](architecture.md) records provider configuration, refresh and retry intervals, and submission limits.
