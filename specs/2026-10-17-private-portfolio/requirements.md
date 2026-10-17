# Phase 12 requirements

Started October 17, 2026. Sources are roadmap Phase 12, product section 2, acceptance section 2 and ON-03/ON-14/ON-17, the agreed onboarding specification, and the approved Phase 11E catalog.

- Each authenticated account can provision exactly one private portfolio. Initialization is idempotent under repeated requests, concurrent tabs and lost responses.
- Use the single `portfolio-v1` template. It is the application's fixed template, not an owner-selectable draft field or a new template picker.
- Read starting appearance from the approved catalog: Leaf, DM Sans, system mode. No decoration and Face Reveal off.
- Start with empty name/bio, no images, links, optional components, SEO overrides, samples or requested address. Provider name/email/photo remain account identity and require later deliberate review/acceptance, cropping and private upload where applicable.
- Use the canonical portfolio row and existing private Address progress, revision zero and unset first-editor milestone. Do not claim a subdomain, publish, upload, import provider media or create connected-service records.
- Existing content, appearance, revision, private progress, milestones, publication state and legacy validation markers survive initialization byte-for-byte. Provisioning must not parse a potentially large or legacy existing draft.
- Authorization comes from Better Auth and persisted session/deletion checks. No request parameter or body field chooses an owner or portfolio. Preserve exact-origin, JSON, no-store and noindex rules.
- The current account shell triggers an explicit initialization POST. Read-only session lookups remain read-only. Setup routing, draft read/save APIs, provider import controls and mandatory guide activation remain later phases.
- No visual layout or styling changes are planned, so this phase does not implement a Figma screen or modify the read-only reference.
