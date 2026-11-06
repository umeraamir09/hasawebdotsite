# Phase 34: Resume download and `/resume`

## Scope and acceptance

Requirements: [product section 11](../../docs/product.md#11-resume-download-and-public-resume-page), [acceptance criteria section 11](../../docs/acceptance-criteria.md#11-resume-download-and-public-resume-page), PDF limits in [acceptance section 13](../../docs/acceptance-criteria.md#13-upload-handling), and the [Phase 34 roadmap entry](../../docs/roadmap.md#phase-34-add-resume-download-and-resume).

Changes:

- Owners manage one PDF on the singleton resume component: upload, replace and remove.
- The optional, ordered resume section renders a download control and a link to `/resume`.
- `/resume` is a themed public page. It has an embedded viewer, a download fallback and Back to portfolio.
- With no published resume, `/resume` returns the page-unavailable state.

Out of scope: structured resume editing, onboarding wiring (Phase 42) and saved appearance beyond the default renderer styling (Phase 35).

Acceptance checks:

- The page and the download controls serve the same published PDF bytes.
- An included control without a valid PDF blocks publication.
- After Publish, a removed or unpublished resume no longer serves its former file.

Prerequisites: Phases 17, 18, 24, 25, 26 and 27 are owner-approved and integrated. Phase 23 is built, and its owner completion approval is pending. The owner confirmed that this does not block the work. Shared base: `main` at `5939ebc`, after Phase 30 (PR #42) merged at the owner's request. Branch `feat/34-resume-download`, worktree `.claude/worktrees/phase-34-resume-download-35e77f`.

Write boundaries:

- Resume display model, section and page views; frames path set; portfolio CSS.
- Renderer `resume-page` fragment and the `objectOrigins` CSP option.
- Publication preparation `resume-file` command, dispatcher resume rendering and renderer version.
- Site asset serving for the `/view` variant.
- Editor resume controls, the private upload client and the publication correction panel.
- Tests and the editor browser journey.

The draft schema, migrations, publication index/validation SQL and upload HTTP contract are unchanged.

## Decisions

- **One file, two URLs.** The PDF stays on the resume component's `data.file` from the existing schema. Publication already indexes it, transfers it with purpose `resume` and guards it by the active manifest. Download controls link to the retained asset URL `https://assets.hasaweb.site/candidate/{id}/assets/{assetId}`. That URL is served with `Content-Disposition: attachment; filename="resume.pdf"`, because a cross-origin `download` attribute is ignored. `/resume` embeds `{url}/view`, which serves the same receipt inline. Both URLs resolve through the same `assetFile` active-version check, so withdrawal covers both. This replaces the architecture's planned same-origin `/resume.pdf`.
- **Framing.** The `/view` response replaces the document CSP with `frame-ancestors https://{subdomain}.hasaweb.site`, so the browser PDF viewer can run inside the frame. Only `application/pdf` receipts have a `/view` variant. Image assets return the generic 404.
- **Page CSP.** Only `/resume` gets `object-src` and `frame-src` set to the asset origin, through `portfolioHeaders(..., {objectOrigins})`. All other pages keep `object-src 'none'` and no `frame-src`. `frame-ancestors 'none'` is unchanged.
- **Fallback.** `<object type="application/pdf">` holds static fallback text, and an always-visible `Download resume (PDF)` control follows it. No script is involved.
- **Renderer version.** The resume section and page output changed, so `PUBLICATION_RENDERER_VERSION` is now `publication-v3`. Unfinished `publication-v2` candidates follow the existing renderer-policy rejection.
- **Unavailable state.** `/resume` relies on the Phase 30 page-unavailable fallback. When the published manifest has no `/resume` page, the request gets that version's `/404` document with Back to portfolio. Unknown and unpublished hosts keep the generic "Portfolio unavailable" page.

## Results

Local gate: `pnpm verify --profile=full` passed on November 6, 2026 at `e6da449` with a clean working tree (run `2026-11-06T08-29-43.809Z-SK5LIf`). The `full` profile is required because the change touches the shared display model, renderer CSP, publication renderer version and public serving. All 14 commands exited 0, including:

- `pnpm check`: 506 unit tests.
- Renderer browser: 27 groups.
- Private uploads: 11 groups.
- Publication dispatch: 43 S-8 integration groups.
- Publication serving.
- Draft API: 19 groups.
- Editor browser: 47 groups, including the resume journey.
- Auth, persistence, autosave, runtime smoke and routing (31 boundaries).

The first full run, at `321f6ca`, failed in publication dispatch with `mixed page 2 mismatch`. The offline expected-output fixture still built the old `/resume` body. Commit `e6da449` updated `apps/jobs/integration/publication-fixtures.ts` to expect `PortfolioResume` and the `/view` URL, and the rerun passed.

Focused checks during development:

- `pnpm typecheck` and `biome check` pass. The 7 `noDescendingSpecificity` warnings in `apps/web/components/editor.css` predate this change.
- `pnpm test` unit suites pass, including these new tests:
  - Renderer: projection to `url`/`viewUrl`, missing and foreign-origin states, section download and `View resume` markup, page embed/fallback/back link, origin rejection, and the `/resume`-only `object-src`.
  - Preview: a resume resolves only from a private `application/pdf` response.
- Editor browser journey `resume controls and /resume publish, replace and withdraw one PDF` (`scripts/resume-browser.mjs`) passes against the real owner API, publication dispatcher and site serving fixture. It checks:
  - **Ordering:** the resume and social-links sections publish in editor order.
  - **Blocked publication:** an included resume without a PDF blocks Publish with `Complete your resume download resume PDF`. That issue opens the correction panel with the resume upload control.
  - **File checks:** a PNG and a PDF of 10,485,761 bytes are rejected before upload. A PDF of exactly 10,485,760 bytes uploads as a ready `resume` asset.
  - **Same file:** after Publish, the home control and `/resume` link the same asset URL. The download bytes equal the uploaded file (SHA-256) with an attachment disposition. The `/view` bytes are identical, served inline with `frame-ancestors https://resume-site.hasaweb.site`. Banner `/view` returns 404.
  - **Visitor flow:** in Chrome, the `/resume` object loads the published PDF in the built-in viewer. The download control saves `resume.pdf` with identical bytes. Back to portfolio and View resume navigate. The page has no horizontal scroll at 375 px.
  - **Fallback:** with the `/view` request blocked, the fallback text shows and the download still returns identical bytes.
  - **Replacement:** a new PDF changes only the draft until Publish. Afterwards, both page and control use the new asset, and both old URLs return 404.
  - **Removal:** removing the PDF while keeping the control blocks Publish, and the published file stays live. Removing the control and publishing gives `/resume` 404 "Page unavailable" with a back link. The download, `/view` and query-variant URLs then return 404 for GET and HEAD.

Limitations:

- Fallback content cannot be detected with CSS, so the fallback keeps the viewer's fixed height. On browsers without inline PDF support, that leaves an empty framed area above the download control.
- The local fixture does not establish deployed CDN/browser withdrawal (S-9), paid CPU budgets or real mobile-browser PDF behaviour.
- Saved theme/font/mode for `/resume` follows Phase 35.
- In the private editor preview, the download control fetches the owner-authorized draft PDF. `View resume` is a same-site `/resume` path, like Phase 30's case-study links, so the preview does not render a `/resume` page.
- No separate publication/withdrawal boundary review has been run. This change touches public serving headers and withdrawal behaviour, so the workflow calls for one.

Approval: owner approved completion on November 6, 2026 (PR #43, `87d2290`).

## Documentation impact

Changed assumptions:

- The resume PDF is served from the asset origin as an attachment, with an inline `/view` variant, not as a same-origin `/resume.pdf`.
- `/resume` alone permits `object-src`/`frame-src` for the asset origin.
- The resume display model and the `/resume` page frame are active.
- The renderer version is `publication-v3`.

Updated guidance:

- [architecture](../../docs/architecture.md): sections 8.4, 9.2 and 10.
- [components README](../../packages/components/README.md), [render README](../../packages/render/README.md) and [private upload README](../../apps/web/lib/assets/README.md).
- [implementation status](../../docs/implementation-status.md) and the [roadmap](../../docs/roadmap.md) record link.

Historical specs keep their original evidence. The architecture storage table's `resume/index.html`/`resume.pdf` layout is the pre-Phase 24 plan; the candidate manifest layout already superseded it, so it was left unchanged.

Unresolved prerequisites: Phase 23 owner completion approval, Phase 35 appearance on `/resume`, Phase 42E activation and S-9 deployed withdrawal verification.
