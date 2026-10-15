# Phase 09 requirements

Implement roadmap Phase 09 using product sections 2 through 15, acceptance sections 3 through 8 and 11 through 14, and architecture sections 7.3, 9.1, 10 and 13.

- Use a strict versioned Zod JSON contract in `@hasaweb/schema`. Preserve supplied content and order. Reject unknown properties, component types and versions rather than stripping data.
- A recoverable draft can have empty required text, missing uploads and unfinished optional setup. Publication completeness, upload ownership/readiness, provider authorization, recipient verification, catalog membership, and subdomain claims remain authoritative checks in their later phases.
- The profile is fixed outside the ordered optional components. Declare projects, skills, work experience, text, GitHub activity, contact form, social links and resume. Only text permits multiple instances. Social placements reference the one draft links collection.
- Store image/PDF references by opaque asset ID, with descriptions in the draft. Crop output is a new uploaded asset. Do not store upload bodies, storage keys, provider credentials, recipient addresses or fetched activity in component data.
- Store a Tiptap-compatible allowlist of paragraphs, headings, lists and links. Only case-study bodies permit uploaded images. Accept only HTTP/HTTPS web links and simple mailto email links, never arbitrary HTML/CSS, embeds or executable attributes. Plain text remains literal text for the future serializer to escape.
- Track untouched samples by stable field/component identifiers, independent of array order. Clearing a marker is an explicit edit operation. Imported avatars require a separate acceptance boolean; Face Reveal can retain a private image while disabled.
- Theme, font and decoration IDs are opaque catalog references. Do not choose or approve the deferred visual catalog. Accept only one hexadecimal custom color and the agreed initial color modes.
- Envelope and component migrations are synchronous, sequential pure functions. Reject future versions, gaps and invalid output; never mutate caller input. Version 1 is the first production contract, so no fabricated historical production migration is needed. Exercise real migration callbacks with fixtures.
- Keep data contracts and their canonical registry in `@hasaweb/schema` to avoid a dependency cycle. `@hasaweb/components` re-exports that registry for future editor/renderer adapters. UI, rendering, persistence and publication behavior remain in their scheduled phases.

No UI changes are part of this phase, so Figma inspection is unnecessary. The reference file remains read-only. Follow the repository's current branch naming rule over the older naming example in the roadmap. Request owner approval before checking the roadmap completion box.
