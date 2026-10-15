# hasawebsite: Architecture

| | |
| --- | --- |
| **Status** | Draft v0.2, open-question decisions confirmed |
| **Date** | October 13, 2026 |
| **Inputs** | [product.md](product.md), [acceptance-criteria.md](acceptance-criteria.md), [rough-idea.md](rough-idea.md), architecture interview |
| **Cloudflare limits verified** | October 12-13, 2026 against official documentation (see [Sources](#18-sources)). Limits change; re-verify before launch. |

---

## 1. Purpose and scope

This document defines the technical architecture for the hasawebsite MVP: the technologies used, how the system is split across Cloudflare services, how data flows, and how the design stays inside Cloudflare's free tier while keeping a one-step upgrade path to Workers Paid ($5/month).

It covers the MVP as scoped in `product.md`. It does not redesign features, add capabilities, or choose visual design details (theme names, fonts, decoration art), which `product.md` leaves open. Section 16 records the confirmed decisions and the remaining design task.

**Conventions.** Items marked **[confirmed]** were decided by you in the interview. Items marked **[default]** are architect defaults you did not discuss and may override. Items marked **[spike]** rest on an assumption that must be verified early (see [section 15](#15-risks-and-spikes)).

---

## 2. Decisions captured in the interview

| # | Topic | Decision | Status |
| --- | --- | --- | --- |
| D-1 | Budget | Free tier for launch; design so upgrading to Workers Paid ($5/month) is a configuration change, not a rewrite | confirmed |
| D-2 | Target scale | Up to ~100 portfolios (beta/launch) | confirmed |
| D-3 | Domain | `hasaweb.site`, **not yet registered**; DNS must live on Cloudflare | confirmed |
| D-4 | Framework | Next.js (App Router) on Workers via the OpenNext Cloudflare adapter | confirmed |
| D-5 | Public serving | Pre-render each portfolio at publish time into R2; a thin Worker serves the snapshots | confirmed |
| D-6 | Email delivery | Resend free tier, behind an `EmailProvider` adapter so Cloudflare Email Service can replace it later | confirmed |
| D-7 | Authentication | Better Auth with Drizzle on D1; GitHub and Google | confirmed |
| D-8 | GitHub refresh | Hybrid: daily scheduled refresh for sites with private activity enabled; refresh-on-visit for everyone else | confirmed |
| D-9 | UI stack | Tailwind CSS + shadcn/ui + dnd-kit | confirmed |
| D-10 | Rich text | Tiptap (ProseMirror) | confirmed |
| D-11 | Environments | Local development + production only | confirmed |
| D-12 | Abuse handling | Operator kill-switch to suspend a site, plus a report-abuse email address | confirmed |

---

## 3. Architectural drivers

These requirements from `product.md` and `acceptance-criteria.md` shape the design more than any other.

| ID | Driver | Source | Consequence |
| --- | --- | --- | --- |
| A-1 | Publishing is **atomic**: visitors never see a mix of old and new content; a failed publish leaves the previous version intact | product 15, AC 15.7-15.8 | Immutable, versioned snapshots plus a single pointer flip in D1 |
| A-2 | Drafts and draft assets are **private**; published content changes only on Publish | product 13-14, AC 13.7, 14.6 | Separate draft and public storage; authenticated draft access only |
| A-3 | **Live data** changes without Publish: GitHub activity (including private-count removal on revoke) and contact delivery | product 9-10, AC 9.4, 9.9 | Live data is never baked into HTML snapshots; it is served from separate endpoints |
| A-4 | Subdomain claim is **atomic** under concurrent publishes | AC 15.2 | Unique subdomain claim in D1, created in the same transaction as the pointer flip |
| A-5 | Autosave detects **stale versions** across tabs and devices | product 14, AC 14.4 | Optimistic concurrency with a draft revision counter |
| A-6 | Owner-generated pages are served from sibling subdomains of the app domain | product 8, AC 8.3 | No owner HTML/CSS/JS; strict allowlist rendering; strict CSP; host-only cookies |
| A-7 | **Free-tier limits**: 10 ms CPU per request, 100,000 Worker requests/day, 100 emails/day, 1,000 KV writes/day | Cloudflare docs | Pre-rendering, D1 instead of KV for state, outbox pattern, bounded cron work |
| A-8 | Component library must **grow over time** | rough-idea 4-5 | Component registry: each component is a self-describing module |
| A-9 | Accessibility and readable generated palettes | product 12, 16 | Pure, tested palette generator; accessible primitives; axe in CI |

---

## 4. Cloudflare free-tier constraints and what they force

Verified against Cloudflare's published limits (Workers limits page last updated October 12, 2026). Some third-party articles quote outdated figures (for example a 1 MB script limit or 30 ms CPU); the official documentation is authoritative.

| Service | Free-tier limit | Design implication |
| --- | --- | --- |
| **Workers** | 100,000 requests/day (account-wide); **10 ms CPU per request**; 50 subrequests/request; 5 Cron Triggers; 64 MiB uncompressed script (no compressed limit); 1 s startup | Visitor traffic must be near-zero CPU, so pre-render. Next.js on the free plan is workable but SSR is risky (Cloudflare notes SSR commonly uses 10-20 ms), so **avoid per-request SSR**. Keep bundle startup under 1 s. |
| **Workers Static Assets** | 20,000 files/version; 25 MiB/file | Fine for the Next.js build output. |
| **D1** | 5 GB total, **500 MB per database**, 10 databases; 5M rows read/day; **100K rows written/day**; 50 queries per invocation; Time Travel 7 days | Single database. Keep autosave to one row write. Avoid indexes on frequently updated columns (each indexed write counts as an extra row). |
| **R2** | 10 GB-month; 1M Class A ops/month; 10M Class B ops/month; zero egress | Three buckets (draft, sites, public assets). Serve public assets from an R2 custom domain so image traffic does not consume Worker requests. |
| **KV** | 1 GB; 100K reads/day; **1,000 writes/day** | **Not used** for publish state or caching. |
| **Queues** | 10,000 operations/day (a message typically costs about three operations) | Use only for contact delivery and GitHub refresh. D1 outbox is the source of truth. |
| **Workflows** | 100K requests/day; 10 ms CPU per invocation (per pricing page) | Used for the publish pipeline. Confirm step and concurrency limits in a spike. |
| **Workers Logs** | 200K events/day | Structured, sparse logging. |
| **Cloudflare Email Service** | Sending to arbitrary recipients **requires Workers Paid**; free plan can only send to verified addresses in your own account | Cannot be used for owner or visitor email on the free plan, hence Resend. |
| **Resend (free)** | 3,000 emails/month, **100/day**, 1 verified domain | Global and per-site daily email budget guard. |
| **Turnstile, Email Routing (inbound), Universal SSL, DNS** | Free | Spam protection, `abuse@` inbox, TLS for apex and first-level wildcard. |

Only unavoidable cost at launch: **domain registration** for `hasaweb.site`.

---

## 5. System overview

### 5.1 Topology

```
            Visitors                                   Owners
               |                                          |
    username.hasaweb.site                           hasaweb.site
               |                                          |
  +------------v-------------+            +---------------v----------------+
  | Worker: site (thin)      |            | Worker: web                    |
  | route *.hasaweb.site/*   |            | Next.js via OpenNext           |
  | ~1-2 ms CPU per request  |            | editor, auth, API, preview     |
  +---+---------+--------+---+            +---+-----+-------+--------+-----+
      |         |        |                    |     |       |        |
     D1        R2       D1 (outbox,          D1    R2     R2      Workflow
  (pointer)  (sites)   github, counters)           draft  sites   trigger
                                                    |       ^        |
   assets.hasaweb.site                              |       |        v
        |                                +----------+-------+--------+---------+
        v                                | Worker: jobs                        |
   R2 public bucket                      | Workflows (publish, delete)         |
   (images, fonts,                       | Queues (contact, github refresh)    |
    platform CSS/JS)                     | Cron (daily sweep, outbox, GC)      |
                                         +-----------------+-------------------+
                                                           |
                                                   Resend, GitHub API,
                                                   Cloudflare cache purge
```

### 5.2 Workers

| Worker | Responsibility | CPU profile |
| --- | --- | --- |
| **`web`** | Next.js app: marketing page (statically prerendered), sign-in, editor shell (client-rendered), full-page preview (client-rendered), settings, REST route handlers (`/api/*`), authenticated draft-asset streaming, publish trigger, subdomain checks. Never serves user portfolios. | Light per request. No ISR, no data cache, no Node middleware (unsupported by OpenNext); auth checks happen in route handlers and layouts. |
| **`site`** | Serves `*.hasaweb.site`: resolves subdomain to the live version, streams pre-rendered HTML and the resume PDF from R2, and hosts two small public endpoints (`/_/github.json`, `/_/contact`). | Near-zero. No rendering, no framework. |
| **`jobs`** | Hosts Workflows (publish, unpublish/delete, re-render-all), Queue consumers (contact delivery, GitHub refresh), and Cron handlers (daily sweep, outbox sweeper, garbage collection). | Each step bounded to fit 10 ms on free. |

Splitting these keeps the public path tiny, keeps Next.js CPU off visitor traffic, and means each Worker can scale or be upgraded independently. Cross-Worker calls use service bindings and Workflow bindings.

### 5.3 Domains and routing

| Hostname | Target | Notes |
| --- | --- | --- |
| `hasaweb.site`, `www.hasaweb.site` | `web` | Apex is the app; `www` redirects to the apex. |
| `assets.hasaweb.site` | R2 public bucket (custom domain) | No Worker in the path. Needs an explicit "no Worker" route so the wildcard route does not capture it **[spike]**. |
| `*.hasaweb.site` (single level) | `site` | Wildcard Worker route plus a proxied wildcard DNS record. Universal SSL covers apex plus one wildcard level. |
| `mail.hasaweb.site` (or apex) | Resend sending domain | SPF/DKIM records on Cloudflare DNS. |

Reserved subdomains (cannot be claimed): `www`, `app`, `api`, `assets`, `mail`, `admin`, `status`, `docs`, `blog`, `help`, `support`, `static`, `cdn`, `example`, `demo`, plus a deny-list of well-known brand names to limit impersonation. Maintained as a code constant plus a D1 table so it can grow without a deploy.

The marketing page's **example portfolio** is a real published site (for example `example.hasaweb.site`) owned by an internal account, so it always reflects the real renderer.

### 5.4 Two environments

Local development and production only **[confirmed]**. Because free Universal SSL covers a single wildcard level, a staging environment with wildcard portfolio subdomains would need a second domain. If staging becomes necessary later, the cheapest route is a second inexpensive domain with its own Cloudflare zone.

---

## 6. Technology inventory

**[confirmed]** unless marked **[default]**. Versions: use the latest stable at project start and pin exact versions in `package.json`.

| Layer | Technology | Purpose |
| --- | --- | --- |
| Language | TypeScript (strict), Node.js LTS for tooling | One language across all Workers and packages |
| Package manager / monorepo | pnpm workspaces **[default]** with Turborepo | Three apps, shared packages |
| App framework | Next.js 16, App Router, React 19 | Editor, auth, API, marketing |
| Cloudflare adapter | `@opennextjs/cloudflare`, Wrangler | Run Next.js on Workers; deploy all Workers |
| UI | Tailwind CSS v4, shadcn/ui (Radix primitives) | Editor UI and portfolio styling |
| Animation | GSAP | UI and portfolio animations, with reduced-motion support |
| Drag and drop | dnd-kit (pointer + keyboard sensors) | Component and entry reordering, with Move up/down fallback buttons |
| Rich text | Tiptap (ProseMirror), client-side only | Text sections and case studies |
| Image cropping | `react-easy-crop` + Canvas re-encode **[default]** | Avatar, banner, project, and case-study images |
| Editor state | Zustand **[default]** | Draft state, save status, preview sync |
| Data fetching | TanStack Query **[default]** | Mutation retries and Saving/Saved/Couldn't save status |
| Validation | Zod | Draft schema, API payloads, per-component schemas |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM + drizzle-kit migrations | Relational state and the draft document |
| Object storage | Cloudflare R2 (three buckets) | Draft uploads, rendered pages, public assets |
| Auth | Better Auth (GitHub, Google) with Drizzle adapter | Sessions, account linking |
| Orchestration | Cloudflare Workflows, Queues, Cron Triggers | Publish pipeline, delivery and refresh jobs, sweeps |
| Email | Resend (REST via `fetch`) behind `EmailProvider` | Contact delivery, recipient verification, owner notices |
| Spam protection | Cloudflare Turnstile | Contact form |
| Color math | `culori` (OKLCH) **[default]** | Palette generation and contrast checks |
| Fonts | Self-hosted variable fonts (`@fontsource` subsets) **[default]** | Curated font list, no third-party font requests |
| Local recovery | IndexedDB via `idb-keyval` **[default]** | Unsaved-edit recovery |
| Lint/format | Biome **[default]** | Consistent code style |
| Unit/integration tests | Vitest, `@cloudflare/vitest-pool-workers` **[default]** | Pure logic and Worker integration |
| End-to-end tests | Playwright + axe-core **[default]** | Journeys, responsive, accessibility |
| CI/CD | GitHub Actions **[default]** | Test, migrate, deploy |
| Observability | Workers Logs; Sentry optional **[default]** | Operational diagnostics (no visitor analytics) |

**Not used on purpose:** Workers KV (write limit), Durable Objects (not needed at this scale), Cloudflare Images transformations, Web Analytics (visitor analytics are deferred in the product), Workers AI, Containers.

---

## 7. Data architecture

### 7.1 Principles

1. **The draft is one JSON document** per portfolio, validated by a versioned Zod schema, saved with optimistic concurrency. One row write per autosave, trivially atomic, trivially snapshot-able.
2. **Published state is immutable and versioned.** Publishing never edits files in place; it writes a new version and moves a pointer.
3. **Live data lives outside snapshots** (GitHub activity, contact outbox, counters).
4. **Every query is scoped to the session's owner** inside a repository layer; handlers never build raw queries.

### 7.2 D1 tables (Drizzle/SQLite)

| Table | Key columns | Notes |
| --- | --- | --- |
| Better Auth tables (`user`, `session`, `account`, `verification`) | per Better Auth, plus `user.deleting_at` | Sessions use Better Auth's cookie cache. Authorization must still check deletion state before allowing owner access. |
| `portfolio` | `id`, `user_id` (unique), `subdomain` (unique, nullable), `status` (`draft`/`published`/`unpublished`/`suspended`/`deleting`), `published_version` (nullable), `draft` (JSON, capped at 1 MiB), `draft_rev` (integer), `suspended_at`, `suspended_reason`, timestamps | One row per account (one portfolio per account). The `subdomain_claim` table enforces ownership and permanent reservations atomically. Do not index `draft_rev` or `updated_at`. |
| `asset` | `id`, `portfolio_id`, `kind` (`avatar`/`banner`/`face`/`project`/`case_study`/`resume`/`og`), `content_type`, `bytes`, `width`, `height`, `status` (`pending`/`ready`/`failed`) | Alt text lives in the draft document, not here. |
| `publish_version` | `id`, `portfolio_id`, `n`, `status` (`rendering`/`live`/`failed`/`superseded`), `renderer_version`, `manifest` (JSON: pages, public assets, byte sizes), `error`, timestamps | Snapshot JSON itself is stored in R2, not D1. |
| `reserved_subdomain` | `name` | Seeded from the constant list. |
| `subdomain_claim` | `name` primary key, `portfolio_id` unique and nullable | First Publish inserts the claim atomically with the live pointer update. Account deletion clears `portfolio_id` and retains only `name` permanently. Claims with no owner cannot be reassigned. |
| `operator_email_audit` | `id`, `operator_id`, `account_id`, `case_reference`, `accessed_at` | Records each operator email lookup without the retrieved email. Delete after 90 days or on deletion of the associated account. |
| `github_connection` | `portfolio_id`, `login`, `github_user_id`, `token_enc`, `scopes`, `private_enabled`, `status` (`ok`/`needs_reconnect`/`disconnected`), `last_checked_at` | Token encrypted with AES-GCM (Web Crypto) using a secret key. |
| `github_activity` | `portfolio_id`, `public_days` (JSON), `private_counts` (JSON, nullable), `fetched_at`, `last_error`, `refresh_requested_at` | Public output is computed at read time from flags, so disabling private activity takes effect immediately. |
| `contact_recipient` | `portfolio_id`, `email`, `verified_at`, `pending_token_hash`, `token_expires_at` | Initially the account's verified provider email. |
| `contact_outbox` | `id`, `portfolio_id`, `payload` (JSON), `status` (`queued`/`sending`/`sent`/`failed`), `attempts`, `next_attempt_at`, `last_error`, `is_test`, `accepted_at`, `deadline_at`, `budget_window_start` | The budget reservation uses the UTC acceptance day. Payload is deleted on success and after final failure (data minimization). |
| `counter` | `key`, `window_start`, `count` | Fixed-window rate limits and the daily email budget. |

### 7.3 The draft document

Illustrative shape (final schema lives in `packages/schema`):

```ts
type DraftDoc = {
  schemaVersion: number;
  profile: {
    name: string; bio: string; location?: string;
    avatar?: { assetId: string; alt?: string; accepted: boolean };
    banner?: { assetId: string; alt?: string };
    decorationId?: string;
    faceReveal: { enabled: boolean; assetId?: string; alt?: string };
  };
  links: Array<{                       // single source for profile + social component
    id: string; label: string; kind: 'email' | 'github' | 'linkedin' | 'x' | 'website' | string;
    value: string; showInProfile: boolean; showInSocialComponent: boolean;
  }>;
  components: Array<{ id: string; type: string; version: number; data: unknown }>; // array order = page order
  appearance: { themeId: string; customColor?: string; fontId: string; colorMode: 'light' | 'dark' | 'system' };
  seo: { title?: string; description?: string; ogImageAssetId?: string };
  samples: Record<string, true>;       // fields still holding untouched sample content
};
```

- **Sample tracking:** sample values are flagged in `samples` and cleared on first edit, which drives "untouched optional samples are omitted" and "editing a sample triggers normal validation".
- **Size cap:** 1 MiB per draft (D1 rows max out at 2 MB). If real portfolios outgrow it, case studies can move to their own rows without changing the API.
- **Migrations:** each component type owns a version number and a migration function; `schemaVersion` migrates the envelope. Migrations run on read and are written back on next save.

### 7.4 R2 buckets and key layout

| Bucket | Access | Contents |
| --- | --- | --- |
| `hasaweb-draft` | Private; only `web` binding; served to the owner through an authenticated route | `draft/{portfolioId}/{assetId}` (cropped images, resume PDF) |
| `hasaweb-sites` | Private; only `site` and `jobs` bindings | `sites/{siteId}/v{n}/snapshot.json`, `index.html`, `projects/{slug}/index.html`, `resume/index.html`, `resume.pdf`, `404.html`, `robots.txt`, `sitemap.xml` |
| `hasaweb-assets` | **Public** via `assets.hasaweb.site` (r2.dev access disabled) | `s/{siteId}/{assetId}.{ext}` (published images), `p/{hash}/...` (platform CSS, JS, fonts; content-hashed and retained) |

Asset IDs are never reused, so published image URLs are immutable and replaced images naturally bust caches.

---

## 8. Key flows

### 8.1 Autosave and conflict handling (product 14)

1. The editor keeps the draft in a Zustand store. After a ~2 s debounce it sends `PUT /api/draft` with the document and `baseRev`.
2. The server validates with Zod and runs `UPDATE portfolio SET draft=?, draft_rev=draft_rev+1 WHERE id=? AND user_id=? AND draft_rev=?`.
3. **One row changed:** return the new `rev`; UI shows **Saved**. **Zero rows:** return `409` with the newer document; UI offers **Load newer version** or **Keep my edits for review**. Nothing is overwritten silently.
4. While a save is in flight the UI shows **Saving**; on failure it shows **Couldn't save** with Retry.
5. Unsaved edits are mirrored to IndexedDB (keyed by portfolio and base revision) and removed after a confirmed save, so a crash or temporary failure loses nothing.
6. On `401` (expired session) a sign-in popup restores the session without discarding editor state, then the save retries.

At roughly 100 owners this is a handful of thousand D1 row writes per day, far below 100,000.

### 8.2 Uploads (product 13)

1. The client validates type and size (JPEG/PNG/WebP up to 5 MiB, exactly 5,242,880 bytes, and PDF up to 10 MiB, exactly 10,485,760 bytes), crops, resizes, and re-encodes images on a canvas (this also strips EXIF/GPS metadata).
2. The client sends the file with `XMLHttpRequest` to `PUT /api/assets` for progress events.
3. The server re-checks size and **magic bytes**, writes to `hasaweb-draft`, inserts an `asset` row (`pending` then `ready`).
4. The draft references the new asset ID **only after** the asset is `ready`. A failed or interrupted replacement therefore leaves the previous asset in place in both draft and published use.
5. Draft assets are fetched only through `GET /api/assets/{id}` with an ownership check; everyone else gets `404` (AC 13.7).

### 8.3 Publish (product 15), the core flow

Publish is a **Workflow** in `jobs` with durable, individually retried steps:

1. **Request.** `POST /api/publish` carries `draftRev`. `web` rejects it unless `draftRev` equals the stored revision (so exactly what the owner saw is published) and the editor has flushed autosave.
2. **Validate.** One pure function, `validateDraft(draft, context)`, is shared by the editor checklist (client) and the server (authoritative). It checks required profile fields, link validity, asset readiness, GitHub fetch state, verified contact recipient, resume PDF, and subdomain format/availability. Issues carry a field path so each checklist item deep-links to its control.
3. **Snapshot.** Write `snapshot.json` for version `n` to `hasaweb-sites`. Omit untouched samples and include only assets reachable from included components (Face Reveal's second image is included only when enabled).
4. **Promote assets.** Server-side copy referenced images from `hasaweb-draft` to `hasaweb-assets/s/{siteId}/...`.
5. **Render.** One step per page (portfolio, each case study, `/resume`, `404`), plus `robots.txt` and `sitemap.xml`, each written under `sites/{siteId}/v{n}/`. S-1 local measurements reject one whole-page render per step near the 1 MiB draft ceiling. Use the bounded preparation/render/assembly approach recorded in [the S-1 results](../specs/2026-10-15-publish-render/results.md); verify its Workflow and storage feasibility in S-8 before publication implementation.
6. **Flip.** A single D1 batch: insert the unique `subdomain_claim` on first publish, checking platform-reserved names and permanent reservations, set `portfolio.published_version = n`, mark the version `live` and the previous `superseded`. If the claim conflicts, the version is marked `failed`, no site is reported live, and the owner is told the name is unavailable.
7. **Clean up.** Delete public objects no longer referenced by the manifest (this is how a disabled Face Reveal photo disappears), purge those URLs from the CDN cache, and delete old versions beyond a short retention window.

Failure at any step leaves `published_version` untouched, so visitors continue to see the previous complete version; the UI offers **Retry** (AC 15.8). The UI polls the version status until `live`.

### 8.3.1 Case study URLs

Case studies use `/projects/{slug}`. Generate a slug from the title with lowercase ASCII letters, numbers, and hyphens. Convert spaces and punctuation to hyphens, collapse repeated hyphens, and trim leading and trailing hyphens. Slugs contain at most 80 characters. Use `project` if the title produces no usable characters. Resolve collisions within the portfolio with `-2`, `-3`, and subsequent suffixes, truncating the base to keep the complete slug within 80 characters.

Regenerate the slug when the title changes before the case study's first successful publication. Freeze it on first publication. Later title edits retain the URL. The MVP has no slug editor or redirect management.

Deleting a case study from the draft does not change the published site. After the deletion is published, its old URL returns `404` and the slug becomes available to another project in that portfolio. If a new project reuses it, old links point to the new project.

### 8.4 Visitor request (the `site` Worker)

1. Parse the host; accept only a single label before `hasaweb.site`; reserved or unknown hosts get a generic platform page.
2. One D1 query by subdomain: `status`, `published_version`, `id`. Anything other than `published` returns the generic "unavailable" page (covers unpublished, suspended, deleted).
3. Map the path to an R2 key under `sites/{id}/v{n}/` and stream it, honoring `If-None-Match` and `HEAD`.
4. Special paths: `/resume.pdf` (served same-origin with `Content-Disposition` so the download button works), `/_/github.json`, `/_/contact`.
5. Responses carry strict security headers and `Cache-Control: public, max-age=0, must-revalidate`. HTML for a given version is immutable, so a Cache API layer keyed by host, path, and version is a straightforward later optimization.

Each request is served wholly from one version. Navigating between pages during a publish can cross versions, but no single response is ever a mixture.

### 8.5 GitHub activity (product 9)

**Why not in the snapshot:** private counts must vanish on revoke without a republish, and refreshes must not require republishing. The snapshot therefore contains only the username, link, and placeholder markup; a small script loads `/_/github.json` and draws the graph.

- **Endpoint:** `site` reads `github_activity` and returns public days, plus anonymized private counts only if `private_enabled` is true at that moment. `s-maxage` is about five minutes, with an explicit cache purge on revoke or disconnect.
- **Refresh-on-visit:** if `fetched_at` is older than the confirmed six-hour TTL and no refresh was recently requested, `site` records `refresh_requested_at` and enqueues one refresh message with `ctx.waitUntil`. The visitor is served the last good data immediately.
- **Daily scheduled sweep:** a cron handler enqueues one message per `private_enabled` connection. The consumer validates the token, refreshes, and on `401` marks `needs_reconnect` and strips private counts. This is how revocation made directly on GitHub is detected.
- **Failure:** the last successful graph and its date stay published; the editor shows the failure with Retry or Reconnect. A fetch failure never blocks the rest of the page.
- **Auth:** public data uses a platform-held GitHub token (GraphQL requires authentication). Private activity requires a separate, explicit `read:user` authorization stored in `github_connection`, valid only when the authorized account matches the selected username. Sign-in requests identity and email scope only. Disconnect revokes the grant with GitHub, deletes the token, and purges private data. Exact scopes and visibility behavior are verified against test accounts **[spike]**, per AC 9.10.

### 8.6 Contact form (product 10)

1. Visitor submits to `/_/contact` on the same origin, with a Turnstile token.
2. `site` validates fields, verifies Turnstile, applies fixed-window limits from `counter` (per site and per hashed IP), and checks the site's recipient is verified.
3. In one atomic D1 operation, reserve the site's and global contact email allowances and insert a `contact_outbox` row. Enqueue delivery, then return `202` "accepted". Reject blocked, rate-limited, or exhausted-budget submissions explicitly before acceptance. Retries retain the original reservation.
4. The consumer sends through `EmailProvider` with an idempotency key and the visitor as Reply-To, then marks `sent` and deletes the payload.
5. Attempt delivery immediately, then at 5 minutes, 30 minutes, 4 hours, and 24 hours after acceptance. Retry transient failures. Honor a provider's longer retry delay only within the 24-hour deadline. Permanent errors fail immediately. If delivery remains unsuccessful at the deadline, mark the row `failed`, delete the visitor payload, and notify the owner. Retain delivery status and diagnostic metadata without message content. The sweeper re-drives stuck work without resetting the deadline or exceeding five attempts.
6. Send test message uses the same path with `is_test`. Limit tests to two per site per UTC day and count them against the site's and global contact allowances. Preview-mode forms never make a network call.

Limits are five submissions per visitor/IP per site per hour and ten accepted messages per site per UTC calendar day. The global contact allowance is 90 emails per UTC day. Reserve the remaining ten of the 100 daily emails for recipient verification and owner notices. Defer those emails when their allowance is exhausted. Show delivery failures in the editor even when the owner notice is deferred.

### 8.7 Unpublish and delete (product 18)

- **Unpublish:** set `status = unpublished` (the `site` Worker stops serving immediately because it checks D1 on every request), delete public objects, purge cache URLs. The draft and subdomain are retained.
- **Delete account:** after explicit confirmation, atomically mark the account as deleting, set its portfolio to `deleting`, invalidate sessions, and convert its published subdomain claim to a permanent ownerless reservation. Authenticated routes must deny access to a deleting account, including through cached sessions. Public endpoints must also reject it immediately. A Workflow revokes connected-account access, deletes all R2 prefixes for the portfolio, purges manifest URLs from the CDN, and deletes account-related D1 rows, including operator email audit records. Retry failed cleanup steps until they complete. The only surviving account reservation contains the published subdomain name, with no email, user ID, or portfolio content. An account that never claimed a subdomain leaves no reservation.
- **Suspend (abuse kill-switch):** `suspended_at` set by an operator script (`pnpm ops suspend <subdomain> --reason ...`) that updates D1 and purges the cache; `site` serves the generic unavailable page. No admin UI in the MVP.

---

## 9. Component system and rendering

### 9.1 Component registry (supports "new components over time")

Each component type is a folder in `packages/components` exporting one object, and the registry is the only place the system learns that it exists:

```ts
defineComponent({
  type: 'projects',
  version: 1,
  singleton: true,                  // text sections set this to false
  schema,                           // Zod schema for its data
  defaults, sample,                 // default and example content
  picker: { title, description, requirements },  // shown in the component picker
  Editor,                           // client-only React form (shadcn)
  Render,                           // markup-only React component, no hooks or effects
  publishChecks(data, ctx),         // returns validation issues with field paths
  liveData?,                        // declares a live data endpoint (e.g. github)
});
```

The picker, editor panel, validation checklist, renderer, and migrations all iterate the registry. Adding a component is one folder plus one registry line.

MVP registry: profile (fixed), projects, skills, work experience, text sections (multiple), GitHub activity, contact form, social links, resume download.

### 9.2 Rendering model

- **One renderer, two hosts.** `Render` components are markup-only React. They run (a) in the editor preview in the browser and (b) in the publish Workflow via `react-dom/server`.
- **Zero React on published pages.** Interactivity comes from a single small vanilla script (`site.js`, content-hashed): theme toggle, Face Reveal, GitHub graph draw, contact form, resume embed fallback. The same script runs in the preview, so behavior matches.
- **Preview is client-rendered.** The live preview and the full-page preview render the draft in the browser (no server rendering, so no CPU risk on free). Desktop and mobile preview modes use an **iframe** of the renderer at 390 px or full width, so CSS media queries respond correctly. The draft reaches the iframe through `postMessage`. Full-page preview routes (`/preview/...`) are authenticated, `noindex`, and `no-store`.
- **Renderer versioning.** Each snapshot records `renderer_version`. Platform CSS/JS are content-hashed and retained, so old snapshots keep working after a deploy. A `rerender-all` Workflow re-renders every live site (for security fixes or new markup) and uses the same pointer flip.

### 9.3 Appearance system

- `packages/theme` exports a pure `generatePalette(seedColor | preset)` that returns light and dark token sets (page background, surfaces, text, borders, links, buttons, interactive states) and a list of automatic adjustments for the editor to explain.
- Theme names, curated font choices, and decoration artwork are a separate design task. Approve the catalog before appearance testing and launch. It must contain exactly three themes and preserve the agreed single-template behavior.
- Palette math uses OKLCH. Lightness is adjusted until each text/background pair meets the confirmed WCAG 2.2 AA contrast standard, 4.5:1 for normal text and 3:1 for large text and control indicators. Unit tests assert this for every preset and for a sweep of seed colors.
- Tokens are emitted as CSS custom properties. Tailwind v4 maps its theme to those variables, so the same utilities style the editor preview and published pages.
- Fonts are self-hosted variable fonts from `hasaweb-assets`, with real fallback stacks. No third-party font requests.
- Initial mode (`light`/`dark`/`system`) is baked into the page; the visitor toggle is stored in `localStorage` (no cookies, no tracking). A single static inline script prevents theme flash and is allowed in the CSP by hash.

### 9.4 Face Reveal and avatar decoration

Markup: an interactive `<button>` containing both images and the decoration overlay. The reveal is a CSS `clip-path` diagonal wipe (top-left to bottom-right); `prefers-reduced-motion` switches instantly; the accessible name toggles between "Reveal face" and "Show avatar"; Enter and Space work natively on a `<button>`. When the add-on is off, plain markup with no button, cue, or second image is rendered.

---

## 10. Security and privacy

| Area | Measure |
| --- | --- |
| **Owner content** | No raw HTML, scripts, or CSS accepted. Rich text is stored as Tiptap JSON, validated against an **allowlist schema** (paragraph, headings, lists, links, images in case studies), and rendered by our own serializer, never via `dangerouslySetInnerHTML`. Link schemes are allowlisted (`https`, `http`, `mailto`). External links get `rel="noopener noreferrer"`. |
| **Published page CSP** | `default-src 'none'`; scripts only from our hashed `site.js` and Turnstile; images from `assets.hasaweb.site`; `frame-ancestors` restricted; `object-src` limited to same-origin PDF embedding on `/resume`. Styles allow inline (owner colors are generated by us, not supplied as CSS). Also `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. |
| **Cookies and origins** | Auth cookies are host-only (no `Domain` attribute) and set only by the apex app; where Better Auth permits, use the `__Host-` prefix **[spike]**. Portfolio pages run no owner scripts and receive no auth cookies. Submit `hasaweb.site` to the Public Suffix List after launch. Launch does not depend on acceptance of the submission. |
| **CSRF** | Better Auth origin checks, `SameSite=Lax`, and strict `Origin` verification plus JSON content type on every mutating route handler. |
| **Authorization** | Every repository function takes the session user and scopes by `user_id`. Draft previews and assets return `404` to anyone else (AC 16.5). |
| **Account linking** | Auto-link only on a provider-verified email; never on missing or unverified email; linking a new provider requires proof of ownership (AC 2.2). Behavior verified against Better Auth configuration **[spike]**. |
| **Secrets** | Wrangler secrets: `BETTER_AUTH_SECRET`, OAuth client IDs/secrets, `ENCRYPTION_KEY`, `RESEND_API_KEY`, `TURNSTILE_SECRET`, `GITHUB_SERVICE_TOKEN`, a zone-scoped cache-purge API token. Never in the repo. |
| **GitHub tokens** | Encrypted at rest (AES-GCM); deleted and grant revoked on disconnect or account deletion. |
| **Contact data** | Visitor payload stored only until delivered or finally failed, then deleted. The recipient address is never present in any public response or HTML. |
| **Uploads** | Magic-byte checks, size caps, canvas re-encode of images, served from a separate public host with `nosniff`. |
| **Abuse** | Operator suspend flag, `abuse@hasaweb.site` via Cloudflare Email Routing (inbound, free) forwarding to the operator, Turnstile and rate limits on the only public write endpoint. |
| **Privacy posture** | No visitor accounts, no analytics, no cookies on published pages (matches product 16). |

---

## 11. Reliability, observability, and operations

- **Source of truth for async work is D1.** Queues and Workflows are triggers. A daily sweeper re-drives anything stuck, so Queue retention and transient failures cannot lose a message.
- **Bounded work per invocation.** Every cron tick and queue handler processes a limited batch and enqueues a continuation, to respect 10 ms CPU and 50 subrequests on free.
- **Failure modes by design:** failed publish keeps the previous version; failed GitHub refresh keeps the last graph; failed email retries with backoff then notifies the owner; D1 unavailable returns `503` with `Retry-After` from `site`.
- **Daily-limit behavior.** Set the `site` route to fail closed with a clear error rather than bypass to a nonexistent origin; set `web` to fail closed as well. Alerts fire before the cap is hit (see section 14).
- **Observability.** Workers Logs with structured JSON and a request ID; operational counters (publish duration and failures, email budget, queue depth, `exceededCpu` outcomes). No visitor analytics.
- **Backups.** D1 Time Travel (7 days on free) plus an optional weekly `wrangler d1 export` to a private R2 object.
- **Operator tooling** (scripts, not UI): suspend and unsuspend a site, re-render one or all sites, inspect outbox, purge cache for a site, and retrieve an account email for abuse follow-up. Email retrieval requires an authenticated operator and an abuse case reference. Record the operator, timestamp, case reference, and account ID for each lookup. Exclude the retrieved email from audit records and routine logs. Retain audit records for 90 days, deleting account-linked records during account deletion.

---

## 12. Repository, tooling, CI/CD, and environments

### 12.1 Layout

```
hasawebsite/
  apps/
    web/          Next.js + OpenNext     -> Worker "hasaweb-web"
    site/         thin serve Worker      -> Worker "hasaweb-site"
    jobs/         Workflows, Queues, Cron -> Worker "hasaweb-jobs"
  packages/
    schema/       Zod draft schema, versioned migrations, validateDraft()
    db/           Drizzle schema, migrations, repositories
    components/   registry + Render components + site.js behaviors + CSS
    theme/        palette generator, presets, curated fonts
    render/       renderPage(), metadata/SEO, sitemap/robots
    email/        EmailProvider interface, Resend adapter, templates
    github/       GraphQL client, contribution mapping
    config/       tsconfig, Biome config
  docs/           product.md, acceptance-criteria.md, architecture.md
```

### 12.2 Local development

`opennextjs-cloudflare preview` and `wrangler dev` with local D1, R2, Queues, and Workflow simulators persisted on disk. Separate **dev** GitHub and Google OAuth apps with localhost callbacks. A console `EmailProvider` prints emails locally. A seed script creates a user, a draft, and the example portfolio.

### 12.3 CI/CD (GitHub Actions)

- **Pull request:** typecheck, Biome, unit and integration tests, `next build` and OpenNext build, Playwright smoke and axe checks against the preview.
- **Main to production** (manual approval via a GitHub Environment): apply D1 migrations (always backward compatible with the previous deploy), then deploy `jobs`, then `site`, then `web`. Report the Wrangler `startup_time_ms` and fail the build if a Worker approaches the 1 s startup limit.
- **No staging:** mitigate with gradual deployments and instant rollback where Wrangler supports them, feature flags in D1 for risky changes, D1 Time Travel, and the `rerender-all` job for renderer rollouts.

---

## 13. Testing strategy (mapped to acceptance-criteria.md)

| Layer | Tooling | Covers |
| --- | --- | --- |
| **Unit** | Vitest | Palette generation and contrast (AC 12.3-12.5), `validateDraft` (AC 2.5, 4.1-4.3, 15.4-15.6), subdomain rules (AC 15.1), rich-text allowlist and XSS payloads (AC 8.3), link validation, date validation (AC 7.3), renderer snapshot tests |
| **Worker integration** | `@cloudflare/vitest-pool-workers` with local D1/R2/Queues/Workflows | `site` routing and states (AC 16.5-16.6, 17.4-17.5), publish atomicity and injected failures (AC 15.7-15.8), **concurrent subdomain claim race** (AC 15.2), autosave CAS and conflicts (AC 14.4), outbox retries and exhaustion notification (AC 10.5-10.6), GitHub refresh, failure, and revoke (AC 9.4, 9.8-9.9), draft-asset access control (AC 13.7), Face Reveal asset publication and removal (AC 4.14) |
| **End-to-end** | Playwright, axe-core, three viewport sizes | Full journeys (cross-feature AC 2), editor on desktop and mobile (AC 3.6), keyboard and focus (AC 16.4), reduced motion and Face Reveal (AC 4.11-4.12), theme switching (AC 12.6), upload limits and failures (AC 13) |
| **Manual / usability** | Timed session with target users | The 15-minute publish target and the qualitative outcomes (cross-feature AC 1, 5) |

Worker integration checks also cover permanent subdomain reservations after account deletion, immediate denial of cached sessions during deletion, retryable cleanup, case study slug collisions and reuse after a published deletion, atomic contact budget reservations, and operator email audit retention.

The following verification settings are **[confirmed]**. They resolve the corresponding prerequisites left open in `acceptance-criteria.md`.

| Prerequisite | Confirmed setting |
| --- | --- |
| Upload byte limits | 5 MiB = 5,242,880 bytes; 10 MiB = 10,485,760 bytes (test at the limit and limit + 1) |
| Contrast standard | WCAG 2.2 AA (4.5:1 normal, 3:1 large text and control indicators), verified in unit tests and with axe |
| Browsers | Last two stable versions of Chrome, Firefox, Safari, and Edge; iOS Safari and Android Chrome |
| Viewports | 360, 768, 1280 px widths |
| GitHub refresh | On-visit TTL 6 hours; private-activity sweep daily; revocation detected on next refresh or sweep |
| Contact limits | Five per visitor/IP per site per hour; ten accepted messages per site per UTC day; 90 global contact emails per UTC day, with ten reserved for verification and owner notices. Reserve allowances before acceptance. Tests count toward contact budgets and are limited to two per site per day. |
| Delivery retries | Immediately, then 5 minutes, 30 minutes, 4 hours, and 24 hours after acceptance. At most five attempts. Respect longer provider retry delays within the deadline. Fail permanent errors immediately. Final failure deletes the visitor payload and notifies the owner. |
| Verification method | Automated browser and viewport tests, plus provider fixtures. Real-device and assistive technology checks are excluded from the MVP verification scope. |
| Provider fixtures | Verified, missing, and unverified emails; account linking; GitHub public and private activity; revoked authorization; email rejection, timeout, and retry. |

---

## 14. Capacity model at ~100 portfolios, and the upgrade path

### 14.1 Estimated daily usage

Assumptions: 100 portfolios; 30 owner editing sessions per day averaging ~250 API calls and ~100 autosaves each; 30 publishes per day; 50 visitor page views per portfolio per day; half the portfolios have a GitHub component. **These are planning estimates, not measurements.**

| Resource | Estimated use | Free limit | Headroom |
| --- | --- | --- | --- |
| Worker requests (all Workers) | ~20,000/day | 100,000/day | ~5x |
| D1 rows written | ~5,000/day | 100,000/day | ~20x |
| D1 rows read | ~50,000/day | 5,000,000/day | ~100x |
| R2 Class A | ~15,000/month | 1,000,000/month | ~60x |
| R2 Class B | ~200,000/month | 10,000,000/month | ~50x |
| R2 storage | ~1-2 GB | 10 GB | ~5x |
| Queue operations | ~1,000/day | 10,000/day | ~10x |
| Emails (Resend) | <20/day typical | 100/day, 3,000/month | ~5x |

Static asset requests (the Next.js bundle) are assumed not to count against the Worker request limit **[spike]**.

### 14.2 What will break first

1. **Worker requests**, from a single viral portfolio (roughly 40,000 page views/day would exhaust the daily cap, since each view may cost two requests).
2. **Resend's 100 emails/day**, from a burst of contact messages or verification emails.
3. **10 ms CPU**, in the publish render step or an auth/API route.

### 14.3 Alert thresholds

Alert (log plus operator email) at 60% of daily Worker requests, any `exceededCpu` outcome, 80 emails/day, 50% of daily D1 writes, and any failed publish.

### 14.4 One-step upgrade to Workers Paid ($5/month)

| Change | Effect |
| --- | --- |
| Subscribe to Workers Paid | Removes the daily request cap; raises CPU limit (default 30 s); raises subrequests and Cron Trigger limits; larger Queue and D1 allowances |
| Optionally set `limits.cpu_ms` | Headroom for render and API routes |
| Optionally swap `EmailProvider` | Cloudflare Email Service (3,000 emails/month included, then metered) replaces Resend; no daily cap |
| Optionally relax design workarounds | Render all pages in one Workflow step; shorten GitHub TTL; add a Cache API layer or KV pointer cache |

No schema change, no data migration, and no application rewrite are required, which is the point of the adapters and bounded-work design above.

---

## 15. Risks and spikes

Do these first, in this order, because each can change a decision above.

| # | Risk or assumption | Spike | Fallback |
| --- | --- | --- | --- |
| S-1 | Publish render steps fit in **10 ms CPU** on free | Benchmark `react-dom/server` for a worst-case portfolio and each page in workerd, measuring CPU per step | Local S-1 rejects whole-page steps; [results and revised bounded approach](../specs/2026-10-15-publish-render/results.md) recorded October 15, 2026. Incremental preparation/render/assembly still needs S-8 verification |
| S-2 | Next.js on the free plan: startup under 1 s, and auth/API route CPU p95 under 10 ms | Deploy a skeleton with Better Auth session check and a D1 write; measure `startup_time_ms` and CPU in logs | Move hot endpoints (draft save, publish trigger) into `jobs`/Hono; upgrade to Paid |
| S-3 | Wildcard Worker route coexists with the R2 custom domain and the apex | Create the zone, routes, and an explicit no-Worker route for `assets.hasaweb.site` | Serve assets through `site` (costs more Worker requests) |
| S-4 | Static asset requests do not count toward the Workers request limit | Observe analytics after loading the app repeatedly | Rely on caching; plan for Paid sooner |
| S-5 | Better Auth on workerd/D1: per-request init, cookie cache, `__Host-` cookies, account-linking behavior vs AC 2.2 | Build the sign-in flow with both providers and linking test cases | Custom Arctic-based auth (already evaluated as the alternative) |
| S-6 | GitHub scopes and private-contribution semantics, token revocation detection | Test with public-only and authorized private-activity accounts (AC 9.10) | Public-only graph in MVP, private as fast follow |
| S-7 | Resend: domain verification (SPF/DKIM) and the 100/day cap against all email types | Verify domain; send each email type; confirm budget guard | Upgrade to Paid and use Cloudflare Email Service |
| S-8 | Workflows on free: step CPU, step count, concurrency | Run a publish with N pages concurrently | Replace with a Queue plus D1 state machine |
| S-9 | CDN purge-by-URL removes withdrawn assets promptly (AC 4.14) | Publish, withdraw, purge, fetch from several locations | Short TTL on sensitive asset classes |
| S-10 | `.site` availability on Cloudflare Registrar | Search at purchase time | Register elsewhere and point nameservers to Cloudflare (a full zone is required either way) |

---

## 16. Confirmed answers and design follow-up

The architecture interview resolved Q-1 through Q-6. The owner confirmed these decisions on October 13, 2026.

| ID | Topic | Confirmed decision |
| --- | --- | --- |
| Q-1 | Subdomain after account deletion | Reserve every previously claimed subdomain permanently. Retain only its name after cleanup. Block public and owner access immediately and retry cleanup until complete. See section 8.7. |
| Q-2 | Case study URLs | Use `/projects/{slug}` with the generation rules in section 8.3.1. Freeze each slug on first publication. A published deletion frees it for reuse within the portfolio. |
| Q-3 | Themes, fonts, and decorations | Choose names, fonts, and artwork in a later design task. Approve the catalog before appearance testing and launch. |
| Q-4 | Operator account email access | Allow access through an authenticated operator script for abuse follow-up. Require a case reference and record each lookup without the email. Retain audits for 90 days or until account deletion. See section 11. |
| Q-5 | Public Suffix List | Submit `hasaweb.site` after launch. Submission acceptance is not a launch prerequisite. |
| Q-6 | Verification settings | Use the confirmed settings in section 13, including automated browser and viewport tests and provider fixtures. Exclude real-device and assistive technology checks. |

There are no unanswered architecture interview questions. The visual catalog remains a design task. The technical spikes in section 15 still require verification.

---

## 17. Decision log

| ID | Decision | Alternatives considered | Why |
| --- | --- | --- | --- |
| ADR-1 | Next.js via OpenNext on Workers (D-4) | Cloudflare's `vinext` (Wrangler's current auto-configuration target), Astro, React Router | Your preference; OpenNext supports Next.js 16. Revisit if the adapter lags. |
| ADR-2 | Pre-render at publish, thin serve Worker (D-5) | Per-request SSR; client-side render from JSON | 10 ms CPU makes SSR risky; pre-render gives real SEO and social metadata (AC 17.2) and makes atomic publish a pointer flip. |
| ADR-3 | D1 for publish pointer and live state; KV unused | KV pointer | KV allows only 1,000 writes/day on free. |
| ADR-4 | Draft as a single JSON document with CAS | Normalized tables per component | Atomic save and publish snapshot, one row write per autosave, trivial conflict detection. |
| ADR-5 | Workflows for publish; Queues for contact and GitHub | Queues only | Durable, retried, observable steps with their own CPU budgets; keeps Queue operations for the jobs that need them. |
| ADR-6 | Three R2 buckets (draft private, sites private, assets public) | One bucket with prefixes | Hard isolation of drafts (AC 13.7); public bucket needs no Worker, saving requests. |
| ADR-7 | Markup-only components plus one vanilla `site.js` | Hydrate React on published pages | Zero React on visitor devices; faster pages; same behavior in preview. |
| ADR-8 | Transactional outbox for contact delivery | Send inline from the request | Honest "accepted" semantics, retries, and survival of Queue retention limits. |
| ADR-9 | Live GitHub data outside snapshots; hybrid refresh (D-8) | Bake into HTML; refresh all on a schedule | Meets revoke-without-publish (AC 9.9); scheduled refresh for all would exhaust Queue and cron limits. |
| ADR-10 | App on the apex with host-only cookies; no owner scripts on portfolio pages | Separate app domain | Fewer domains; risk contained because portfolio pages execute only our code. |
| ADR-11 | `EmailProvider` adapter with Resend now (D-6) | Cloudflare Email Service now | Cloudflare sending requires Workers Paid; the adapter keeps the swap trivial. |
| ADR-12 | Client-side image crop and re-encode | Cloudflare Images transformations; server-side processing | No CPU or quota cost; strips EXIF; matches "saved crop equals published crop". |
| ADR-13 | Better Auth with Drizzle (D-7) | Auth.js, custom Arctic | Your preference; first-class account linking rules; D1 support. |
| ADR-14 | Local + production only (D-11) | Add staging | One wildcard TLS level on free; staging would need another domain. |

---

## 18. Sources

Verified October 12-13, 2026:

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare developer platform pricing and free tiers: https://www.cloudflare.com/plans
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Email Service pricing: https://developers.cloudflare.com/email-service/platform/pricing/
- OpenNext on Cloudflare Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/
- Cloudflare Registrar TLD support: https://developers.cloudflare.com/registrar/top-level-domains/
- Resend pricing: https://resend.com/pricing
