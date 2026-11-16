# Architecture

How hasaweb.site is built and the contracts new work must keep. [product.md](product.md) defines what ships and [acceptance-criteria.md](acceptance-criteria.md) defines pass/fail. Package READMEs hold the detailed per-package contracts; this document links to them rather than repeating them.

## 1. Shape of the system

```
            Visitors                                   Owners
               |                                          |
    username.hasaweb.site                           hasaweb.site
               |                                          |
  +------------v-------------+            +---------------v----------------+
  | Worker: site (thin)      |            | Worker: web                    |
  | *.hasaweb.site/*         |            | Next.js via OpenNext           |
  | no React, no framework   |            | auth, editor, guide, previews  |
  +---+---------+--------+---+            +---+-----+-------+--------+-----+
      |         |        |                    |     |       |        |
     D1        R2       D1 (github,          D1    R2     service binding
  (pointer)  (sites)   outbox, counters)          draft   to jobs OwnerApi
                                                             |
   assets.hasaweb.site                                       v
        |                                +-------------------+-----------------+
        v                                | Worker: jobs                        |
   R2 public bucket                      | Hono OwnerApi, publication dispatch |
   (images, fonts,                       | Queues (publication, GitHub)        |
    platform CSS/JS)                     | Cron (sweeps, cleanup)              |
                                         +-----------------+-------------------+
                                                           |
                                            GitHub API, Resend, cache purge
```

| Worker | Responsibility |
| --- | --- |
| `web` | Next.js app and Better Auth. Handlers that run **before OpenNext**: private uploads and asset reads (`/api/assets/*`), setup check/handoff, full-page draft preview (`/preview*`), the editor preview iframe (`/editor/preview`), and forwarding of `/api/owner/*` to jobs. Never serves portfolios. |
| `site` | Resolves claimed `*.hasaweb.site` hosts and the public asset host through the active version's manifest, streams R2 files, denies unknown/unpublished hosts. Serves `/_/github.json`; `/_/contact` is Phase 44. Imports no React. |
| `jobs` | Named Hono `OwnerApi` for every hot owner route (provisioning, drafts, progress, recovery, address, publication, GitHub), the bounded publication dispatcher, Queue consumers and cron. Its default HTTP entry exposes no owner routes. |

Keeping hot owner APIs out of OpenNext is deliberate: measured OpenNext handlers and whole-document 1 MiB saves exceeded the CPU budget. Do not add whole-draft parsing, validation or serialization to a hot path.

### Hostnames

| Hostname | Target |
| --- | --- |
| `hasaweb.site` (and `www` → redirect) | `web` |
| `assets.hasaweb.site` | R2 public bucket custom domain, excluded from the wildcard route |
| `*.hasaweb.site` (one label) | `site` |
| `mail.hasaweb.site` | Resend sending domain |

Platform-reserved names (`www`, `app`, `api`, `assets`, `mail`, `admin`, `status`, `docs`, `blog`, `help`, `support`, `static`, `cdn`, `example`, `demo`, plus a brand deny-list) live in a code constant and the `reserved_subdomain` table. The marketing example portfolio is a real published site owned by an internal account.

Environments: local development and production only. Staging would need a second domain because Universal SSL covers one wildcard level.

## 2. Platform budget and release gates

Launch runs on **Workers Paid** (currently $5/month minimum). Development stays local and unpaid; upgrade only during launch preparation (Phase 52). The product stays free for owners. Planning load: ~100 portfolios, 30 editing sessions/day, 30 publishes/day.

Paid allowances (recheck at launch; $5 is not a bill ceiling): Workers 10M requests and 30M CPU-ms/month; Queues 1M operations/month (measured dense forecast ~313k); D1 25B reads, 50M writes, 5 GB storage; R2 10 GB-month, 1M Class A, 10M Class B. Resend free tier: 100 emails/day, 3,000/month.

Rules that still bind local work:

- Keep work bounded per invocation: bounded saves, streamed reads, batched publication tasks, bounded cron/queue batches with continuations.
- Paid limits do not authorize whole-draft hot parsing, a per-fragment Workflow design, a provider swap, or cache/privacy changes.
- D1 is the source of truth for async work; Queues and cron are triggers that a sweep can re-drive.

Release gates (Phase 52–54, not local blockers): native paid CPU/startup/cost verification of the final dispatcher and owner handlers; observed CDN withdrawal of cached assets (S-9, below); production bindings, secrets, callbacks and TLS; restore/rollback; operational alerts.

## 3. Technology

TypeScript everywhere; pnpm workspaces + Turborepo; Next.js 16 (pinned, App Router, React 19) on `@opennextjs/cloudflare`; Wrangler. Tailwind CSS v4 with shadcn/ui; dnd-kit for ordering (with Move up/down fallbacks); Tiptap for rich text; `react-easy-crop` + canvas re-encode for crops; Zustand for editor state; Zod schemas; D1 + Drizzle migrations; R2 (three buckets); Better Auth (GitHub, Google); Queues and cron; Resend behind an `EmailProvider` adapter; Turnstile; `culori` (OKLCH) for palettes; self-hosted variable fonts; IndexedDB for local recovery; Biome; Vitest; Playwright + axe-core.

Not used on purpose: Workers KV, Durable Objects, Workflows for publication, Cloudflare Images, Web Analytics, Workers AI.

Exact versions live in the manifests and lockfile. Dependency upgrades need their own compatibility check (Next.js 16.4.0 failed the OpenNext workerd smoke test).

## 4. Data

### Principles

1. **One JSON draft per portfolio**, validated by a versioned Zod schema ([`packages/schema`](../packages/schema/README.md)) and saved with optimistic concurrency on `draft_rev`. Small changes write one row; large changes use bounded staged attempts. See [the draft API](protocols/draft-api.md).
2. **Published state is immutable and versioned.** Publishing writes a new version and moves a pointer.
3. **Live data lives outside snapshots**: GitHub activity, contact outbox, counters.
4. **Every query is owner-scoped** inside the repository layer ([`packages/db`](../packages/db/README.md)); handlers never build raw queries.

### D1 tables

| Table | Notes |
| --- | --- |
| Better Auth (`user`, `session`, `account`, `verification`) + `user.deleting_at` | Owner access always does an uncached check of session and deletion state. |
| `portfolio` | One per account: `subdomain` (published address only), `status` (`draft`/`published`/`unpublished`/`suspended`/`deleting`), `published_version`, `draft` (≤1 MiB JSON), `draft_rev`, `draft_validation_version`, private `setup_progress`, permanent `first_editor_entered_at`. Triggers freeze progress and the milestone after entry. Do not index `draft_rev` or `updated_at`. |
| `subdomain_claim` | Single namespace for holds and claims: `name` PK, unique nullable `portfolio_id`, `state` (`held`/`claimed`). See [address reservation](#address-reservation-and-claim). |
| `address_confirmation` | Durable receipt for each explicit Address command, written in the same batch as the revision CAS. |
| `reserved_subdomain` | Platform-reserved names. |
| `asset` | Private upload metadata: kind, content type, bytes, dimensions, `pending`/`ready`/`failed`. Alt text lives in the draft. |
| Publication tables | Candidates, tasks, pages, version index, retained-version references, admission slots, publish versions and receipts (migrations `0007`–`0014`). See [`packages/db`](../packages/db/README.md#immutable-candidate-delivery). |
| `owner_save_attempt`, `owner_save_piece` | One expiring private staged attempt per owner and its ordered string pieces. |
| GitHub (`github_connection`, `github_activity`, `github_grant`, `github_legacy_credential`, `github_refresh`, `github_published_activity`, consent attempts) | Generation-checked, encrypted, coordinated per app/account. See [GitHub](#github-activity). |
| `contact_recipient`, `contact_outbox`, `counter` | Phases 43–45: verified recipient, transactional outbox, fixed-window limits and email budgets. |
| `operator_email_audit` | Phase 51: operator lookups recorded without the email, kept 90 days or until account deletion. |

### Draft document

The schema lives in `packages/schema`. Shape: `schemaVersion`, optional `requestedSubdomain` (private mirror; the namespace row is authoritative), fixed `profile` (name, bio, location, avatar, banner, `decorationId`, `faceReveal`), `links` (one list for both profile and social component placement), ordered `components` (`{ id, type, version, data }`), `appearance` (`themeId`, `customColor`, `fontId`, `colorMode`), `seo`, and `samples` (fields still holding untouched sample content).

- Draft validation allows unfinished content; publication checks are separate and also check authoritative asset/provider records.
- URLs ≤ 2,048 UTF-8 bytes, email addresses ≤ 254 bytes, whole draft ≤ 1 MiB. Longer stored values need explicit correction, never truncation.
- Version 1 drafts read through a content-preserving migration. Legacy validation generation is separate from schema version: generation 2 is required for validated reads and incremental saves.
- New provisioning inserts no samples. Existing sample markers stay compatible and clear on first edit.
- Schema changes must update incremental validation, generation checks and equivalence fixtures together.

### R2 buckets

| Bucket | Access | Contents |
| --- | --- | --- |
| `hasaweb-draft` | Private, bound only to `web` | Draft uploads (finished crops, resume PDF) |
| `hasaweb-sites` | Private, `site` and `jobs` | Versioned candidate documents, snapshots, manifests |
| `hasaweb-assets` | Public via `assets.hasaweb.site` | Published uploads and content-hashed platform CSS/JS/fonts |

Jobs cannot read the draft bucket. Publication reads private sources through a named web entry (`PublicationAssets`) that verifies persisted candidate/asset tickets before streaming. Asset IDs are never reused, so published URLs are immutable.

## 5. Authentication and owner entry

Sign-in is GitHub or Google at `/sign-in`. GitHub requests only `user:email`; Google its default identity scopes. Accounts auto-link only on a provider-verified matching email; missing or unverified emails never merge owners. The HTTP surface accepts only social sign-in, sign-out, session lookup and the two callbacks; no passwords, arbitrary scopes or callback destinations. Provider settings (link/disconnect) are Phase 47.

Cookies are host-only. HTTPS uses `__Host-hasaweb` cookies (Secure, HttpOnly, SameSite=Lax, Path=/, no Domain); only loopback HTTP uses non-Secure `hasaweb-local` cookies. The Better Auth cookie cache (300 s) is kept for status endpoints, but every owner/editor authorization performs an uncached lookup plus repository access checks, so sign-out and deletion take effect immediately.

Owner routes:

- `GET /api/owner` returns owner ID, name and optional portfolio ID, never email. `?include=email-suggestion` and `?include=profile-suggestions` are explicit opt-in reads that require `X-Expected-Owner-Id`; reading or dismissing a suggestion changes no draft.
- `POST /api/owner/portfolio` and `POST /api/owner/entry` accept only `{}` (≤1,024 bytes). Provisioning inserts one private portfolio once (`portfolio-v1`, Leaf/DM Sans/system, empty fields, no decoration, Face Reveal off, progress at Address, no milestone) and never rewrites it. Provider identity is never copied into public content automatically.
- `/api/owner/entry` returns `entry: setup` (revision and saved progress) or `entry: editor` (revision and milestone timestamp).

Post-auth destinations are fixed: `/auth/entry` for normal sign-in and signed-in `/sign-in` visits, and the pair `/auth/recovery` + `/auth/recovery/error` for same-tab draft-recovery sign-in. Arbitrary return URLs and mixed pairs are rejected.

**Owner-entry gate.** `/auth/entry` and `/editor` mount the real guide and editor only when the web Worker has `OWNER_ENTRY_ACTIVATION=active` (`apps/web/lib/owner-entry-gate.ts`). Committed configuration leaves it closed, so both routes render the welcome shell. It opens after the contact-delivery integration (Phases 43–45) and the onboarding journey check (42F) pass. With the gate open, `OwnerEntry` follows only the persisted entry answer: owners without the milestone get `SetupGuide` at `/auth/entry` (and `/editor` sends them there); entered owners get the editor at `/editor`.

**Setup check and handoff.** `POST /api/owner/setup/check` and `/setup/handoff` accept exactly `{portfolioId, revision}`, run in web (so private image objects can be resolved without giving jobs bucket access), and require an uncached session, exact Origin, JSON and matching `X-Expected-Owner-Id`. Required setup means: generation-2 draft at that revision; non-sample name and bio; ready, owned, correctly purposed avatar and banner whose objects exist with the recorded size; at least one valid labeled link shown in the profile; the mirrored address matching this portfolio's `held` row and not platform-reserved; no open staging. Handoff rechecks all of this in one conditional update, sets the milestone once and is idempotent. Later removal of required content blocks Publish only; it never reruns onboarding.

**Private previews.** `/editor/preview` (iframe child) and `/preview`, `/preview/projects/{slug}`, `/preview/resume` (full page) are handled in web before OpenNext. They verify the original cookie with the owner API and answer every non-owner request (signed out, expired, no portfolio, wrong origin, non-GET, unknown path) with the same empty 404; only an owner-service failure returns 503. Shells contain no draft data and send `private, no-store`, `noindex, nofollow, noarchive`, `Vary: Cookie`, `no-referrer`, `nosniff` and a closed CSP (no inline code, `form-action 'none'`). The browser rechecks identity on focus, visibility and back/forward restore; once a preview has shown an owner, any other signed-in account (with or without a portfolio) ends it with a session-changed notice, and a signed-out session with a sign-in notice. Private files come from `/api/assets/{id}?purpose=…` (and `/view` for inline resume PDFs), which repeat session, ownership, purpose, readiness and object checks on every request.

Local and production configuration (callback URLs, secrets, the separate GitHub activity app) is in the [README](../README.md#local-setup).

## 6. Owner flows

### Initial setup

Sequence (details in [onboarding.md](onboarding.md)): required Address → combined Profile → Links, then optional Skills, Projects and GitHub (public/private), then private Review and Open editor. Optional steps can be skipped individually or together without deleting entered content. Displayed step = saved progress clamped to the first incomplete required step reported by the setup check, so forged or stale progress cannot skip setup. Invalid in-progress text stays in local recovery and never blocks Skip.

### Autosave and recovery

The client lives in [`apps/web/lib/draft`](../apps/web/lib/draft/README.md); the server contract is [the draft API](protocols/draft-api.md). Essentials:

- Coalesce valid changed fields after ~2 s and patch with `revision` and `context`. Show Saved only for acknowledged edits; remaining invalid raw input shows Unsaved input. Conflicts return a code without a document; fetch and reconcile separately.
- Large edits use staged attempts. One attempt per owner across tabs and devices. Web Locks serialize same-origin commands; BroadcastChannel carries revisions and attempt IDs only.
- Unsaved and invalid input is mirrored to IndexedDB, scoped by owner, portfolio, browser instance and base revision. A changed base blocks replay and opens review.
- Conflict review quiesces the controller, fetches the current draft separately, offers Load newer version or an initially unselected three-way selection by stable IDs, rechecks the revision before applying, and saves selected values through a fresh controller.
- On 401 the client persists recovery and an identifier-only tab continuation, then signs in again in the same tab through `/auth/recovery`. The callback checks uncached identity before opening local records; wrong accounts cannot load, copy or delete them.
- After handoff, setup recovery can contribute explicitly selected content to a fresh content scope; it never replays progress or converts setup attempts.
- Local recovery cannot promise cross-device recovery of invalid or unuploaded input.

### Uploads

[Protocol](../apps/web/lib/assets/README.md). JPEG/PNG/WebP up to 5,242,880 bytes, PDF up to 10,485,760 bytes. The client validates, crops, resizes and re-encodes images on a canvas (stripping EXIF). `PUT /api/assets` streams to the draft bucket after purpose, signature and actual-byte checks; the asset becomes `ready` only after complete validated bytes and a repeated persisted authorization check. The draft references an asset only once it is ready, so a failed replacement leaves the previous asset in use. Only finished crops are stored; no source images or crop metadata. Provider photos are fetched server-side from the approved GitHub/Google hosts (`GET /api/assets/provider-photo`), then cropped and uploaded like any file.

### Address reservation and claim

- Availability checks reserve nothing. A confirmed Address save inserts an exclusive `held` row for the portfolio and updates the `requestedSubdomain` mirror in the same D1 batch as the revision CAS, with a durable `address_confirmation` receipt.
- Changing the address before first Publish deletes the current `held` row and inserts the new one in that same atomic batch. Any constraint or CAS failure aborts everything; the old hold and draft remain. Generic, staged and legacy saves never reserve.
- First Publish verifies the portfolio still holds the name, rechecks the platform list and converts the row to `claimed` in the pointer transaction. No fresh availability race.
- The hold lasts for the life of the account. Account deletion deletes held rows and clears `portfolio_id` on claimed rows, which keep the name permanently.

### Publication

Implemented end to end locally; owner routes are `POST /api/owner/publication/*` (start/status/commit, case-study slugs) in jobs.

1. **Admission.** The client flushes autosave, rejects unfinished input/uploads/recovery, pauses the controller and checks readiness at one confirmed revision. `publicationTasks.create` validates the revision, blocks open save attempts and captures only included public fields (no samples, setup data, hidden links, disabled Face Reveal photos or contact recipients). Readiness checks share rules between the editor checklist and the server: required profile/link facts, included component rules, catalog membership, ready owned assets, GitHub fetch state, address hold/claim.
2. **Preparation.** The bounded dispatcher (Queue + D1 tasks) renders through the shared renderer in bounded fragments with streamed assembly, transfers referenced private uploads through the named web entry, and writes a complete private candidate: documents, sanitized snapshot, selected platform files and a hashed manifest. Oversized valid content returns `needs_partitioning`; it is never truncated.
3. **Commit.** One guarded D1 batch verifies the expected state, converts the hold to a claim on first Publish (or verifies the existing claim), moves `published_version`, marks the new version live and records a durable receipt. A retry of a committed publication returns the receipt; a delayed retry can never restore an older version.
4. **Cleanup.** A checkpointed operation scans superseded manifests in batches of eight, deletes removed public uploads, verifies absence and keeps private assets and unchanged retained files.

Failure before commit leaves the pointer and namespace row untouched. After commit, cleanup failure reports that the new version is live and offers Retry. `PUBLICATION_RENDERER_VERSION` is `publication-v6`; retain content-hashed platform files so old versions keep working.

**Case study URLs.** `/projects/{slug}`: lowercase ASCII letters, digits and hyphens, ≤80 characters, `project` when empty, collisions get `-2`, `-3`… Slugs follow the title until first publication, then freeze. A deleted case study keeps its slug reserved until the deletion is published; the `case_study_url` check rejects drafts that change a frozen slug or take another project's live slug.

### Visitor serving

`site` accepts one label before `hasaweb.site`, does one D1 lookup and serves only `published` portfolios (everything else gets the generic unavailable page). Paths resolve through the active manifest; arbitrary bucket keys and private snapshot files have no route. A path missing from a published portfolio's manifest returns that version's `/404`. Resume PDFs are served from `assets.hasaweb.site/candidate/{id}/assets/{assetId}` with `Content-Disposition: attachment`; `/resume` embeds a `/view` variant framable only by the portfolio host. Each response comes wholly from one version.

**Withdrawal (S-9).** Origin deletion and an accepted purge did not remove cached copies in the deployed test. Until deployed browser/edge absence is observed, every served file is `Cache-Control: no-store` and `CDN-Cache-Control: no-store`, query variants map to the same manifest entry, and cleanup completes only after verifying 404, no-store and no stale hit. Changing this cache policy requires new withdrawal verification.

### GitHub activity

Contracts in [`packages/github`](../packages/github/README.md) and [`packages/db`](../packages/db/README.md#github-generations-and-cleanup).

- Counts never enter snapshots. Publication freezes the graph configuration (stable account ID, username, `includePrivate`); `site` reads only that record for the active version and serves `/_/github.json` (`no-store` until S-9). Published pages carry a placeholder that the platform script fills.
- Public calendars use a zero-scope platform token (`GITHUB_SERVICE_TOKEN`). Platform failures never ask the owner to reconnect. Zero contributions succeed; restricted, missing or failed first fetches block publication of the graph only.
- Private activity uses a separate activity OAuth app: `read:user`, S256 PKCE, one-use ten-minute state stored as a hash and bound to user and session, selected stable account ID and username must match. Wrong-account or wrong-scope tokens are revoked. Sign-in scopes never expand and Google owners need no GitHub sign-in.
- Serve either the public calendar or the complete authorized calendar (which already includes public contributions). Never sum or subtract.
- Every write is generation-checked, so a stale refresh or callback cannot restore removed private data or withdraw a newer grant. Grant-wide revocation is serialized with new consent per app/account; consent waits for pending or in-flight cleanup. Unknown legacy credentials block reconsent until reconciled.
- Remove private access, or remove the graph, withdraws private output immediately without Publish and queues durable revocation (run at once and by cron). Ordinary Skip keeps the graph and grant.
- Refresh needs no Publish: a visit or owner status read past the six-hour TTL, or the daily private sweep (25 connections per tick), records at most one request per 15-minute window and sends one `GITHUB_QUEUE` message. Failures keep the last good graph and show Retry; a 401 withdraws private data and asks to authorize again. After a draft account switch, the published account's public calendar stays live until the next Publish.

### Contact form (Phases 43–45)

Visitor posts to `/_/contact` with a Turnstile token. `site` validates fields, applies limits (five per visitor/IP per site per hour; ten accepted per site per UTC day), checks the recipient is verified, then atomically reserves the site and global allowances and inserts a `contact_outbox` row before returning 202. Delivery goes through `EmailProvider` with an idempotency key and the visitor as Reply-To: immediately, then at 5 min, 30 min, 4 h and 24 h, at most five attempts, permanent errors fail at once. Final failure deletes the payload and notifies the owner. Global contact budget 90/day, ten reserved for verification and owner notices; a dispatch-day guard keeps cross-midnight retries inside the provider cap. Test messages use the same path, two per site per day. Preview forms never send. The recipient address never appears in public HTML or data.

### Unpublish, delete, suspend (Phases 48, 49, 51)

- **Unpublish** sets `status = unpublished` (site stops serving immediately), deletes public objects and purges; the draft and address claim remain.
- **Delete** atomically marks the account and portfolio deleting, invalidates sessions, deletes held reservations and orphans the published claim. Durable bounded cleanup revokes grants, removes R2 prefixes and candidate records, verifies withdrawal and deletes account rows. Browser cleanup removes only that owner's recovery range and blocks late writes from recreating it.
- **Suspend** is an operator script that sets `suspended_at` and purges; no admin UI.

## 7. Components, rendering and appearance

**Registry.** Data contracts live in `packages/schema`, one module per optional component; `packages/components` attaches the markup-only renderer through an exhaustive display projection. The registry is the only list of supported types: profile (fixed), projects (with case studies), skills, work experience, text sections (multiple), GitHub activity, contact form, social links, resume download.

**One renderer, two hosts** ([`packages/render`](../packages/render/README.md), [`packages/components`](../packages/components/README.md)). Markup-only React renders both the client preview and static publication output. The display projection excludes private recipient configuration, raw asset IDs, setup/recovery data and disabled second photos; callers resolve authorized assets first. Published pages ship zero React: content-hashed platform CSS and one vanilla `site.js` for theme switching, image states, Face Reveal, decoration playback and the GitHub graph.

**Preview.** The editor uses real iframe viewports (390 px and 1120 px). Display data reaches the iframe in acknowledged `postMessage` chunks; the bridge pins parent window, exact origin, channel and increasing sequence, validates data and rechecks asset origins. The bridge itself grants nothing: the preview adapters authorize the owner first.

**Appearance** ([catalog](appearance-catalog.md), [`packages/theme`](../packages/theme/README.md)). Six presets with paired light/dark tokens, three self-hosted fonts, two decorations. Theme, font and initial mode are server-rendered attributes on `<html>` read by generated CSS. A render-blocking external platform script in `<head>` applies the visitor's stored choice (localStorage, no cookies) before first paint; there is no inline script. The OKLCH custom-palette generator exists and meets WCAG 2.2 AA, but the renderer still ignores `customColor`: delivering it needs retained generated CSS or a reviewed CSP hash, never owner CSS.

**Face Reveal and decorations.** An enabled reveal is one native button containing both images, with a diagonal `clip-path` wipe, `Reveal face`/`Show avatar` labels and an instant switch under reduced motion. Decorations (cleaned 212×220 32-frame cat loop and still; six-second SVG/CSS hands) have an independent Pause/Play control that also works with Face Reveal off. Reduced motion shows the stills and hides the control. Disabling Face Reveal and republishing withdraws the public photo; the private draft asset stays.

## 8. Security and privacy

| Area | Measure |
| --- | --- |
| Owner content | No raw HTML, scripts or CSS. Rich text is Tiptap JSON checked against an allowlist and serialized by our code. Link schemes `https`, `http`, `mailto`; external links get `rel="noopener noreferrer"`. |
| Published CSP | `default-src 'none'`; scripts only from hashed platform files (and Turnstile later); images from `assets.hasaweb.site`; `object-src`/`frame-src` only on `/resume`; no inline script or style; `nosniff`, `Referrer-Policy`, `Permissions-Policy`. |
| Origins | Apex-only host-only auth cookies; portfolio pages run only our code and receive no auth cookies. Submit `hasaweb.site` to the Public Suffix List after launch. |
| CSRF | Better Auth origin checks, SameSite=Lax, exact `Origin` plus JSON content type on every mutation. |
| Authorization | Repository functions take the session user. Drafts, previews and private assets return 404 to anyone else. |
| Secrets | `BETTER_AUTH_SECRET`, OAuth credentials, `GITHUB_SERVICE_TOKEN`, `GITHUB_ACTIVITY_*`, `RESEND_API_KEY`, `TURNSTILE_SECRET`, cache-purge token. Never in the repo. |
| Tokens | GitHub tokens AES-GCM encrypted; deleted and revoked on withdrawal or deletion. Activity key rotation is not implemented. |
| Contact data | Payload kept only until delivered or finally failed. |
| Dev probes | `isLocalProbe` (`packages/config`) allows fixture routes only on loopback in local/test environments. Integration fixtures are built from `apps/*/integration`, never imported by production code. |
| Privacy | No visitor accounts, analytics or cookies on published pages. |

## 9. Operations

- Structured JSON logs with a request ID; counters for publish duration/failures, email budget, queue depth and `exceededCpu`. No visitor analytics.
- Fail closed when limits are hit; `site` returns 503 with `Retry-After` when D1 is unavailable.
- Backups: D1 Time Travel plus optional weekly export to private R2.
- Operator scripts (Phase 51): suspend/unsuspend, rerender, outbox inspection, cache purge, audited email lookup with a case reference.
- Production release (Phase 52): manual GitHub Environment approval, backward-compatible migrations, deploy `jobs` → `site` → `web`, enforce the one-second startup limit. There is no automatic deployment from `main`.

## 10. Testing

See the [README](../README.md#checks) for commands.

| Layer | Tooling | Scope |
| --- | --- | --- |
| Unit | Vitest (`*.test.ts` next to code) | Schema and validation, palette and contrast, renderer output, repositories against local D1 fixtures, routing helpers. |
| Integration and browser | Playwright Test (`e2e/`) against the built Workers in workerd | Owner API contracts, persistence, uploads, auth, renderer parity, autosave/recovery, editor and guide journeys, publication and serving. |
| Manual | Timed target-user sessions | The 15-minute publish target (Phase 54). |

Confirmed verification settings:

| Setting | Value |
| --- | --- |
| Upload limits | 5,242,880 and 10,485,760 bytes; test at the limit and limit + 1 |
| Contrast | WCAG 2.2 AA (4.5:1 normal, 3:1 large text and controls), unit tests plus axe |
| Browsers | Last two stable Chrome, Firefox, Safari, Edge; iOS Safari; Android Chrome |
| Viewports | 360, 768, 1280 px |
| GitHub refresh | Six-hour on-visit TTL, daily private sweep |
| Contact limits and retries | As in [Contact form](#contact-form-phases-4345) |
| Method | Automated browser/viewport tests and provider fixtures. Real-device and assistive-technology testing are out of MVP scope. |
| Provider fixtures | Verified, missing and unverified emails; linking; GitHub public/private activity; revoked authorization; email rejection, timeout and retry. |

## 11. Decision log

| Decision | Why |
| --- | --- |
| Next.js on OpenNext, but hot owner APIs in a thin Hono jobs Worker | Owner preference for Next.js; measured OpenNext and full-body saves exceeded CPU. |
| Pre-render at publish; thin `site` Worker | Near-zero visitor CPU, real SEO metadata, atomic publish as a pointer move. |
| D1 for pointers and live state; no KV | Write limits and transactional guards. |
| Canonical JSON draft with revision CAS and bounded staging | Atomic content+progress, one row for ordinary patches. |
| Bounded Queue/D1 publication dispatcher instead of Workflows | Workflows failed the step budget; dispatcher measured locally. |
| Three R2 buckets | Hard isolation of drafts; public assets bypass Workers. |
| Markup-only components plus vanilla `site.js` | No React on visitor devices; same behavior in preview. |
| Live GitHub data outside snapshots; hybrid refresh | Revocation without republish; bounded Queue use. |
| Transactional outbox for contact | Honest "accepted" semantics and retries. |
| `EmailProvider` with Resend | Cloudflare email sending needs paid features; adapter keeps a swap cheap. |
| Client-side crop and re-encode; keep only finished crops | No server CPU; strips EXIF; owner chose no retained originals. |
| Required setup before a permanent first-editor milestone | Owner decision: guide Address/Profile/Links once, then everything happens in the editor. |
| Reserve on confirmed Address save, claim on first Publish, hold for the account's life | Removes the setup-to-publish race; dormant reclamation can come later. |
| Workers Paid at launch, local development unpaid | Owner decision; removes Free-tier fit as a development blocker. |
| Local and production only | One wildcard TLS level; staging needs another domain. |
