# Proposed production routing experiment

The owner approved this temporary routing proposal on October 15, 2026 and chose to configure DNS personally. It serves only the existing OpenNext skeleton and clearly named synthetic fixtures. It does not publish an owner's draft or implement a product portfolio.

The owner confirmed ownership of hasaweb.site on October 15, 2026. No domain purchase, registration or transfer is needed. The new Free Cloudflare full zone is initially pending activation. Assigned nameservers are `rajeev.ns.cloudflare.com`, and `tina.ns.cloudflare.com`. Use the dashboard's exact values when changing registrar nameservers. Inspect existing DNS records and preserve mail verification/delivery records before changing anything.

## Exact Worker routes

| Pattern | Target | Purpose |
| --- | --- | --- |
| `hasaweb.site/*` | `hasaweb-s2-spike` with the runtime probe disabled | Actual compiled OpenNext app on the apex |
| `www.hasaweb.site/*` | `hasaweb-s3-redirect` | 308 to HTTPS apex, preserving path and query, including asset paths |
| `*.hasaweb.site/*` | `hasaweb-s3-site` | Thin host/R2 fixture boundary experiment |
| `assets.hasaweb.site/*` | No script | Negate the less-specific wildcard; R2 custom domain handles hits and misses |

Set request-limit behavior to fail closed on Worker routes. Do not add a broad `*hasaweb.site/*` pattern. Keep the two more-specific www/assets exceptions. The temporary redirect Worker avoids invoking an asset-first OpenNext Worker on www static paths, which otherwise could serve files before a redirect handler executes. For the final three-Worker architecture, a zone Redirect Rule can replace this temporary redirect Worker after equivalent deployed verification. No extra permanent product Worker is selected.

## DNS and storage

- Use a proxied apex A record with a documentation-only origin address, `192.0.2.1`, if no existing apex origin must be preserved. Add a proxied wildcard A record `*` to `192.0.2.1`. These records depend on Worker interception and fail-closed route settings; they are not real origins.
- Add or retain a proxied www CNAME to the apex. Inspect the existing record before replacement.
- Create isolated `hasaweb-s3-sites` and `hasaweb-s3-assets` R2 buckets. Keep the sites bucket private and without a custom domain. Upload only a tiny synthetic HTML fixture at `routing-probe/index.html`.
- Connect only the assets bucket to `assets.hasaweb.site` through R2's custom domain setup, in the same account/zone. Let that setup create its exact DNS record. Keep r2.dev access disabled. Upload only `routing-probe/asset.txt`, a harmless synthetic text fixture. No drafts, tokens or user images enter this bucket.
- Wait for the full zone, R2 custom domain and Universal SSL to be active. Check apex, www, assets and routingprobe certificate SANs and trusted TLS without disabling verification. A nested name is outside free Universal SSL coverage and must never route to an owner API.

## Verification and rollback

The site entry serves the synthetic published object only on `routingprobe.hasaweb.site/`. All other paths, including `/api/draft`, `/api/runtime-spike` and draft asset paths, remain unavailable. Reserved hosts fail closed. `example` is a recognized internal-only exception but has no published fixture yet. Unknown portfolios return unavailable. Local tests also reject nested names, malformed labels, foreign/deceptive suffixes, trailing dots and unexpected ports.

After approval, save the existing route/DNS/custom-domain state, apply this proposal, and capture deployed response/TLS evidence plus Worker analytics. Test asset hits and misses against the no-Worker exception. Then remove only the experiment's routes/custom domain and disposable fixture objects/resources if requested, restoring any replaced DNS values from the saved state. Do not delete the user's domain/zone or unrelated records/resources. Keeping the skeleton publicly routed after the experiment is a separate owner choice.

If the no-Worker R2 exclusion does not work, keep assets unavailable until the fallback is approved. Serving through site would add one Worker request per asset and requires a new quota model. If static requests invoke the Worker, inspect worker-first matching and negative exclusions, repeat accounting, and record the higher request budget; Paid is not authorized.

## Applied state

The four routes were installed with request_limit_fail_open=false. The initial R2 attachment failed while the zone was pending. Once Cloudflare marked the zone active, attachment succeeded and the assets custom domain reached active ownership and SSL status. The private sites bucket has no custom domain. DNS proxy status and nameserver propagation are tracked in the evidence rather than inferred from zone activation.
