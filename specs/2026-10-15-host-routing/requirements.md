# Requirements and context

S-3 requires an active Cloudflare full zone, proxied wildcard DNS, exact apex/www web routing, a wildcard site route and a more-specific no-Worker assets route connected to the public R2 bucket. Universal SSL must cover the apex and first-level portfolio hosts. Reserved names cannot reach owner portfolios; example is an internal published-site exception. Reject nested, malformed, foreign and deceptive suffix hosts.

S-4 requires deployed before/after Worker analytics for repeated app loads and immutable static requests. Local dispatch, documentation and response headers alone cannot prove quota accounting. Include missing static paths and Worker-first behavior in the accounting report. S-10 requires a current Registrar availability search at purchase time. RDAP absence and DNS NXDOMAIN are not purchase availability guarantees.

The owner authorizes local implementation, tests and commits. Domain purchase, charges and production routing changes require explicit approval of a concrete proposal. No secrets in source or evidence. Do not provision billable resources. Phase 03's pending deployed CPU remains a dependency; this phase's local preparation must not be mistaken for completion of S-2.

The owner confirmed the domain was already registered and approved the exact temporary routing proposal on October 15, 2026. The owner chose to configure DNS personally. Registry RDAP confirms registration through Porkbun and Cloudflare nameservers. This satisfies the external-registrar alternative in S-10 without another purchase or transfer.
