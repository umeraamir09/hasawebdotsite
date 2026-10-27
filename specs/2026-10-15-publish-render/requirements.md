# Requirements and context

October 27, 2026 supersession: the owner approved [Workers Paid at launch and local development now](../../docs/deployment-policy.md). Free-only CPU/quota fit and prohibitions on planning a paid launch no longer block local implementation. Preserve original measurements, phase approvals, renderer/security/content contracts and S-9 withdrawal requirements. Use the integrated S-8 local milestone; final native paid verification is a release gate. No subscription change occurs during local development.

Phase 02 runs architecture spike S-1. The target is 10 ms CPU per free-plan invocation. Architecture sections 8 and 9 propose one React server render per page; the stored draft ceiling is 1 MiB. Phase 16 owns the actual shared renderer and its visual implementation. This spike uses synthetic markup and does not implement UI, publication, or modify Figma.

Use the installed React 19.3.0 and production `react-dom/server` in workerd with the jobs Worker's compatibility date and node compatibility flag. Fixtures must be deterministic and bounded by bytes and node counts. A large portfolio includes every MVP component shape and repeated text sections. A case study exercises many small rich-text nodes and image references near the byte ceiling. A resume includes shared profile chrome and a PDF embed/download fallback. Binary uploads are references, never inlined.

Local synchronous elapsed time is a conservative CPU proxy, not Cloudflare billed CPU. Also retain sampled V8 CPU profiles from workerd, excluding idle samples when estimating active CPU. Sampling is approximate and profile instrumentation affects timing. No claim about production CPU, Workflow persistence, R2 costs, or final renderer performance follows from these measurements. S-8 separately verifies Workflow boundaries.

Follow AGENTS.md branch conventions over the older branch example in the roadmap. Do not add owner-facing content limits without approval. If whole-page rendering is unsafe, record a compatible chunking approach rather than silently reducing product scope or requiring a paid plan.
