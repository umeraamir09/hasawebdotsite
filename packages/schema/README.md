# Draft and component contracts

`@hasaweb/schema` owns version 2 of the private draft JSON, the data-only component registry and the migration runners. It uses Zod and Web Platform APIs, with no React, Node, database or provider dependency. `@hasaweb/components` re-exports the registry so future editor and renderer adapters share these definitions without a package dependency cycle.

```ts
import { createComponent, createEmptyDraft, draftSchema, readDraft } from "@hasaweb/schema";

// Obtain themeId/fontId from the approved @hasaweb/theme catalog.
const draft = createEmptyDraft({ themeId, fontId, colorMode: "system" });
draft.components.push(createComponent("text", "about-me"));
const validated = draftSchema.parse(draft);
const restored = readDraft(JSON.parse(JSON.stringify(validated)));
```

Both APIs return validated copies. `draftSchema.safeParse` returns Zod issues with field paths. `readDraft` also runs registered migrations and can throw `MigrationError` with a scope, version and cause. It does not save anything. The repository will persist migrated documents on the next successful save.

## Private setup contracts

Version 2 adds optional `requestedSubdomain`, a non-reserving candidate with the existing 3–30 lowercase ASCII letter/digit/hyphen format. Missing candidates remain absent. Format validation does not check availability or reserve a name. The database's unique `portfolio.subdomain` and permanent claims remain separate.

`setupProgressSchema` is a separate private version 1 navigation contract with a `step` of address, profile, links, skills, projects, github or review. Its initial value is Address. Progress proves no required completion and accepts no milestone flag or duplicated answers. `firstEditorEnteredAt` belongs to private persistence, outside the draft.

`toPublicContent` returns only schema version, profile, links, components, appearance and SEO. It excludes the candidate and sample metadata. Publication must first omit untouched samples and validate readiness; this projection alone is not a publish-ready snapshot. Never serialize a complete portfolio row as public data.

## Document and component rules

The fixed `profile` contains name, bio, optional location, optional avatar/banner references, a decoration catalog ID and Face Reveal settings. Avatar acceptance is an explicit boolean. `faceReveal.image` remains in the private draft when `enabled` is false. Images refer to an opaque `assetId` and optional `alt`; crops are represented by the uploaded cropped asset. No storage URL or upload body is stored here.

`links` is the single ordered list of social/contact entries. Each has an ID, label, kind, value, `showInProfile` and `showInSocialComponent`. Email values are plain addresses. Other values are HTTP(S) URLs. The social-links component has no duplicate entry collection. Its order follows `links`.

URLs are limited to 2,048 UTF-8 bytes and email addresses to 254 UTF-8 bytes, explicitly approved October 16, 2026. These rules also apply to rich-text destinations and component URLs. Existing longer values must be corrected explicitly, never silently truncated. Free text and the complete draft retain the 1 MiB ceiling. [The bounded-save protocol](../../specs/2026-10-16-free-owner-saves/protocol.md) explains how server validation preserves large text without loading a complete document in one Worker request.

`components` is the ordered list below the fixed profile. IDs remain stable across reordering. The registry generates the discriminated union used by the draft validator.

| Type | Data | Instances |
| --- | --- | --- |
| `projects` | Ordered entries with title, summary, technologies, contribution, optional image/code/demo and case study | One |
| `skills` | Ordered categories and entries, with optional category references | One |
| `work-experience` | Ordered roles, organizations, month dates, current-role flag, description and optional organization URL | One |
| `text` | Title and rich-text body | Multiple |
| `github` | Username and explicit private-activity preference | One |
| `contact` | Optional reference to a private recipient record | One |
| `social-links` | Empty data, using the shared links collection | One |
| `resume` | Optional PDF asset reference | One |

Project case studies store an at-most-80-character lowercase ASCII slug and rich-text body. Duplicate slugs fail. Slug generation and freezing at first publication belong to the case-study/publication phases. Skill category references must resolve. Entry IDs are unique within each collection. Work dates use `YYYY-MM`, permit unfinished dates and reject an end date before the start date.

`appearance` stores opaque theme/font IDs, an optional single `#RRGGBB` seed and `light`, `dark` or `system` initial mode. Decoration IDs are also opaque. The [catalog was approved in Phase 11E](../../docs/appearance-catalog.md) and Phase 12 uses its defaults. Structural parsing remains catalog-independent for compatibility; publication membership checks belong to Phase 23. `seo` stores optional title, description and `ogImage.assetId` overrides.

## Samples and incomplete drafts

`samples` contains only `true` values under `profile.name`, `profile.bio`, `profile.avatar`, `profile.banner` or `components.<stable-id>`. Unknown/stale targets fail. A component marker covers its entire optional sample. Use `markSample`, `clearSample`, `profileSampleKey`, `componentSampleKey` and `isUntouchedSample`. These helpers return copies. Editing any part of an optional sample must clear its component marker; removal must clear it too. This makes later publication checks apply the normal component requirements after the first edit.

Draft validation permits empty text, empty link values, missing uploads and unfinished component setup, including enabled Face Reveal without its second image. Structural and safety checks still apply. Publication must separately check required owner content, sample replacement/omission, avatar acceptance, ready assets of the right kind owned by this portfolio, provider grants/fetch state, recipient verification, catalog membership and subdomain claims. Provider credentials, fetched graphs and recipient email addresses live outside the draft. A recipient ID or `includePrivate` flag proves no authorization.

`collectDraftAssetReferences` returns every private draft asset with its purpose and exact field path. It includes untouched samples and retained disabled Face Reveal images. Publication must first select included content and exclude disabled Face Reveal images before collecting its own public assets. This function cannot be used directly as a public manifest.

## Rich-text allowlist

The stored JSON follows Tiptap node names with an explicit subset. The future editor must configure its extensions to emit this subset.

- `doc` contains paragraph, heading, bullet-list or ordered-list blocks.
- Paragraphs and headings contain text nodes with at most one link mark. Headings use levels 2 through 6, reserving level 1 for page identity.
- Lists contain list items starting with a paragraph, followed by paragraphs or nested lists. Ordered lists may store a positive starting number.
- Link marks contain only `attrs.href`. Allowed destinations are absolute HTTP(S) URLs or a simple `mailto:` address. Credentials, control characters, backslashes, relative links and mail headers are rejected.
- Only case-study documents can contain block images, and image attributes contain only an asset ID and optional description.

Unapproved nodes, marks, attributes, HTML/CSS structures, scripts, embeds and remote image URLs fail. Markup inside a plain text string remains literal text and is preserved. The later renderer must escape text and serialize these nodes itself, never interpret owner strings as HTML. Links' `rel` and other presentation attributes belong to that serializer.

Draft JSON is limited to 1,048,576 UTF-8 bytes and 64 nesting levels. The nesting bound protects recursive validation. Cycles, prototype keys, accessors, hidden/symbol properties, sparse/extended arrays and non-JSON values fail before recursive parsing.

## Migrations

Each optional definition has an independent `version`, current schema and migration map. Key `n` defines an `inputSchema` and synchronous `migrate` callback for `n` to `n + 1`. The envelope has its own version and map. Use strict source schemas for historical shapes. Preserve owner fields and stable IDs deliberately; never replace content with defaults during a migration.

`createDraftReader` first migrates the envelope one version at a time, then migrates each component, then validates the complete current document. Envelope callbacks must increment `schemaVersion` exactly once. Component versions are advanced by the runner. All callbacks receive cloned data. Missing steps, future versions, invalid source/intermediate/final values, unsafe output and thrown errors stop the read without modifying the caller or stored content. Migration functions must remain pure, with no external writes.

Version 1 is the first production contract. Its envelope migration changes only schemaVersion to 2, preserving all content, stable IDs and sample markers without increasing a maximum-size document. Component versions remain unchanged. Unknown v1 root fields and invalid final relationships fail. Reads upgrade in memory; validated bounded saves upgrade the stored envelope on the next successful save. Tests exercise multi-step component migrations, combined envelope/component upgrades, unchanged-envelope upgrades, repeated reads and injected failures using fixture-only contracts.

## Production API validation boundary

The full reader/serializer examples above are browser/offline helpers, not a Free hot-API recipe. Phase 13 streams consistent validated reads from D1, projecting the known version 1 envelope upgrade without whole-document Worker parsing. Unvalidated supported content uses bounded staged validation; unsupported content remains available through owner recovery. Schema version alone does not prove the current validation generation. Future schema/refinement changes must update the incremental validator, generation policy and equivalence fixtures together. See the [production protocol](../../specs/2026-10-17-revision-aware-drafts/protocol.md).

## Browser save integration

The [Phase 14 client](../../apps/web/lib/draft/README.md) uses the shared action/path/value schemas and limits. `SaveErrorCode` includes `owner_changed` for the expected-owner HTTP precondition. Future schema changes must update the bounded server validator, browser skeleton/diff planner and equivalence/production API fixtures together. No schema version or validation generation changes in Phase 14.
