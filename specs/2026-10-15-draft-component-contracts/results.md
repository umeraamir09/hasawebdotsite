# Phase 09 results

Implemented October 15, 2026 on `feat/draft-component-contracts`. The owner approved completion on October 15, 2026, and Phase 09 is checked off in the roadmap.

## Delivered contracts

`@hasaweb/schema` now exports the strict version 1 draft schema, TypeScript types, a fixed profile definition and the canonical optional-component registry. It covers projects and case studies, skills/categories, work experience, multiple text sections, GitHub activity, contact forms, shared social links and resume PDFs. Each optional definition has an independent version, schema, fresh defaults/sample, picker requirements, instance limit and migration map. The component union is generated from the registry. The fixed profile migrates with the envelope.

The schema stores stable sample markers, social placement booleans, explicit avatar acceptance, retained Face Reveal images, appearance/catalog references and SEO overrides. Asset traversal returns IDs, purposes and field paths for every private image/PDF reference. It deliberately includes retained disabled photos and untouched samples; publication must select public content first and independently validate ownership, readiness and asset kind.

Rich text permits paragraphs, headings, nested lists and safe links. Only case studies permit uploaded image blocks. Strict attributes reject executable or unapproved structures and external image URLs. Literal markup remains plain text for the future escaping renderer. JSON validation rejects values that would be lost during serialization, prototype keys, cycles and excessive depth, and enforces the architecture's exact 1 MiB UTF-8 limit.

The migration runner upgrades the envelope sequentially, then each component, then validates the complete document. Version 1 has no real historical migrations. Fixture-only contracts demonstrate multiple component steps, a combined envelope/component upgrade and a component upgrade with an unchanged envelope. Tests also cover gaps, future versions, malformed output, wrong version increments, thrown callbacks and mutation attempts. The original document is preserved on success and failure.

## Evidence

| Check | Result |
| --- | --- |
| `pnpm exec vitest run packages/schema` | 123 passing contract checks in three files |
| `pnpm check` | Biome passes; all 11 workspace typechecks pass; all 139 tests in ten files pass |
| `pnpm build` | All 11 workspace builds pass, including OpenNext and the site/jobs Worker dry runs |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Passes with the updated lockfile, using already installed native dependencies |
| `git diff --check` | Passes |

`draft.test.ts` covers complete/unfinished round trips, all definitions, singleton rejection, multiple text instances, duplicate IDs/slugs, category references, dates and paths, unknown properties, sample edits/reordering, asset traversal, explicit avatar acceptance, UTF-8 boundaries, prototype properties, deep/cyclic input and non-JSON values. `rich-text.test.ts` covers allowed structures, unsafe protocols, email-header injection, malformed lists, scripts/HTML/CSS/embeds/marks/attributes and case-study-only images. `migrations.test.ts` covers successful upgrades, content/order preservation, repeated reads and failure recovery.

The first full check overlapped with the full build and one existing S-1 render test exceeded Vitest's five-second timeout. After the build finished, `pnpm check` passed with all 139 tests and the original timeout. No existing render test was changed. The default Windows pnpm shim and the Corepack bootstrap script cannot be spawned correctly by Turborepo in this WSL session. Reproduction uses `PATH=/home/umer/.local/share/pnpm/bin:$PATH` with pinned pnpm 12.11.2. The full build also used `NEXT_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false`.

## Boundaries for later phases

The [contract reference](../../packages/schema/README.md) documents exact fields and APIs. The canonical data registry is in `schema` and re-exported by `components`, avoiding a React or package-cycle dependency in browser/Worker validation. Architecture sections 7.3 and 9.1 reflect this placement.

Incomplete content can be saved. Publication completeness, sample omission, provider/grant state, recipient verification, authoritative upload checks, catalog membership and subdomain rules remain in their planned phases. No persistence, editor, renderer, production deployment or Figma change is part of this work. The visual catalog remains undecided. These tests prove contract behavior, not public rendering or production request CPU feasibility.
