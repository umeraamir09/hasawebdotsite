# Phase 30 project case studies

## Scope and acceptance

Implement [Phase 30](../../docs/roadmap.md#phase-30-add-project-case-studies), the case-study subset of [product section 5](../../docs/product.md#5-projects-and-case-studies) and [acceptance section 5](../../docs/acceptance-criteria.md#5-projects-and-case-studies) (criteria 4–7). This covers optional case studies on project cards, the Phase 29 rich-text editor extended with uploaded images, generated and frozen `/projects/{slug}` URLs under [architecture section 8.3.1](../../docs/architecture.md#831-case-study-urls), the public case-study page with back navigation, and the unavailable-page state after a published removal. The publication integration (Phases 23–26) is done here, not deferred.

Out of scope: rich-text changes other than images, Phase 28 card behavior except the case-study link, page-specific titles (Phase 34), authenticated full-page draft navigation (Phase 39) and production activation (Phase 42E).

Prerequisites 18–19 and 28–29 are owner-approved and on `main`; Phases 23–26 are integrated. Shared base `8939bbc`. Branch `feat/30-project-case-studies`, worktree `.claude/worktrees/phase-30-case-studies-982eb3`. Write boundaries: schema slug helpers and issue code, publication index/check/owner read, bounded preparation and finalization, site serving fallback, renderer frames and card/page views, editor case-study and shared rich-text controls, affected tests and current guidance. No delegated workers.

## Decisions

The owner confirmed two choices on November 6, 2026 before implementation:

- **Slug reuse.** Keep the architecture rule and add a guard. A deleted project keeps its live slug until that deletion is published, so a new project in the same draft or publication gets `-2`, `-3` and so on, and no single Publish moves a URL from one project to another. After the deletion is live, a later project may take the slug, as section 8.3.1 allows.
- **Case-study images are not cropped.** They follow the Phase 28 project-image path: validated, re-encoded uploads through the shared `ImageUpload` control, with replace, remove, description, Retry and pending-publication state.

Design that follows from the existing contracts:

- **Freeze authority.** The live version's `publication_candidate_index` now records each case study's project ID with its slug. Frozen slugs are read from the version that `portfolio.published_version` points to, so they change atomically with the pointer flip and need no new table or migration. Versions indexed before this change lack IDs; their slugs are matched by name only and do not block other projects.
- **Enforcement.** A new `case_study_url` publication issue rejects a draft that changes a frozen slug or uses a slug that the live version assigns to another project. Candidate creation runs this check, and commit is guarded on the expected pointer, so a stale tab cannot publish a reassigned or changed URL. The editor reads frozen slugs from `POST /api/owner/publication/case-studies` on mount and after each Publish, restores frozen slugs, and moves unfrozen slugs off live URLs.
- **Image storage.** The existing strict schema settled this: top-level `image` blocks in case-study bodies with only `assetId` and optional `alt`. The Tiptap `image` node mirrors it, with no HTML parse rule, so pasted, dropped or `<img src>` content never creates a node. Images are inserted only from a ready `case_study` upload.
- **Rendering.** New closed frames `page-link` and `page-nav` take a same-site `path` (`/` or `/projects/{slug}`), separate from the external `href` allowlist. Cards render `Read case study: {title}` and case-study pages render a back link to `/`. React and bounded preparation emit identical frames, and `PUBLICATION_RENDERER_VERSION` moves to `publication-v2` so in-flight old-format candidates are not mixed.
- **Unavailable state.** Each version's `/404` is now a page-unavailable document with a link back to the portfolio. The site Worker serves it for any missing page of a published portfolio. Unpublished and unknown hosts keep the generic response.

Read-only Figma was not needed. The controls reuse the existing editor field, upload and rich-text styling.

## Results

- Schema: `case-study.ts` implements the 8.3.1 slug rules (ASCII folding, hyphen collapsing, 80-character limit with suffix truncation, `project` fallback), `assignCaseStudySlug` and `reconcileCaseStudySlugs`, address schemas and the `case_study_url` issue code.
- Server: project IDs in the candidate index, the frozen/reserved slug check rule, the owner address read and route.
- Renderer and publication: card link and case-study page shared by React and bounded preparation, new frames and styles, the page-unavailable `/404`, and the site fallback for missing pages.
- Editor: `CaseStudyControls` per project (add, confirmed remove, address display, frozen notice), the Phase 29 Tiptap setup extracted into a shared `RichTextEditor` with an image node only for case studies, title edits regenerating unfrozen slugs, and planner field patches for slug changes unless two slugs swap.

Defects found and fixed while testing:

- The first case-study check SQL had a doubled `WHERE`. The new persistence checks caught it before any browser run.
- The shared editor parsed the body on each render, which caused a React update loop (error #185). It now uses the store's stable reference.
- **Inherited from Phase 29.** The editor re-synced whenever `JSON.stringify(editor.getJSON())` differed from the stored body. Tiptap emits text-node keys (`marks`, `text`) in a different order than the schema, so in any body that contained a link, each edit called `setContent` and reset the cursor to document level. In case studies, the next keystroke or paste then replaced the selected image. Both sides are now compared in schema order. After an image insert, the cursor is also kept in the text block before the image.

## Verification

Risk cases and where they are proven:

| Risk | Evidence |
| --- | --- |
| Title edit after first publication keeps the URL | Browser journey renames after Publish: editor address, card link and served page stay at `/projects/build-pipeline`, and the new-title path returns the page-unavailable 404. Persistence check rejects a changed frozen slug and accepts the frozen slug with a new title. |
| A freed slug is not silently reassigned | Browser: deleting a published project and re-adding the same title assigns `-2`. A stale-tab draft that takes the live slug is blocked at Publish with the `case_study_url` issue, and reload restores `-2`. Only after the deletion publishes does a new project get the original slug. Persistence checks cover the same rule against the live index. |
| Removed case-study images stop serving after Publish | Browser: before Publish, removing a case study and a project leaves pages and images live. After Publish, both case-study image URLs (plain and query variant, GET and HEAD) return 404 and both pages return the page-unavailable state with `Back to portfolio`. |
| Cards and case studies publish atomically | Browser: with commit blocked, the old card summary and old case-study body both remain live. After Retry, both change together. All pages share one manifest and pointer flip. |
| Image nodes cannot bypass Phase 29 sanitization | 14 real HTTP submissions (remote `src`, `onerror`/`style`, invalid IDs, content/marks on images, `img` type, raw HTML, inline/list/text-section placement, attribute-path patch) return 422 with the canonical draft unchanged. Browser hostile paste of `<img src onerror>`, `<script>`, `<figure><img>` and `javascript:` creates no image node; the saved image has only `assetId`/`alt`, and the public page has no executable nodes. Renderer tests reject off-site, protocol-relative, `javascript:`, traversal and non-slug page paths. |

Targeted runs during development (shared-lock runner):

- Unit: 19 slug tests, 2 planner tests, 6 renderer tests added; all package unit tests passed.
- `pnpm verify --profile=persistence` passed 88 checks (85 existing + 3 new): `.wrangler/verification/2026-11-06T05-56-07.376Z-0rBBrd/summary.json`.
- Case-study API group and browser journey passed: `.wrangler/verification/2026-11-06T06-12-32.987Z-mxKfyy/summary.json`.

Full gate, run with `pnpm verify` on base `8939bbc` plus these uncommitted changes:

- First full run `.wrangler/verification/2026-11-06T06-14-17.418Z-4P8hOw` stopped in `test:renderer`. That suite asserted that every preview link is external, and the case-study card link is the new same-site exception. The assertion now accepts only exact `/projects/{slug}` paths and keeps the external `noopener` rule for all other links.
- Second full run `.wrangler/verification/2026-11-06T06-16-06.321Z-BDn9mW` passed `pnpm check` (lint, 12 type checks, 499 unit tests across 45 files; the seven existing CSS specificity warnings remain), all builds, 27 renderer groups, auth with browser journeys, 88 persistence checks, 11 upload groups, 43 publication-dispatch groups, 4 commit/serving groups, 19 draft-API groups and autosave. In `test:editor`, 45 groups passed, then the existing Phase 26 journey timed out waiting for `Retry Publish` after a reload. The queued withdrawal retry had already completed after the test removed its injected failure, so the page showed `Publication complete`. This change does not touch that step or withdrawal.
- Resumed through the same shared-lock runner, with no assertion changes: `pnpm verify --profile=editor` passed check, web/jobs builds and all 46 editor browser groups (45 existing + the case-study journey), including the full Phase 26 journey: `.wrangler/verification/2026-11-06T06-32-23.161Z-HbmoNl/summary.json`. The remaining full-gate suites `test:runtime`, `test:runtime:smoke` and `spike:routing` (31 boundaries) passed: `.wrangler/verification/2026-11-06T06-36-27.568Z-CZ7zEQ/summary.json`.

Every full-gate suite has passed on this source. They passed across one full run and filtered resumptions, not a single uninterrupted run. The Phase 26 step's wait races the queued cleanup retry and may need its own stabilization.

Not verified: deployed CPU, paid-provider capacity, deployed CDN/browser withdrawal (S-9), production routing, and the activated signup journey. Browser proof is Chromium in the authenticated handoff fixture with real local Workers/D1/R2/Queue. The private live preview renders card links, but clicking one navigates the preview iframe to an app route, the same as existing external links. Saved-draft page navigation is Phase 39. All pages keep the title `Portfolio` until Phase 34 adds page-specific metadata.

Normal diff review covered the slug rule, check SQL, owner/session scoping of the new read, frame path validation, preparation/React parity, the site fallback scope and editor input handling. The publication/withdrawal boundary changed, so a separate boundary review is recommended before completion; it has not been run. No commit, push or owner approval is recorded.

## Documentation impact

Changed assumptions: case-study slugs are generated by the editor and frozen by the live manifest index, enforced through a new publication issue; missing pages of published portfolios serve a page-unavailable 404 with a route home; case-study images are uncropped uploads; the card placeholder is now a link; the renderer version is `publication-v2`. Updated [architecture](../../docs/architecture.md) (8.3.1 implementation note with the owner decision, 8.4 serving, image-cropping row), the [implementation baseline](../../docs/implementation-status.md), the [roadmap record link](../../docs/roadmap.md#phase-30-add-project-case-studies), the [schema](../../packages/schema/README.md), [components](../../packages/components/README.md), [render](../../packages/render/README.md), [editor controller](../../apps/web/lib/draft/README.md) and [upload](../../apps/web/lib/assets/README.md) guides, and the [editor verification recipe](../../.agents/skills/verify-hasaweb/features/editor-preview.md). Product and acceptance requirements are unchanged. Historical specs are untouched. Unresolved: page-specific titles (34), full-page draft navigation (39) and production activation (42E).
