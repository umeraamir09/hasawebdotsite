# Acceptance criteria

- A tested local routing model distinguishes the apex, www redirect, wildcard portfolio names, every architecture reserved name, the internal example exception and assets bypass. Malformed, nested and foreign hosts fail closed.
- Deployed apex/www/portfolio/reserved/assets requests and TLS chains prove actual Cloudflare routing. Asset hits and misses bypass both Workers; unknown portfolios return unavailable; owner API paths on portfolio hosts never reach web.
- Production request-count deltas distinguish static hits from dynamic requests and missing assets. Record analytics windows, traffic volume, background traffic and cache conditions.
- Record active zone, DNS/route precedence, R2 custom domain, fail-closed settings, TLS, S-10 availability/registration dependency, approvals and fallback.
- Local checks and documentation do not satisfy deployed routing/accounting. Missing infrastructure remains pending. The roadmap checkbox requires owner approval.

## Evidence

The local model passes two policy tests and 31 workerd/R2 boundary checks. All 36 deployed host/path/method checks pass. Trusted TLS covers apex/first-level hosts and rejects a nested host. The active R2 assets custom domain and explicit no-script exclusion serve hits/misses without Worker invocations in the measured window; private sites and both managed r2.dev domains remain nonpublic. Existing build files produce no observed Worker invocations, while documents/missing files and dynamic controls do. Adaptive counts are not exact billing reconciliation. The owner-confirmed existing registration and registry RDAP satisfy S-10's external-registrar alternative. Temporary routing approval was received, and the owner separately approved phase completion on October 15, 2026. See results.md and evidence.
