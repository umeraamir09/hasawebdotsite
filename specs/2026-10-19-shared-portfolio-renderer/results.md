# Phase 16 results

October 27, 2026 supersession: the owner approved [Workers Paid at launch and local development now](../../docs/deployment-policy.md). Free-only CPU/quota fit and prohibitions on planning a paid launch no longer block local implementation. Preserve original measurements, phase approvals, renderer/security/content contracts and S-9 withdrawal requirements. Use the integrated S-8 local milestone; final native paid verification is a release gate. No subscription change occurs during local development.

## Owner-approved completion, October 19, 2026

The owner authorized Phase 16 checkoff and a pull request if a final light review found no blocker. The lead reviewed the acceptance criteria, current rendering/preview/control boundaries, repaired avatar CSS, safety policies and completed evidence without subagents. No remaining Phase 16 blocker was found. All 14 renderer tests passed again. The existing 27 passing browser groups, 33 repaired regression cases, six direct source comparisons, 340 workspace tests and twelve successful builds remain the verification basis. This was a light review, not another full browser/build run.

Phase 16 is checked in the roadmap. The implementation-status baseline records owner approval. The [completion review](evidence/completion-review.json) and [documentation check](evidence/completion-documentation-check.json) record this final pass. Earlier approval-pending and failed-audit statements below describe their historical checkpoints. Later product integration, publication feasibility and release-browser requirements remain unchanged. No Figma changes or deployment occurred.

### Completion documentation impact

The owner approval changes phase status only. Current roadmap and baseline guidance now agree that Phase 16 is complete. The earlier audit, repair receipts and pending-approval records are preserved. No implementation, schema, architecture, package contract or dependent phase prerequisite changed during this review. The committed source and guidance pass the whitespace check. The original copied OFL license and raw historical test logs retain their original whitespace.

## Acceptance repairs and verification, October 19, 2026

Both P2 audit defects are repaired. The implementation passes acceptance checks 1 through 8 within the documented isolated Chromium fixture scope. Check 9 was satisfied by retaining the unchecked phase until the owner approval recorded above. Independent repair review found no remaining Phase 16 blocker.

The avatar generator now removes the generic image slot's border and radius inside the source portrait wrapper. The source wrapper owns its border and clipping. Actual cat images measure 104px at 360px and 124px at 768/1280px, with no inset. Hands and undecorated images measure 92px and 112px, with a 6px inset. Loading, ready and failed images retain those bounds. A separate Chromium comparison renders the unchanged imported React source alongside the repaired shared specimens. All six source/shared cat/hands size and offset comparisons pass. See [direct source comparison](evidence/acceptance-fixes/source-geometry.json).

The theme button retains its next-action names, `Dark mode` and `Light mode`. Initial markup and shared behavior now omit `aria-pressed`. Both the client preview and static snapshot expose the correct action name without a pressed state before interaction and after Enter and Space. No display-model, schema, source-reference or Figma change was required.

### Repair evidence

The new browser assertions ran before either product fix. All 27 actual-image cases and all six theme cases failed independently. The [before measurements](evidence/acceptance-fixes/before/acceptance-regressions.json) and [failing run](evidence/acceptance-fixes/before.log) retain those failures. The same 33 cases pass after the fixes with an empty failure list. See [after measurements](evidence/acceptance-fixes/after/acceptance-regressions.json).

- `pnpm test:renderer` passes all 27 browser groups in Chromium 154.0.8037.57. The [completed browser report](evidence/acceptance-fixes/after/browser-results.json) and [runner receipt](evidence/acceptance-fixes/after.log) include the five added geometry/control groups and the original parity, safety, incomplete-state, responsive, keyboard, bridge, access/header, reduced-motion and axe checks.
- `pnpm check` passes lint, all twelve typecheck tasks and 340 tests across 28 files. See [check evidence](evidence/acceptance-fixes/check.log).
- `pnpm build` passes all twelve build tasks without cache hits. See [build evidence](evidence/acceptance-fixes/build.log).
- The generator rerun leaves all nine inspected generated/static files byte-identical. See [hash comparison](evidence/acceptance-fixes/generated-files.json). Imported source components, styles, assets and generators remain unchanged.
- The lead inspected the fresh [desktop preview](evidence/acceptance-fixes/after/complete-1280-preview.png), [mobile snapshot](evidence/acceptance-fixes/after/complete-360-snapshot.png), [incomplete preview](evidence/acceptance-fixes/after/incomplete-360-preview.png) and [decoration specimens](evidence/acceptance-fixes/after/decorations-360.png).

The regression-test setup initially mishandled a held image request, then navigated before its released image settled. The [instrumentation logs](evidence/acceptance-fixes/harness-routing-attempt/run.log) and [timeout log](evidence/acceptance-fixes/harness-routing-attempt/loading-timeout.log) remain separate from the product reproductions. The test now releases and settles each image before navigation. Failed attempts remain retained; only the completed passing run is counted.

The fresh independent `gpt-6.1-sol` reviewer checked the repairs, source geometry, regression evidence and scoped comments/suppressions. It found no actionable issue. These repairs introduce no new comments or suppressions. Fix Root Causes led to correcting the generator and both theme attribute producers. Test Behavior, Not Implementation led to measuring real images and accessible controls. Prove It Works led to the direct source comparison and browser/static rerun.

### Documentation impact

The changed assumption is verification coverage. Outer portrait bounds and successful keyboard activation did not prove actual image geometry or consistent accessible semantics. The protocol now requires actual-image bounds and offsets through loading/error states and explicit theme action checks in both hosts. The component README documents ownership of avatar clipping and the theme action contract. The plan records the repair sequence. The implementation-status baseline and roadmap now describe verified repairs and pending owner approval. The initial audit below is historical evidence and is superseded by this repair verdict.

The [repeated guidance and link check](evidence/acceptance-fixes/documentation-check.json) covers current guidance, package READMEs and this spec. Architecture, product/acceptance requirements, onboarding/authentication, schema and save/recovery guidance remain accurate because no route, schema, data contract or product scope changed. Existing dependent prerequisites in Phases 17, 18, 23–25, 35–38, 39, 42E and 53 remain unchanged. Real owner-route authorization, publication preparation/partitioning/CPU/dispatch/withdrawal, later feature activation and the full release browser matrix are still unimplemented later work. There is no unresolved repair prerequisite. No deployment, publication, commit or owner checkoff occurred.

## Historical acceptance audit, October 19, 2026

The following audit describes the pre-repair state. Its findings and original receipts are preserved. The repair verdict above supersedes its completion status.

The subsequent acceptance audit found two P2 defects. Phase 16 is not complete and is not ready for owner checkoff. The earlier implementation results below retain their original observations and passing suite counts; their source-geometry and accessible-control claims are limited by these findings.

1. Actual avatar image geometry differs from the imported reference. The shared `.pf-image` adds a 1px border inside the source portrait wrapper. At 360px, source cat images measure 104px and source hands images measure 92px, while shared images measure 102px and 90px. At 768/1280px, source values are 124px and 112px, while shared values are 122px and 110px. The nested wrapper also adds its own clipping radius. This fails acceptance check 4. The existing browser test measures `.pf-avatar-portraitButton`, so it misses the actual image mismatch. Correct the avatar integration through `scripts/generate-renderer-avatar.mjs`, retain source files unchanged, and compare actual image bounds and offsets with the source at all three widths, including loading/error states. [Measured geometry](evidence/acceptance-audit/avatar-geometry.json) comes from rendering the unchanged imported React source and the actual shared fixture in Chromium, with their respective CSS.
2. The theme button exposes a contradictory accessible name and state. In light mode its accessible node is `button "Dark mode"`. After Enter switches the page to dark, the node becomes `button "Light mode" [pressed]`. This fails acceptance check 5's accessible-control requirement. Keep a stable toggle name with its pressed state, or retain the changing action label and omit `aria-pressed` from both initial markup and shared behavior. Add name/state assertions in both preview and snapshot paths. [Actual accessibility nodes](evidence/acceptance-audit/theme-toggle.json) record the reproduction. The [WAI button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) specifies these alternatives. Axe does not identify this mismatch.

The fresh `pnpm check` passes lint, all twelve typecheck tasks and 340 tests across 28 files. The fresh renderer browser suite passes 22 groups. These passes do not override the two direct browser reproductions. See [check evidence](evidence/acceptance-audit/check.log) and [browser evidence](evidence/acceptance-audit/browser-results.json). The fresh build passes all twelve tasks, with eleven cache hits; see [build evidence](evidence/acceptance-audit/build.log). The first attempt lacked a final runner receipt and was not counted; its [inconclusive log](evidence/acceptance-audit/build-inconclusive.log) is retained.

Acceptance checks 1, 2, 3, 6 and 7 pass for the recorded Phase 16 fixture scope. Check 4 fails actual image geometry, and check 5 fails theme name/state consistency. Check 8's automated verification passes, but completion review remains blocked by those defects. Check 9 passes because the roadmap remains unchecked. The independent read-only `gpt-6.1-sol` review reached the same verdict and found no additional Phase 16 blocker or unsafe suppression. Its complete review supersedes the earlier partial-review limitation.

Actual owner preview/upload routing, large-message transport integration, production preparation/partitioning/CPU/dispatch/withdrawal, saved appearance/Face Reveal/playback, later graph/contact/additional-page services and the full release browser matrix retain their documented later-phase scope. They are not new Phase 16 blockers. No product source, imported reference, Figma file, owner approval record or roadmap checkbox changed in this audit.

### Audit documentation impact

The earlier geometry and control assertions were too broad because the existing tests inspect outer portrait bounds and activation/contrast, not actual portrait image bounds or accessible name/state agreement. Current implementation-status and the Phase 16 roadmap note now identify the two open defects. Earlier evidence remains intact; new audit evidence is stored separately. Product, acceptance, protocol and dependent phase requirements remain unchanged because the required behavior has not changed. Both defects must be fixed and verified before owner completion approval is requested again.

---


Implemented October 19, 2026 on `feat/shared-portfolio-renderer`. Owner completion approval is pending. Phase 16 remains unchecked. No Figma writes, deployment, public publication, signup activation or editor-route replacement occurred.

## Delivered behavior

The fixed profile and every current optional component render through shared markup-only React. The display-only projection retains saved order and stable component IDs while excluding private recipient configuration, activity consent, raw asset IDs, disabled second photos, setup/address/recovery data and untouched samples. Safe links and allowlisted rich text render owner strings literally. A display-only text normalization makes CRLF/CR, NUL and unpaired-surrogate rendering consistent without changing saved data. Missing profile fields and unavailable assets/services remain honest. Optional project images and links remain absent when omitted.

Both hosts share the approved Leaf tokens, original DM Sans font and vanilla theme/image behavior. Native theme controls support Enter/Space, visible focus, stored choice and system changes. The client iframe bridge validates source, exact origin, channel, increasing revision, strict display schemas and asset origins. Document policies supply noindex/private/no-store for preview and restrictive CSP/security headers for snapshots. Public unavailable output contains no owner data.

Reusable owner-data avatar markup preserves original cat bytes and hands SVG/CSS, source geometry, source-specific radii and reduced motion. The imported React source remains unchanged. The palette wrapper now maps source avatar variables to renderer tokens correctly in dark mode. Saved decoration selection, Face Reveal and independent playback remain later phases.

The production fragment entry enforces input/accounting/output guards and returns `needs_partitioning` for oversized work without partial HTML. The separate offline helper generates complete local snapshot fixtures. It is not a production whole-document render API. See the [protocol](protocol.md), [component contract](../../packages/components/README.md) and [renderer contract](../../packages/render/README.md).

## Verification

- `pnpm check` passes workspace lint, all twelve typecheck tasks and 340 tests across 28 files. The new renderer suite contains 14 behavior tests. See [check evidence](evidence/check.log).
- `pnpm build` passes all twelve production build tasks, including the Next.js/OpenNext bundle and Worker dry runs. See [build evidence](evidence/build.log).
- `pnpm test:renderer` passes 22 Chromium browser groups. [Machine-readable checks](evidence/browser-results.json) record Chromium 154.0.8037.57 and each assertion group. The script is also wired into CI.
- The browser compares the same complete, incomplete, empty and long Unicode fixture in a client-mounted private iframe and static snapshot at 360, 768 and 1280 pixels. It checks text, component IDs/order, safe links, image descriptions/sizes, section geometry, colors, font family and horizontal overflow. The 390-pixel iframe updates through the validated bridge.
- Checks also cover signed-out/other-owner fixture denial, private field omission, invalid bridge source/channel/revision/schema/origin, valid replacement, native keyboard theme controls in both hosts, visible focus, skip-link focus, stored/system modes, delayed portrait geometry, image failure, CSP rejection of injected inline scripts and axe WCAG AA on the complete static fixture.
- The explicit cat/hands specimens verify 124/104-pixel portrait sizes, 24/20-pixel cat radii, 30/26-pixel hands radii, complete envelopes, exact hashed art/font bytes, active hand animation families, the cleaned cat loop/still selection, changing reduced motion and correct dark avatar backgrounds. This does not claim the later playback/reveal controls are implemented.
- The [generator rerun](evidence/generated-files.json) is deterministic. The original imported avatar files remain unchanged. No source-cat regeneration or new compositor timing benchmark was performed.

Representative evidence includes [desktop preview](evidence/complete-1280-preview.png), [desktop snapshot](evidence/complete-1280-snapshot.png), [mobile preview](evidence/complete-360-preview.png), [mobile snapshot](evidence/complete-360-snapshot.png), [incomplete preview](evidence/incomplete-360-preview.png), [incomplete snapshot](evidence/incomplete-360-snapshot.png) and [decoration specimens](evidence/decorations-360.png). The [snapshot HTML](evidence/complete-snapshot.html) records serialized output and refers to the ephemeral local fixture asset host. It is not a portable published site. The [read-only Figma reference](evidence/figma-authentication.png) records the inspected direction.

## Corrections and evidence limits

The first workspace check found formatting and a redundant word in a fixture image description. These were corrected and the snapshot regenerated. The expanded browser run initially failed because its locator matched both hands. The [partial run](evidence/partial-1792415214133.json) retains that failure. The test now explicitly checks the first hand's reduced-motion style and all active animation families. The passing final run supersedes it.

A later Windows line-ending fixture exposed a real parity defect. The React client retained CRLF while HTML parsing normalized it to LF. The [failing comparison](evidence/line-ending-failure.json) is retained. Display normalization now runs at projection, bridge parsing and the bounded fragment boundary. A regression test checks that source draft values remain unchanged, and the final browser fixture includes CRLF, NUL and an unpaired surrogate.

Initial preview screenshots clipped content below the fixture iframe viewport even though DOM/geometry assertions passed. The capture now expands the iframe before taking full-document screenshots. The corrected preview and snapshot images were visually inspected. Independent review also reproduced a light source-avatar surface under dark renderer tokens; the wrapper mapping was fixed and the final browser run asserts the dark background.

The private session gates belong to the isolated fixture. They do not establish actual Better Auth preview/upload route integration. No real owner draft endpoint was exposed. Browser coverage here is Chromium only; the confirmed full browser matrix remains Phase 53. Axe exercised the complete default static fixture, not all eventual palettes, forms or interactive features.

The 2 MiB browser message envelope is not an owner content limit. Resolved URLs can expand a valid draft beyond it. Phase 17 must add bounded chunking/cancellation before supporting that case and report rejected updates honestly. Phase 24 still needs revision-bound resumable preparation, Unicode-safe splitting, wrapper-preserving assembly and real CPU/dispatcher/quota measurements. The fragment guards do not prove Free publication feasibility. Real asset transfer, retained platform delivery, serving and S-9 cache withdrawal remain their existing prerequisites.

All assigned design/review agents used the owner's configured `gpt-6.1-sol` model. The independent code reviewer confirmed the dark-token issue but reached an account usage limit before producing a final report. The lead completed the diff, suppression and browser review. This is not a cross-family review claim. Three redundant own-code comments were removed; source-derived comments and narrowly named generator/decorative-SVG suppressions remain because they describe intentional source/template behavior. No source reference comments were changed.

## Design and throughput

Two separate design sketches preceded implementation. The independent judge selected shared React markup over a custom event language. The lead adopted the display-only projection and removed speculative marker/continuation machinery from this increment. [The selected design](design.md) records the scoring and rejected scope.

Model the Domain led to the typed display projection and exhaustive schema-keyed adapters. Build the Lever led to the repeatable browser harness and deterministic source generator. Prove It Works led to actual browser/static comparisons and visual inspection. Separate Before Serializing Shared State led to independent sketch files and one owner for the coupled implementation. The lead owned fixture verification and documentation. Runtime checks were serialized after browser work so unrelated suites did not compete for CPU.

## Documentation impact

The prior current guidance described empty production render packages and a future shared renderer. It also described a future inline theme bootstrap. PublicContent still contains recipient configuration, so the renderer requires a narrower display projection. Current code uses shared default markup, an external vanilla script and explicit trusted platform origins. The browser/static text comparison also required a display-only normalization rule; this changes no stored schema or accepted owner content. No schema migration or product-scope change was required.

Updated current guidance includes the root README, implementation-status baseline, architecture rendering/security/decision sections, onboarding prerequisite table, appearance catalog, avatar import guide and the schema usage guide and both new package READMEs. The roadmap links this evidence and leaves approval unchecked. The historical S-1 result now has a dated note linking to this implementation while retaining every original measurement and rejected assumption. Both alternative design files are explicitly superseded by the selected design.

Updated dependent scopes include Phase 17 owner-authorized display transport and message expansion, Phase 24 real renderer preparation/partitioning/measurement/retention, Phase 25 thin response/asset policy adoption, Phase 35 saved appearance and first-paint checks, Phase 36 generated tokens under CSP, Phase 37 saved decoration activation and Phase 42E authorized Review integration. Existing graph/contact/additional-page phases still own their unavailable adapters. No later capability is marked implemented by a fallback or renderer fixture.

The [final impact search and link check](evidence/documentation-check.json) covers AGENTS.md, README.md, docs, specs and package READMEs for the old empty-renderer claims, direct transport assumptions, inline bootstrap, source labels/assets, fragment limits and later phase references. Product and acceptance requirements remain accurate and unchanged. Authentication guidance and the shared save/recovery contracts remain accurate because no product route, auth flow, schema, save protocol or Worker handler changed. Figma remains read-only. The remaining prerequisites are listed above and in the updated dependent phases.
