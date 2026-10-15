# S-3, S-4 and S-10 results

Measured October 15, 2026. Production hostname/TLS routing and the tested asset-first request-accounting assumptions pass this spike. The owner approved temporary routing and performed the DNS changes. Phase 04 remains unchecked pending separate completion approval. These observations do not establish overall Free-tier feasibility; S-2 failed its request CPU target and S-1/S-8 still require a proven bounded publication pipeline.

## Production routing and TLS

All 36 deployed HTTPS host/path/method checks pass. The last run uses real DNS answers from public resolver 1.1.1.1 and normal certificate validation. It does not inject Host headers, pin an invented edge IP, disable TLS verification or simulate hosts locally. The separate local workerd experiment passes 31 boundary checks and Vitest checks the full reserved-host and malformed-authority policy.

| Request | Observed behavior |
| --- | --- |
| Apex `/` | 200, compiled OpenNext skeleton |
| Apex `/api/runtime-spike` | 404, operator benchmark disabled |
| `www` root and static path, with query | 308 to the HTTPS apex, preserving path and query |
| `routingprobe` root GET / HEAD | 200, only the synthetic object from the private sites bucket; HEAD has no body |
| `routingprobe` root POST | 405 |
| Portfolio owner APIs, auth session path, draft asset path, resume and health | 404, site entry never delegates to web |
| Unknown portfolio and internal `example` with no published fixture | 404 unavailable |
| app, api, mail, admin, status, docs, blog, help, support, static, cdn, demo | 421 host rejection |
| Short/oversized labels, leading/trailing hyphens, underscore, trailing-dot host | 421; no fixture content |
| Site Worker's unexpected workers.dev hostname | 421 |
| Assets known object / missing object | 200 / 404 from R2, without a site marker or auth cookies |

The architecture's reserved `www` and `assets` have explicit special routes. `example` remains unclaimable by owners but is recognized as the internal-only routing exception. This spike does not provision the real example account or publication; those belong to later phases. The additional brand deny-list and D1-backed claim checks also remain Phase 22 work.

Separate TLS handshakes trust the certificate chains for the apex, www, routingprobe and assets and negotiate TLS 1.3. The Universal SSL certificate has SANs `hasaweb.site` and `*.hasaweb.site`. The R2 custom domain presents its own certificate including `assets.hasaweb.site`. The nested `a.b.hasaweb.site` handshake fails. Full certificate names, issuers, validity dates and fingerprints are in evidence/deployed-routing.json. No deeper wildcard namespace is supported.

## Actual external configuration

The active Free Website full zone is in the same account as R2. Authoritative Cloudflare nameservers are `rajeev.ns.cloudflare.com` and `tina.ns.cloudflare.com`. The owner configured proxied apex/wildcard A records and a proxied www CNAME. Public DNS in the final run returns Cloudflare edge addresses, not the documentation-only origin. The approved routes are:

| Pattern | Script | Request-limit fail open |
| --- | --- | --- |
| `hasaweb.site/*` | hasaweb-s2-spike | false |
| `www.hasaweb.site/*` | hasaweb-s3-redirect | false |
| `*.hasaweb.site/*` | hasaweb-s3-site | false |
| `assets.hasaweb.site/*` | none | false |

The more-specific no-script route successfully excludes assets from wildcard interception, including missing R2 keys. The site Worker has only the private sites bucket binding and serves a fixed synthetic key for a fixed test host/path. There is no draft bucket binding or arbitrary key proxy. The assets bucket contains only a harmless test text file. Both buckets' r2.dev managed domains are disabled. The sites bucket has no custom domain. The assets custom domain reports active ownership/SSL and a minimum TLS version of 1.2.

The site and temporary www redirect Workers each report 2 ms global startup. Their deployment logs and version IDs, all route IDs/fail modes, R2 custom-domain status and managed-domain exclusion are archived in evidence. The daily quota was not deliberately exhausted; fail-closed configuration is verified through the provider response rather than an induced account-wide outage.

The account OAuth grant cannot read or edit DNS records, read certificate packs or use the Workers telemetry REST API. The owner performed DNS changes; public DNS, trusted handshakes and the zone/R2/route APIs supply the resulting evidence. GraphQL analytics and Wrangler tail are available. No broader token, paid certificate, domain transfer or paid plan was required.

## Domain registration dependency

The owner already owned hasaweb.site. Registry RDAP confirms a registration event through Porkbun on October 14, 2026 and the assigned Cloudflare nameservers. S-10 therefore uses its documented external-registrar alternative. There was no reason to purchase/register the same name again or transfer it to Cloudflare Registrar. No purchase or charge was authorized or performed by this task. RDAP's public registration event is retained without registrant contact data.

The initial R2 custom-domain request returned invalid zone while the full zone was pending. Once the zone became active, attachment succeeded. Initial production handshakes failed while system DNS still pointed at old Porkbun infrastructure. A later public lookup returned the unproxied documentation address until the owner enabled proxying. Authoritative DNS then had the correct answers while a cached recursive answer for routingprobe retained the old address until TTL expiry. Those failures and the eventual successful public-resolver run are archived separately. Zone activation alone was not treated as routing/TLS proof.

## Static and asset request accounting

The app test uses the actual deployed OpenNext skeleton and its six hashed build assets. Twenty HTTP app loads each fetch the document and all six assets named in the HTML. This is a reproducible network workload, not a claim of full interactive browser coverage. No browser cache is used. CDN observations include both MISS and HIT for existing static files. There is no worker-first override. Response/cache headers alone are not the accounting evidence.

| Controlled window | Client HTTP requests | Worker analytics observation |
| --- | ---: | --- |
| Dynamic health before | 20 | 18 estimated web invocations |
| Existing hashed static file only | 100 | no web invocations |
| Missing static build path | 20 | 17 estimated web invocations |
| Twenty documents plus six assets each | 140 | 18 estimated web invocations |
| Dynamic health after | 20 | 20 estimated web invocations |

This supports asset-first build-file requests being outside Worker invocation accounting. A statically prerendered Next.js document still enters the OpenNext Worker in this deployment. Missing build assets also invoke OpenNext and count. Do not model all marketing page traffic or arbitrary missing paths as unlimited/free Static Assets requests. If the final marketing document CPU is unsafe, serve genuinely static HTML before the Worker. Avoid enabling run_worker_first over immutable assets; if a protected path needs it, prove the matching exclusions and accounting again.

A separate real R2 custom-domain run sends 50 existing-object and 50 missing-object requests. During that assets-only window, analytics reports no invocations for any of the web, site or redirect Workers. Before and after controls invoke the site Worker 20 and 100 times through its rejected workers.dev hostname. The adaptive dataset reports approximately 40 and 187 requests with average sample intervals 4 and 8.5. The discrepancy is retained, not converted into exact billable counts. The controls establish that the dataset can observe that Worker while the assets window remains empty. Missing R2 keys bypass Workers too; they still consume R2 operations.

All raw requests, window bounds, GraphQL queries/results, cache observations and sampling intervals are retained. The earlier asset run overlapped part of hostname verification and contains background/mixed invocations, including one web invocation in KBP. It is preserved as initial evidence; a separate later run, without concurrent hostname probes, provides the final controlled windows. Adaptive analytics, short windows and potential background traffic prevent exact unsampled per-request or account-billing reconciliation. This is production routing/accounting evidence for these paths, not a guarantee about every future configuration or the whole application's monthly cost.

## Decisions, fallback and remaining work

Retain the wildcard site route and explicit no-Worker assets exception. Keep immutable build files asset-first and budget documents, API requests and missing static paths as Worker traffic. Assets through site are not needed by this spike. If that fallback is ever required, each asset adds Worker requests and the capacity model must change before launch.

The www redirect uses a disposable Worker so even matching static paths redirect before asset serving. The final three-Worker deployment should replace it with a zone Redirect Rule, then repeat the same tests. Adding that permanent rule or migrating experiment names/resources is later delivery configuration work, not a change silently made here.

Temporary approved routes and tiny fixture resources remain for review. The real-auth write probe is disabled and its synthetic sessions/users have been removed. The empty S-2 database is isolated from existing account databases. The optional fixture cleanup/route rollback must preserve the user's new zone, DNS and unrelated resources. The pre-experiment route list was empty. Review proposed-configuration.md before cleanup or migration.

No technical external check required by S-3/S-4/S-10 is left pending for the tested configuration. Owner approval to check off Phase 04 remains pending. S-2's replacement runtime measurement, S-8's Workflow/assembly proof and later product/provider phases remain separate dependencies.

## Reproduce and verify

- `pnpm spike:routing` bundles and tests the site entry with local workerd and real local R2. Unit tests additionally cover the policy's full authority matrix.
- `node scripts/deployed-host-routing.mjs --public-dns` makes real production requests and trusted TLS handshakes after the approved resources/routes exist. Omit the flag to use system DNS; an old system resolver can still differ during propagation.
- `node scripts/static-accounting-spike.mjs` exercises the deployed app's Static Assets. `node scripts/asset-accounting-spike.mjs` exercises the real R2 custom domain with before/after controls.
- `python3 scripts/cloudflare-analytics.py --account ACCOUNT --worker WORKER --windows REQUESTS_JSON --output OUTPUT` retains provider analytics for the recorded windows. Repeat for each routed Worker. It reads configured credentials without printing them.
- `python3 scripts/routing-configuration.py --account ACCOUNT --zone ZONE` is read-only. Its explicit apply flags were used only after the owner's temporary-routing approval. It refuses to overwrite conflicting routes and never edits DNS.

The full workspace build, strict types, Biome, eight unit tests, local routing checks, real-auth benchmark and the three-Worker persistence smoke pass. CI runs both local spikes without provider credentials. Raw production response/TLS evidence is separate from these local correctness checks.

## Official provider sources checked October 15, 2026

- [Worker route precedence and no-script exclusions](https://developers.cloudflare.com/workers/configuration/routing/routes/) defines the more-specific asset exception.
- [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) explains free asset requests and the Worker-first exception.
- [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) documents same-account custom domains and disabling managed public access.
- [R2 custom-domain API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/custom/methods/create/) documents the actual attachment and TLS setting.
- [Universal SSL coverage](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/) limits full-zone coverage to the apex and first-level hosts.
- [Registrar TLD support](https://developers.cloudflare.com/registrar/top-level-domains/) and [full zone setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/) describe registration/setup dependencies. This already-owned domain used external registration and Cloudflare DNS.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) defines request budgets/fail modes. [Workers analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) describes sampled production observations.
