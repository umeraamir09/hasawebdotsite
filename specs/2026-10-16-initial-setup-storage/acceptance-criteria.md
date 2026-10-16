# Acceptance criteria

- Version 1 fixtures migrate to version 2 without changing profile, links, components, appearance, SEO or sample markers, including a 1 MiB draft. Invalid/future versions and forged setup fields fail.
- Candidates obey the existing 3–30 lowercase letter/digit/hyphen format. Two owners can retain the same candidate with no claimed subdomain or claim row.
- Repeated/concurrent creation preserves exactly one portfolio and its existing content/progress/milestone.
- Content and progress save atomically under the same revision. Stale progress, content and handoff operations cannot overwrite newer state.
- Another owner, a revoked/expired session and a deleting account cannot access or mutate setup state, staging or milestone storage.
- First entry is permanent and idempotent. Ordinary save payloads cannot set it. Setup writes prepared before entry cannot commit afterward. Editor content changes cannot reset entry.
- Public-content projection contains no requested address, navigation progress or entry milestone. Account deletion cascades through setup/staging storage without reserving an unclaimed candidate.
- Relevant unit/integration tests, lint, typechecks and builds pass. Record commands, results and limitations in results.md. Leave the roadmap unchecked until explicit owner approval.
