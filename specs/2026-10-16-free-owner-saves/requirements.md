# Requirements

The owner explicitly requested implementation and testing of the Free-tier save approach, with changes reversible through Git. This authorizes the proposed optimization, bounded-update/staging follow-up and isolated Cloudflare measurement. It does not approve a phase completion checkbox or a paid plan.

The owner explicitly approved URL/email limits on October 16, 2026: at most 2,048 UTF-8 bytes per URL and 254 UTF-8 bytes per email address. Apply these shared rules consistently and test both boundaries. Preserve free-text support and the 1 MiB draft ceiling. This is the only approved field-limit exception to unchanged schema acceptance below.

Preserve the existing 1,048,576-byte draft contract, all MVP component types and large individual fields, schema safety/uniqueness/sample-marker rules, private progress, atomic revision-aware saving and active session/deletion checks. Keep the three-Worker topology and existing shared Better Auth rules. Configuration may be cached; request identities may not.

Keep permanent onboarding-contract changes in Phase 11B and product provisioning/save UI in their roadmap phases. This increment must leave reusable, tested save machinery and an isolated fixture integration, with a documented handoff to the permanent portfolio/progress repository. Existing data and production routes must remain intact. Measurements must distinguish provider CPU from elapsed time and test every supported bounded operation, including final commit. Code that still exceeds the target must not be presented as Free-tier compatible.
