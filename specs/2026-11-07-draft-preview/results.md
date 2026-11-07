# Phase 39: Full-page draft preview

## Scope and acceptance

Requirements: [product section 3](../../docs/product.md#3-edit-arrange-and-preview-the-portfolio), [acceptance criteria 3.7–3.8](../../docs/acceptance-criteria.md#3-edit-arrange-and-preview-the-portfolio), [architecture 9.2](../../docs/architecture.md#92-rendering-model) and [section 10](../../docs/architecture.md#10-security-and-privacy), and the [Phase 39 roadmap entry](../../docs/roadmap.md#phase-39-finish-full-page-draft-preview).

Changes:

- Authenticated saved-draft navigation for the portfolio (`/preview`), project case studies (`/preview/projects/{slug}`) and the resume page (`/preview/resume`). The preview shows the saved draft, not unsaved editor state.
- Outbound links, theme switching, Face Reveal (including pause/play) and embedded/download resume behavior are exercised in preview through the shared renderer and `installSite`.
- Every preview route is private, `noindex` and `no-store`. Unsigned and wrong-account requests fail identically.
- Draft resume and case-study assets are owner-only and stop working after sign-out or session expiry.
- Preview contact forms cannot reach a delivery path.

Out of scope: the explicit contact-settings test action (later contact phases), contact form delivery (Phases 43–45), page-specific titles and production activation of the guide/editor (Phase 42E).

Prerequisites (all owner-approved and on `main` at `d0935df`): Phases 17, 30, 34, 35 and 38. Branch `feat/39-draft-preview`, worktree `.claude/worktrees/phase-39-draft-preview-10fe1a`. No other implementation worktree touches these files. No delegated workers.

Write boundaries: the shared page model and mount in `packages/components`; the web Worker gate, inline private PDF variant and preview client in `apps/web`; the preview asset build step; tests and fixtures; current guidance.

## Decisions

Owner decisions, November 7, 2026, before implementation:

- **Owner check.** The web Worker gates `/preview` routes before OpenNext. Every unsigned, expired, no-portfolio, wrong-origin or non-GET request gets the same empty 404 with private/no-store and noindex headers. Preview URLs name no draft, so a signed-in account can only ever see its own saved draft.
- **Registration.** The routes are registered in the production Worker now. They need a live owner session, and the editor itself stays dormant until Phase 42E.

Design that follows:

- **No second rendering path.** A page is the strict pair `{model, page}`: the Phase 16 display model plus a `portfolio`, `case-study` or `resume` page. `projectPreviewPage` reuses `projectPortfolio` and the existing `resolveImage`/`resolveFile`, and `PortfolioPage` composes the same `PortfolioProfile`, `PortfolioSection`, `PortfolioCaseStudy` and `PortfolioResume` views that publication uses. `mountPreview` and the new `mountPreviewPage` share one lifecycle (strict parse and origin recheck, appearance attributes, one React root, `installSite`). The pair never crosses the iframe bridge, so the Phase 17 transport envelope and its tests are unchanged.
- **Same pages as publication.** A path maps to a case study only when a non-sample project has that slug, numbered in document order like the published `case-N` section ID. `/resume` exists only when a resume component exists. Anything else shows a page-unavailable state with a link back to `/preview`, like the published `/404`.
- **Links.** Markup keeps the root-relative `page-link` paths the renderer already emits. `mountPreviewPage` rewrites each `a.pf-page-link` under `/preview` after rendering, validating the path against the closed `pagePathSchema`. No shared markup changed.
- **Theme choice across pages.** The published origin stores the visitor's choice, so it follows them between pages. The live preview keeps it in memory. A multi-page preview that forgot it on every navigation would differ from the public site, so `mountPreviewPage` stores it in tab-scoped `sessionStorage`, tagged with the owner's saved mode so a changed saved mode resets it. Nothing outlives the tab.
- **Saved draft only.** The client reads `GET /api/owner/draft` with the pinned owner ID, never the editor's working copy. It rechecks the owner and the revision on focus, visibility and back/forward-cache restore, so edits saved in the editor appear without a reload and a sign-out removes the display.
- **Inline resume.** Private reads return the PDF as an attachment, which an embedded `<object>` cannot show. `GET /api/assets/{id}/view?purpose=resume` is the owner-only inline variant, mirroring Phase 34's public `/view`. It accepts only the `resume` purpose and a stored PDF, repeats every ownership, session, readiness and object check, and may be framed only by the same origin. The preview's `/preview/resume` response alone allows `object-src`/`frame-src 'self'`.
- **Shell instead of a Next page.** The Worker serves a fixed, draft-free shell with an external module script. OpenNext's inline hydration scripts would have needed a weaker CSP. The shell's client is an esbuild bundle (`apps/web/scripts/build-preview-assets.mjs`, run by the web build) and the platform fonts and cat art are copied to their hashed manifest paths, because the generated stylesheet links them there. Both are public static files with no owner data.
- **Contact.** No contact form exists before Phases 43–45, so the Contact section still renders "Contact form unavailable." Preview cannot reach a delivery path by construction: `form-action 'none'`, no form element, and no contact route on the app origin. The only app-origin code that touches `CONTACT_QUEUE` is the local runtime probe `/api/dev-runtime`, which answers 404 unless `APP_ENV` is `local` and the host is `localhost`/`127.0.0.1`, and enqueues a bare ID, not a message. The explicit Send test message action is not built.
- **Test harness.** The fixture owner API refuses callers without the harness runtime key. The fixture gateway wraps `OWNER_API` to add it for the Worker's own owner-check request. Production sends only the visitor's cookie.

## Results

Local gate: `pnpm verify --profile=full` passed on November 7, 2026 (run `2026-11-07T16-18-18.529Z-13pxRc`, base `d0935df` plus the uncommitted Phase 39 working changes). The full profile is required because the change touches routes, owner authorization, the private asset handler, the shared display model and renderer mount, and the web build. All 14 commands exited 0:

- `pnpm check`: lint, typechecks and 550 unit tests in 52 files, including the new Worker gate tests (6) and page projection tests (10).
- `pnpm build`.
- Renderer browser: 31 groups (the refactored `mountPreview` lifecycle). Auth browser, persistence (88 checks), private uploads (11 groups, including the existing PDF attachment reads), publication dispatch (44 groups) and serving (4), draft API (19), autosave.
- Editor browser: 55 groups, including the new `full-page draft preview is private, owner-only and matches the published pages` journey. The first Phase 39 editor run of that group failed on harness issues only, listed below.
- Runtime, runtime smoke and routing (31 boundaries).

After that run I added one path (`/api/dev-runtime/web/run`) to the contact replay list in the journey. I then reran that editor group alone against the same build, and it passed (36 s). No other source changed after the gate except this record.

Defects and harness fixes found while testing:

- The shared esbuild step named fixture outputs by directory depth once a third entry point was added. Entry names are now explicit.
- The fixture owner API rejects callers without the harness runtime key, so the Worker's own owner check returned 404 in the fixture. The gateway now adds the key to that call. Production does not use it.
- A first parity comparison failed on attribute order alone (client React versus static markup). The comparison now sorts attributes. Nothing else is normalized except asset locations, the `/preview` link prefix and platform file hashes.
- The sitemap check first failed because the test address contained the word `preview`. The published sitemap and robots files are real, so the check now reads them and the address is `check-site`.

## Verification

Proof for each named risk (all in `scripts/draft-preview-browser.mjs` unless noted):

| Risk | Evidence |
| --- | --- |
| Every route is private, `noindex` and `no-store` | Unit tests check the exact headers on success and on every failure. The journey requests all three routes through the production Worker and checks `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow, noarchive`, `Vary: Cookie`, `X-Frame-Options: DENY`, the CSP (`script-src 'self'`, `form-action 'none'`, no `unsafe-`/nonce/hash, `object-src 'none'` except `'self'` on `/preview/resume`) and the `robots` meta tag. The browser document has no inline script and no form. The shell has no canonical, alternate or sitemap links and is byte-identical for every route and account. |
| Unsigned and wrong-owner requests fail without leaking | Unsigned requests to all three routes, an unknown slug and an unknown path return the same empty private 404. Unit tests add expired sessions, no portfolio, another origin, POST, HEAD and invalid paths, with identical empty bodies. Preview URLs name no draft. A second account's `/preview` is its own draft-free shell and its draft read holds none of this owner's content. Unsigned and second-account reads of the resume download, inline view, case-study image, avatar and Face Reveal photo all return an empty 404; the owner gets 200. |
| No shared-cache storage, no sitemap or search metadata | Every response, including failures, is `private, no-store` with `Vary: Cookie`. The published `/`, case-study and `/resume` pages contain no `/preview`, and the published `sitemap.xml` and `robots.txt` list only the three public URLs. The app origin has no sitemap or robots route. |
| Draft assets owner-only and dead after sign-out or expiry | With a second session of the same owner, the resume download, inline view, case-study image, avatar and the preview routes return 200. Deleting that session returns 404 for all six, and the open preview tab replaces its display with "Sign in to open your private preview." on the next focus. Setting `expires_at` to 1 gives the same 404s. The owner's other session is unaffected. The inline variant rejects the wrong purpose, a non-PDF and a missing purpose. |
| Contact replay | `POST` of a message-shaped body to `/_/contact`, `/preview/_/contact`, `/preview/resume`, `/api/contact`, `/contact` and the local runtime probe, as signed-out and signed-in users, returns 4xx and never 202. `contact_outbox` is unchanged. The preview tab sent no request to any contact path or outside web origin. With a Contact section in the saved draft, preview shows "Contact form unavailable." and no form. |
| Preview matches the public render | Normalized markup of the preview and the published page is equal for the portfolio, the case study and the resume page, which covers theme attributes, fonts, order, images, links and the resume viewer/download markup. The Face Reveal and playback session (`exercise`, with reveal, pause/play, keyboard, reduced motion and wipe checks) produces deep-equal traces on `/preview` and the published page, and every reload starts on the original avatar. The saved Violet/Lora/light appearance applies and the toggle works on all three pages, following the owner across pages. Outbound links keep `rel="noopener noreferrer"` and open their destination. The downloaded resume bytes equal the upload, and Chrome's built-in PDF viewer opened the embedded inline file. With the inline request blocked, the fallback text shows. |
| Saved draft, not editor state | After a server-side save the editor tab still holds the old working copy, while the preview shows the saved value after a focus recheck without a reload. A page the published site would not have shows the unavailable state: unknown slugs in the journey, and a missing resume component or sample project in the projection unit tests. |

Not verified:

- No deployed check: Cloudflare's static-asset handling of the new `_headers` rules, edge or shared-cache behavior for the `no-store` responses, and the Worker route on a real hostname. The S-9 and paid-provider gates are unchanged.
- The Worker's owner check was exercised through the fixture gateway, which adds a harness-only runtime key to the Worker's own owner-service call. The production call carries only the visitor's cookie and is the same call shape as the existing `/api/owner` forward, but no local run proves it against the production owner entrypoint.
- Chromium (installed Chrome) only. Other engines, real mobile browsers and `sessionStorage` behavior under strict privacy settings belong to the Phase 53 matrix. The back/forward-cache restore path is implemented but not exercised.
- Contact forms and the preview-only notice do not exist before Phases 43–45, so no notice is shown or tested. Their roadmap entries already list Phase 39 as an integration requirement. Page-specific titles remain with Phase 46.
- No separate boundary review of the access and header handling has been run. The owner plans to request it.
- `pnpm lint` reports the 8 existing warnings only.

Approval: the owner approved Phase 39 completion on November 7, 2026, after the local `full` gate and the diff summary. The roadmap box is checked in the same change. The separate boundary review of access and header handling remains pending at the owner's request.

## Documentation impact

Changed assumptions: full-page preview routes were described as future work (`/preview/...` in Phases 18/39/42E); the iframe adapters were all dormant; private PDF reads had no inline variant; the display projection resolved only the portfolio page; the web build produced no static preview files.

Updated guidance: [architecture 9.2](../../docs/architecture.md#92-rendering-model); [authentication](../../docs/authentication.md#full-page-draft-preview-authorization) (owner check, uniform 404, headers, static files); the [implementation baseline](../../docs/implementation-status.md) (new row and the editor-preview row); the [roadmap](../../docs/roadmap.md#phase-39-finish-full-page-draft-preview) record link (checkbox unchanged); the [components README](../../packages/components/README.md#full-page-preview-pages); the [private asset README](../../apps/web/lib/assets/README.md) (`/view`); the [draft client README](../../apps/web/lib/draft/README.md); the [editor verification recipe](../../.agents/skills/verify-hasaweb/features/editor-preview.md); and the `.gitignore`/`_headers` entries for the two generated static directories. Historical Phase 17, 30, 34, 35 and 38 records keep their statements that full-page navigation was Phase 39 work.

Unresolved prerequisites: the preview-only notice and test-message action (Phases 43–45); page-specific titles (Phase 46); Phase 42E activation of the guide and editor; the deployed cache and S-9 checks; and the separate boundary review.
