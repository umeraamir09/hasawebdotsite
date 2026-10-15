# Live verification

`pnpm spike:workflow:live` creates uniquely named synthetic PNG objects in the existing `hasaweb-s3-assets` experiment bucket. It warms a CDN HIT, deletes only that object, checks R2 origin absence, purges exactly its URL, and checks GET, HEAD and a new query variant. It does not change DNS, routes or cache settings. The key and observations are retained in `live-evidence.json`.

Wrangler's saved OAuth login provides R2 access but lacks zone Cache Purge permission. Copy `.env.example` to the ignored repository-root `.env.workflow-spike.local`, and fill in a token scoped to hasaweb.site with Zone / Cache Purge / Purge permission. Keep the token out of chat, source control and evidence. The runner uses it only for purge; R2 continues to use the saved Wrangler login.

The current vantage is the local machine's network. Different CF-Ray location suffixes must actually be observed before claiming multiple CDN locations. Do not use forged headers or forced IPs as proof of a remote vantage. A cached HIT remaining after deletion is expected before purge and demonstrates why origin deletion alone does not pass S-9.

## Deployed workflow execution

`pnpm spike:workflow:execution:live` deploys the isolated `hasaweb-s8-spike` Worker and Workflow definition with its own D1 database and private R2 bucket. No Worker routes, workers.dev endpoint, custom domain, queue or paid-plan change is configured. The HTTP test controls also reject non-loopback hosts. It uploads only S-1 synthetic normalized fragments, creates two competing three-page candidates with unique instance IDs, and compares completed R2 outputs against independently rendered expected HTML. Resources remain for review. The earlier sequential run was deliberately terminated after recording its I/O cost, and its original input records are reusable with `--reuse-fixtures`.

Live runs consume account-wide Free step allowances. Do not repeat them merely to obtain a faster sample. The CLI records provider status and does not equate successful execution with proven CPU headroom.

The asset check now uses Browser Run's `/content?cacheTTL=0` endpoint as a remote vantage in addition to local requests. This explicitly disables its default five-second API response cache. Remote locations may vary between requests. Record actual CF-Ray suffixes and do not claim that a previously warmed edge was rechecked unless the suffix matches. A transient Browser Run failure gets at most three attempts. No worldwide propagation guarantee follows from these samples.

If the client observation deadline expires while provider instances are still running, run `pnpm spike:workflow:observe:live` to continue observing the IDs in the evidence file. This command creates no new instance, does not redeploy and does not upload fixtures again. It verifies all six completed page bodies and the one-winner commit result. Do not interpret an observation timeout as a provider failure or rerun publication just to observe its outcome.

The archived near-limit three-page run deliberately failed the provider's per-invocation API request limit and returns nonzero. Use `pnpm spike:workflow:execution:live -- --reuse-fixtures --small` for a separate small completion case with three fragments per page. It writes `workflow-smoke-evidence.json`, preserving the failed stress report. Small completion is not a substitute for validating the fallback at the valid draft envelope and planned daily volume.
