# Acceptance criteria

- A tested local routing model distinguishes the apex, www redirect, wildcard portfolio names, every architecture reserved name, the internal example exception and assets bypass. Malformed, nested and foreign hosts fail closed.
- Deployed apex/www/portfolio/reserved/assets requests and TLS chains prove actual Cloudflare routing. Asset hits and misses bypass both Workers; unknown portfolios return unavailable; owner API paths on portfolio hosts never reach web.
- Production request-count deltas distinguish static hits from dynamic requests and missing assets. Record analytics windows, traffic volume, background traffic and cache conditions.
- Record active zone, DNS/route precedence, R2 custom domain, fail-closed settings, TLS, S-10 availability/registration dependency, approvals and fallback.
- Local checks and documentation do not satisfy deployed routing/accounting. Missing infrastructure remains pending. The roadmap checkbox requires owner approval.
