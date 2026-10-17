# Phase 12 implementation plan

1. Add owner-scoped, insert-only provisioning using the approved appearance catalog and existing private setup defaults. Return a small identifier without parsing or replacing an existing draft.
2. Expose authenticated `POST /api/owner/portfolio` through the existing jobs service binding. Accept only an empty JSON object and reject caller identity, content, template and progress overrides.
3. Initialize from the authenticated account shell, retaining existing session-expiry and retry behavior. Keep setup routing and the first editor handoff in their planned phases.
4. Verify new, repeated and concurrent provisioning, interrupted-response recovery, provider separation, existing/legacy draft preservation, owner isolation and revoked/deleting-session behavior. Run workspace checks and record evidence.
5. Ask the owner whether to check off Phase 12 after implementation. Leave the roadmap checkbox pending until explicit completion approval.
