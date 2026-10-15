# Phase 07 requirements

Scope is architecture spike S-7, not the production contact form, recipient verification flow, or queue consumer. No product UI changes are required, so the Figma reference is not needed for this phase.

Use a single-recipient EmailProvider contract, a console development provider, and Resend REST through fetch. Keep the verified sender fixed and put the visitor address in Reply-To only. Templates must treat visitor input as text. Provider errors must not expose message bodies, addresses, verification tokens, or secrets in evidence.

Prove ten accepted contact messages per site per UTC day, ninety globally, two tests per site within those limits, and ten separate verification/notice reservations. Reserve before acceptance atomically. Retries reuse the original acceptance reservation. Independently reserve provider attempts on the actual dispatch day/month to protect the 100/day and 3,000/month caps when retries cross midnight. This extra guard can underuse capacity after errors, which is safer than exceeding provider capacity.

Live checks require an ignored .env.email-spike.local, verified sending domain with SPF/DKIM, a designated recipient, and explicit permission to send three messages. Read-only domain retrieval must precede sending. Do not exhaust the real quota. Fixtures prove quota handling. Do not equate provider acceptance with delivery.

References: docs/architecture.md sections 8.6, 13, S-7; docs/acceptance-criteria.md section 10; docs/product.md section 10. Keep the phase unchecked until owner review.
