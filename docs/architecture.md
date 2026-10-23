# hasawebsite: Architecture

| | |
| --- | --- |
| **Status** | Foundation implemented through Phase 13; target flows beyond that remain planned |
| **Date** | Reviewed October 18, 2026; initial-setup agreement October 16; original architecture decisions October 13 |
| **Inputs** | [product.md](product.md), [acceptance-criteria.md](acceptance-criteria.md), [rough-idea.md](rough-idea.md), architecture interview, [confirmed onboarding interview](onboarding.md) |
| **Cloudflare limits verified** | October 12-13, 2026 against official documentation (see [Sources](#18-sources)). Limits change; re-verify before launch. |

---

## 1. Purpose and scope

This document defines the technical architecture for the hasawebsite MVP: the technologies used, how the system is split across Cloudflare services, how data flows, and how the design stays inside Cloudflare's free tier while keeping a one-step upgrade path to Workers Paid ($5/month).

It covers the MVP as scoped in `product.md`. It does not redesign features, add capabilities, or approve visual design details by implication. The [appearance catalog](appearance-catalog.md) records the approved six-theme/two-decoration catalog and font/default choices. Section 16 records the confirmed decisions and catalog approval.

The October 16 onboarding specification adds required first-user setup and optional content collection. Contracts, private setup storage, provisioning and draft APIs are now implemented through Phase 13. Phase 22A implements controlled entry and authoritative handoff services. The visible account entry remains a welcome shell; the guide, production editor and public publication remain pending. See the [current implementation and decision changes](implementation-status.md) before using the target flows below. Historical spikes do not override later production protocols.

**Conventions.** Items marked **[confirmed]** were decided by you in the interview. Items marked **[default]** are architect defaults you did not discuss and may override. Items marked **[spike]** rest on an assumption that must be verified early (see [section 15](#15-risks-and-spikes)).

---

## 2. Decisions captured in the interview

| # | Topic | Decision | Status |
| --- | --- | --- | --- |
| D-1 | Budget | Free tier for launch; design so upgrading to Workers Paid ($5/month) is a configuration change, not a rewrite | confirmed |
| D-2 | Target scale | Up to ~100 portfolios (beta/launch) | confirmed |
| D-3 | Domain | `hasaweb.site`, owner confirmed registration October 15, 2026; Cloudflare full-zone activation/routing verification is in S-3 | confirmed |
| D-4 | Framework | Next.js (App Router) on Workers via the OpenNext Cloudflare adapter | confirmed |
| D-5 | Public serving | Pre-render each portfolio at publish time into R2; a thin Worker serves the snapshots | confirmed |
| D-6 | Email delivery | Resend free tier, behind an `EmailProvider` adapter so Cloudflare Email Service can replace it later | confirmed |
| D-7 | Authentication | Better Auth with Drizzle on D1; GitHub and Google | confirmed |
| D-8 | GitHub refresh | Hybrid: daily scheduled refresh for sites with private activity enabled; refresh-on-visit for everyone else | confirmed |
| D-9 | UI stack | Tailwind CSS + shadcn/ui + dnd-kit | confirmed |
| D-10 | Rich text | Tiptap (ProseMirror) | confirmed |
| D-11 | Environments | Local development + production only | confirmed |
| D-12 | Abuse handling | Operator kill-switch to suspend a site, plus a report-abuse email address | confirmed |
| D-13 | First portfolio setup | Required Address, combined Profile, and Links before first editor entry; optional Skills, Projects, GitHub public/private setup; Review then editor | confirmed October 16 |
| D-14 | Setup data and exit | One canonical private draft, separate private progress and permanent editor-entry milestone; retain partial optional content and normal publication validation | confirmed October 16 |
| D-15 | Address and crops | Reserve a valid available address on the confirmed Address save; convert the reservation to the permanent claim on first Publish; retain only finished cropped images | confirmed October 21, 2026, superseding October 16 |
| D-16 | Appearance catalog scope | Add Matcha, Strawberry and Coffee to Leaf/Violet/Clay and replace static decorations with the original Ginger cat/Hands pair. Preserve one template and the approved defaults | approved October 17, including the playback policy and generator exception |

---

## 3. Architectural drivers

These requirements from `product.md` and `acceptance-criteria.md` shape the design more than any other.

| ID | Driver | Source | Consequence |
| --- | --- | --- | --- |
| A-1 | Publishing is **atomic**: visitors never see a mix of old and new content; a failed publish leaves the previous version intact | product 15, AC 15.7-15.8 | Immutable, versioned snapshots plus a single pointer flip in D1 |
| A-2 | Drafts and draft assets are **private**; published content changes only on Publish | product 13-14, AC 13.7, 14.6 | Separate draft and public storage; authenticated draft access only |
| A-3 | **Live data** changes without Publish: GitHub activity (including private-count removal on revoke) and contact delivery | product 9-10, AC 9.4, 9.9 | Live data is never baked into HTML snapshots; it is served from separate endpoints |
| A-4 | Address reservation and claim are **atomic** under concurrent selection and publishes | AC 15.2 | One unique namespace record in D1 with `held`/`claimed` states: the reservation is created on the confirmed Address save and converted to the claim in the same transaction as the pointer flip |
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
| **D1** | 5 GB total, **500 MB per database**, 10 databases; 5M rows read/day; **100K rows written/day**; 50 queries per invocation; Time Travel 7 days | Single database. Ordinary patches write one canonical row; staging, pieces, indexes and cleanup add writes. Use measured handler/capacity budgets. Avoid indexes on frequently updated columns. |
| **R2** | 10 GB-month; 1M Class A ops/month; 10M Class B ops/month; zero egress | Three buckets (draft, sites, public assets). Serve public assets from an R2 custom domain so image traffic does not consume Worker requests. |
| **KV** | 1 GB; 100K reads/day; **1,000 writes/day** | **Not used** for publish state or caching. |
| **Queues** | 10,000 operations/day (a message typically costs about three operations) | Budget contact/GitHub jobs together with the required publication fallback. Publication batching remains unvalidated. D1 holds durable task/outbox state. |
| **Workflows** | 100K requests/day shared with Workers; 10 ms CPU per invocation on pricing page; 3,000 steps/day; 1,024 steps/instance; 100 concurrent instances | S-8 rejects the unbatched fragment pipeline at the planned daily volume. See the required revision below. |
| **Workers Logs** | 200K events/day | Structured, sparse logging. |
| **Cloudflare Email Service** | Sending to arbitrary recipients **requires Workers Paid**; free plan can only send to verified addresses in your own account | Cannot be used for owner or visitor email on the free plan, hence Resend. |
| **Resend (free)** | 3,000 emails/month, **100/day**, 3 verified domains | Global and per-site daily email budget guard. |
| **Turnstile, Email Routing (inbound), Universal SSL, DNS** | Free | Spam protection, `abuse@` inbox, TLS for apex and first-level wildcard. |

Only unavoidable cost at launch: **domain registration** for `hasaweb.site`.

---

## 5. System overview

### 5.1 Topology

This diagram shows the target responsibilities. Owner APIs already use the named jobs binding before OpenNext. Publication dispatch requires the Queue/D1 validation in section 8.3; no production publish dispatcher exists yet.

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
     D1        R2       D1 (outbox,          D1    R2     R2      jobs API /
  (pointer)  (sites)   github, counters)           draft  sites   dispatch
                                                    |       ^        |
   assets.hasaweb.site                              |       |        v
        |                                +----------+-------+--------+---------+
        v                                | Worker: jobs                        |
   R2 public bucket                      | OwnerApi, bounded publication jobs  |
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
| **`web`** | Next.js app and authentication. Private upload and asset-read handlers run before OpenNext, using web's private draft bucket. `/api/owner/*` forwards through the Worker adapter to jobs, including explicit address confirmation. Target UI adds onboarding, editor, private previews and settings; publication remains pending. Never serves user portfolios. | No hot full-draft validation in OpenNext. No ISR or data cache. Setup gates remain planned; current owner APIs enforce session/deletion checks. |
| **`site`** | Currently health/local probes and an unavailable response. Target serving resolves `*.hasaweb.site` to a live version, streams HTML/PDF from R2 and exposes `/_/github.json` and `/_/contact`. | Target is near-zero CPU, with no rendering or framework. |
| **`jobs`** | Named Hono `OwnerApi` already handles provisioning and draft/progress/recovery actions. Target background work includes publication, lifecycle cleanup, rerender, contact/GitHub consumers and sweeps. Default HTTP entry exposes no owner routes. | Bound and measure actual invocations. Workflows are not the approved publication dispatcher; Queue/D1 batching remains to validate. |

Splitting these keeps the public path tiny, keeps Next.js CPU off visitor traffic, and means each Worker can scale or be upgraded independently. Cross-Worker calls use service bindings and Workflow bindings.

S-2 measured October 15, 2026 rejects the assumed OpenNext hot-API CPU budget. Keep the web shell and provider authentication in `web`, but route hot owner APIs through an internal service binding to a thin Hono entry in `jobs`. Cache auth configuration per isolate without retaining request identities, and retain real Better Auth session/deletion checks. See [S-2 evidence](../specs/2026-10-15-app-runtime/results.md). Phase 11A's October 16 [full-body experiment](../specs/2026-10-16-owner-api-runtime/results.md) fails at 1 MiB and includes an `exceededCpu` outcome. The owner requested implementation/testing of the bounded follow-up and approved explicit URL/email limits. Use the [tested incremental repository and protocol](../specs/2026-10-16-free-owner-saves/protocol.md), with [CPU evidence and limitations](../specs/2026-10-16-free-owner-saves/results.md) and its separate quota model. Phase 11B adds tracked staging tables and private setup storage, with revision-aware progress and a permanent entry milestone. Phase 13 adds the [production draft/progress APIs and bounded staged legacy validation](../specs/2026-10-17-revision-aware-drafts/protocol.md), with persisted setup/content contexts and post-handoff recovery. Phase 14 supplies the shared browser autosave/recovery controller; Phase 15 adds selected-change review and the fixed same-tab authentication recovery callback. Editor/onboarding adapters remain in their phases. The full-body route remains unsupported for Free saves. Warm p95 evidence cannot guarantee every cold invocation or establish publication/Queue feasibility.

### 5.3 Domains and routing

| Hostname | Target | Notes |
| --- | --- | --- |
| `hasaweb.site`, `www.hasaweb.site` | `web` | Apex is the app; `www` redirects to the apex. |
| `assets.hasaweb.site` | R2 public bucket (custom domain) | No Worker in the path. The more-specific no-script route excludes it from the wildcard. Deployed S-3 verifies hits and missing keys; see the routing evidence. |
| `*.hasaweb.site` (single level) | `site` | Wildcard Worker route plus a proxied wildcard DNS record. Universal SSL covers apex plus one wildcard level. |
| `mail.hasaweb.site` (or apex) | Resend sending domain | SPF/DKIM records on Cloudflare DNS. |

Platform-reserved names (cannot be selected or claimed): `www`, `app`, `api`, `assets`, `mail`, `admin`, `status`, `docs`, `blog`, `help`, `support`, `static`, `cdn`, `example`, `demo`, plus a deny-list of well-known brand names to limit impersonation. Maintained as a code constant plus a D1 table so it can grow without a deploy. A held address is not a published site; wildcard serving resolves only published claims.

The marketing page's **example portfolio** is a real published site (for example `example.hasaweb.site`) owned by an internal account, so it always reflects the real renderer.

### 5.4 Two environments

Local development and production only **[confirmed]**. Because free Universal SSL covers a single wildcard level, a staging environment with wildcard portfolio subdomains would need a second domain. If staging becomes necessary later, the cheapest route is a second inexpensive domain with its own Cloudflare zone.

---

## 6. Technology inventory

This is the target stack, not a list of installed capabilities. **[confirmed]** unless marked **[default]**. Keep the exact pinned versions in the manifests/lockfile; dependency updates need their own compatibility checks. Phase 01 pinned Next.js 16.3.8 after 16.4.0 failed the OpenNext workerd smoke test. Later editor libraries and product integrations remain in their roadmap phases.

| Layer | Technology | Purpose |
| --- | --- | --- |
| Language | TypeScript (strict), Node.js LTS for tooling | One language across all Workers and packages |
| Package manager / monorepo | pnpm workspaces **[default]** with Turborepo | Three apps, shared packages |
| App framework | Next.js 16, App Router, React 19 | Editor, auth, API, marketing |
| Cloudflare adapter | `@opennextjs/cloudflare`, Wrangler | Run Next.js on Workers; deploy all Workers |
| UI | Tailwind CSS v4, shadcn/ui (Radix primitives) | Editor UI and portfolio styling |
| Animation | GSAP for other effects; native CSS keyframes and animated WebP for imported avatar decorations | Preserve the cat/hands source choreography and reduced-motion states; Phase 38 adds independent playback controls |
| Drag and drop | dnd-kit (pointer + keyboard sensors) | Component and entry reordering, with Move up/down fallback buttons |
| Rich text | Tiptap (ProseMirror), client-side only | Text sections and case studies |
| Image cropping | `react-easy-crop` + Canvas re-encode **[default]** | Avatar, banner, project, and case-study images |
| Editor state | Zustand **[default]** | Draft state, save status, preview sync |
| Data fetching | Explicit fetch for the implemented draft protocol; TanStack Query remains a default for later unrelated APIs | The draft controller owns sequencing, reconciliation and save status; no generic mutation retry queue |
| Validation | Zod | Draft schema, API payloads, per-component schemas |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM + drizzle-kit migrations | Relational state and the draft document |
| Object storage | Cloudflare R2 (three buckets) | Draft uploads, rendered pages, public assets |
| Auth | Better Auth (GitHub, Google) with Drizzle adapter | Sessions, account linking |
| Orchestration | Cloudflare Workflows, Queues, Cron Triggers | Publish pipeline, delivery and refresh jobs, sweeps |
| Email | Resend (REST via `fetch`) behind `EmailProvider` | Contact delivery, recipient verification, owner notices |
| Spam protection | Cloudflare Turnstile | Contact form |
| Color math | `culori` (OKLCH) **[default]** | Palette generation and contrast checks |
| Fonts | Self-hosted variable TTF fonts from Google Fonts' repository | Catalog-pinned DM Sans, Manrope and Lora files with SIL OFL notices; production delivery through `hasaweb-assets` and no third-party font requests. Any later conversion/subsetting must record its new bytes and preserve licenses |
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

1. **The draft is one JSON document** per portfolio, validated by a versioned Zod schema and saved with optimistic concurrency. Small validated changes use one canonical row write. Large changes prepare private bounded operations/string pieces and commit canonical content plus private progress atomically. See the [bounded-save contract](../specs/2026-10-16-free-owner-saves/protocol.md); full-body 1 MiB validation is not a supported Free save route.
2. **Published state is immutable and versioned.** Publishing never edits files in place; it writes a new version and moves a pointer.
3. **Live data lives outside snapshots** (GitHub activity, contact outbox, counters).
4. **Every query is scoped to the session's owner** inside a repository layer; handlers never build raw queries.

### 7.2 D1 tables (Drizzle/SQLite)

| Table | Key columns | Notes |
| --- | --- | --- |
| Better Auth tables (`user`, `session`, `account`, `verification`) | per Better Auth, plus `user.deleting_at` | Sessions use Better Auth's cookie cache. Authorization must still check deletion state before allowing owner access. |
| `portfolio` | `id`, `user_id` (unique), `subdomain` (unique, nullable), `status` (`draft`/`published`/`unpublished`/`suspended`/`deleting`), `published_version` (nullable), `draft` (JSON, capped at 1 MiB), `draft_rev` (integer), `draft_validation_version` (integer), `setup_progress` (private versioned JSON), `first_editor_entered_at` (nullable permanent timestamp), `suspended_at`, `suspended_reason`, timestamps | One row per account. `subdomain` is the published address, never a held reservation. The unique `subdomain_claim` namespace record enforces both holds and claims atomically. Setup progress and the editor-entry milestone share the draft revision and stay outside public snapshots. Database triggers freeze progress and preserve the milestone after entry. Legacy drafts require validation before incremental saves. Do not index `draft_rev` or `updated_at`. |
| `asset` | `id`, `portfolio_id`, `kind` (`avatar`/`banner`/`face`/`project`/`case_study`/`resume`/`og`), `content_type`, `bytes`, `width`, `height`, `status` (`pending`/`ready`/`failed`) | Alt text lives in the draft document, not here. |
| `publish_version` | `id`, `portfolio_id`, `n`, `status` (`rendering`/`live`/`failed`/`superseded`), `renderer_version`, `manifest` (JSON: pages, public assets, byte sizes), `error`, timestamps | Snapshot JSON itself is stored in R2, not D1. |
| `reserved_subdomain` | `name` | Seeded from the constant list. |
| `subdomain_claim` | `name` primary key, `portfolio_id` unique and nullable, `state` (`held`/`claimed`), `held_at`, `claimed_at` | A confirmed Address save inserts a `held` row. First Publish converts the portfolio's row to `claimed` in the same batch as the live pointer. A replacement deletes only the portfolio's current `held` row, then inserts the new hold in the same atomic D1 batch as the draft revision CAS. Any constraint or CAS failure must abort the whole batch, restoring the previous hold and draft; a zero-row CAS must not commit the swap. Account deletion deletes held rows and clears `portfolio_id` on claimed rows, which retain `name` permanently. Migration `0006_address_reservations.sql` implements this single namespace, preserves unknown historical claim times as null, and adds held-aware deletion and permanent claim guards. Existing name, platform-reserved and format triggers cover held rows too. |
| `address_confirmation` | Command `id` primary key, `portfolio_id`, complete `payload_hash`, accepted `name`/`state`/`revision`, `created_at`, `applied` | An explicit Address command writes its durable receipt immediately after canonical revision CAS in the same D1 batch. `CHECK(applied=1)` forces a zero-row CAS to roll back the hold swap. Exact replays return the historical receipt; the browser reads current canonical state before treating a replay as current. Receipts survive staging cleanup and cascade only with portfolio deletion. |
| `operator_email_audit` | `id`, `operator_id`, `account_id`, `case_reference`, `accessed_at` | Records each operator email lookup without the retrieved email. Delete after 90 days or on deletion of the associated account. |
| `github_connection` | `portfolio_id`, `login`, `github_user_id`, `token_enc`, `scopes`, `private_enabled`, `status` (`ok`/`needs_reconnect`/`disconnected`), `last_checked_at`, `generation`, activity app/operation and ciphertext binding | Phase 11D encrypts tokens with AES-GCM and rejects stale refresh successes/errors. Withdrawal moves credentials to separate cleanup storage. |
| `github_activity` | `portfolio_id`, safe public calendar, complete authorized calendar, fetch/error/refresh state associated with connection generation | Target semantics follow S-6. Phase 11D stores complete `public_calendar`/`authorized_calendar` values. Legacy `private_counts` is ignored and cleared for safe refetch. Select public or authorized calendar, never their sum. Public selection also requires the published graph's matching configuration; revocation disables authorized output immediately. |
| `github_grant` | Activity app/account key, owner portfolio, operation/generation, consent/cleanup state, encrypted cleanup credential, unique attempt, retry time | Global coordination prevents a delayed grant-wide deletion from revoking fresh consent. Cleanup survives portfolio removal. |
| `github_legacy_credential` | Portfolio, stable GitHub account, unknown legacy ciphertext/scopes | Quarantined for explicit app-binding reconciliation. Blocks private reconsent for the account until safe retirement. |
| `contact_recipient` | `portfolio_id`, `email`, `verified_at`, `pending_token_hash`, `token_expires_at` | Initially the account's verified provider email. |
| `contact_outbox` | `id`, `portfolio_id`, `payload` (JSON), `status` (`queued`/`sending`/`sent`/`failed`), `attempts`, `next_attempt_at`, `last_error`, `is_test`, `accepted_at`, `deadline_at`, `budget_window_start` | The budget reservation uses the UTC acceptance day. Payload is deleted on success and after final failure (data minimization). |
| `owner_save_attempt` | One expiring private preparation per owner, bound to the creating/resuming session, base revision, sequence, persisted setup/content/validation context, staged draft/progress, validation cursor and retry digest | Bounded saves commit canonical content/progress together. Legacy content uses staged validation before ordinary saves. Expiry denies writes; it does not physically reclaim rows. Preserve committed receipts until reconciliation. |
| `owner_save_piece` | Ordered bounded JSON string pieces, cascading from the attempt | Private staging only; owner/session checks and bounded cleanup apply. |
| `counter` | `key`, `window_start`, `count` | Fixed-window rate limits and the daily email budget. |

### 7.3 The draft document

Illustrative shape (final schema lives in `packages/schema`):

```ts
type DraftDoc = {
  schemaVersion: number;
  requestedSubdomain?: string;        // private mirror of the reserved address; the namespace record is authoritative
  profile: {
    name: string; bio: string; location?: string;
    avatar?: { assetId: string; alt?: string; accepted: boolean };
    banner?: { assetId: string; alt?: string };
    decorationId?: string;
    faceReveal: { enabled: boolean; image?: { assetId: string; alt?: string } };
  };
  links: Array<{                       // single source for profile + social component
    id: string; label: string; kind: string; // 'email' validates an address; other IDs use HTTP(S)
    value: string; showInProfile: boolean; showInSocialComponent: boolean;
  }>;
  components: Array<{ id: string; type: string; version: number; data: unknown }>; // array order = page order
  appearance: { themeId: string; customColor?: string; fontId: string; colorMode: 'light' | 'dark' | 'system' };
  seo: { title?: string; description?: string; ogImage?: { assetId: string } };
  samples: Record<string, true>;       // fields still holding untouched sample content
};
```

Phase 09 established the strict version 1 contract. Phase 11B adds version 2 with an optional `requestedSubdomain` and a content-preserving version 1 migration. The current fields are documented in [`packages/schema/README.md`](../packages/schema/README.md). Draft validation permits unfinished content; publication requirements and checks against authoritative asset/provider records remain separate. Sample keys use profile field names and stable component IDs rather than array indices.

Version 2 validates the requested address format and leaves invalid in-progress text to local recovery. First-editor-entry/progress metadata stays separate from portfolio content. The shared public-content projection excludes the requested address and setup metadata. Version 1 fixtures continue to read through the content-preserving migration. `requestedSubdomain` mirrors the reserved address for recovery; the unique namespace record is authoritative for holds and claims. The unique `portfolio.subdomain` remains reserved for published addresses.

- **Sample tracking:** retain Phase 09's compatible markers and validation for existing fixtures/migrated drafts. New provisioning inserts no sample profile or project. Any existing sample values remain flagged in `samples` and clear on first edit; untouched optional samples are omitted and edited samples use normal validation.
- **Size cap:** 1 MiB per draft (D1 rows max out at 2 MB). If real portfolios outgrow it, case studies can move to their own rows without changing the API.
- **Approved destination limits:** URLs are at most 2,048 UTF-8 bytes and draft email addresses at most 254 UTF-8 bytes, approved by the owner October 16, 2026. Free text retains the whole-draft ceiling. Existing longer destinations require explicit correction, never silent truncation.
- **Migrations:** each component owns a version and migration function; `schemaVersion` migrates the envelope. Offline readers use the full shared reader. Validated HTTP reads project the known version 1 upgrade in D1; unvalidated supported drafts require bounded staged validation, and unsupported drafts remain available through raw recovery. Successful saves persist the upgrade. Future schema changes must update incremental validation, validation-generation checks and equivalence fixtures together.

### 7.4 R2 buckets and key layout

| Bucket | Access | Contents |
| --- | --- | --- |
| `hasaweb-draft` | Private; only `web` binding; served to the owner through an authenticated route | `draft/{portfolioId}/{assetId}` (cropped images, resume PDF) |
| `hasaweb-sites` | Private; only `site` and `jobs` bindings | `sites/{siteId}/v{n}/snapshot.json`, `index.html`, `projects/{slug}/index.html`, `resume/index.html`, `resume.pdf`, `404.html`, `robots.txt`, `sitemap.xml` |
| `hasaweb-assets` | **Public** via `assets.hasaweb.site` (r2.dev access disabled) | `s/{siteId}/{assetId}.{ext}` (published images), `p/{hash}/...` (platform CSS, JS, fonts; content-hashed and retained) |

Asset IDs are never reused, so published image URLs are immutable and replaced images naturally bust caches.

---

## 8. Key flows

### 8.0 Initial setup and first editor entry

The agreed sequence and content mappings are in [onboarding.md](onboarding.md#screen-sequence-and-content-mapping). Private provisioning, storage and save routes exist through Phase 13. Phase 22A implements fixed `/auth/entry` resolution and authoritative handoff services. Setup screens and complete guide/editor activation remain in 42A–42F.

1. Resolve the authenticated owner through the existing uncached session/deletion checks. Idempotently provision the single empty private draft with the configured template/default appearance and explicit setup metadata. Do not infer completion from `portfolio !== null` or automatically copy provider identity into public content.
2. Use a fixed internal post-auth entry resolver for both OAuth callbacks and signed-in `/sign-in` visits. Owners without the permanent editor-entry milestone resume onboarding; owners with it enter the editor. Preserve the exact callback allowlist and approved-origin checks rather than accepting arbitrary redirect URLs. Phase 22A uses `/auth/entry` and the persisted entry service. It retains the account shell until the complete guide and editor activate in Phase 42E.
3. Save content, the `requestedSubdomain` mirror, and private progress under the same revision-aware owner boundary. A confirmed Address save atomically creates or replaces the portfolio's exclusive address reservation in the same D1 batch as the revision CAS; a conflicting insert returns an actionable unavailable-name result and changes neither the draft nor the previous hold, and a failed or stale save neither reserves nor releases a name. Staged attempts and legacy validation commits do not reserve: only a confirmed Address save holds a name. Reuse the draft store, recovery, uploads, and component controls. Progress changes must not race with content or overwrite a completed milestone. Repeated steps/callbacks use stable IDs.
4. Server-enforce required Address/Profile/Links before first editor handoff and prevent direct route or client-state bypass. Setup must still be able to use its authenticated draft/save/upload endpoints and private preview. Required setup and editor permissions are distinct from sign-in; gating must not make the shared setup APIs inaccessible.
5. Optional steps can be skipped individually or together without deleting entered content. Invalid text stays in local recovery; valid partial entries/configuration remain in the draft with normal publication blockers. Review is private, noindex/no-store, client-rendered with the shared renderer, and supports desktop/mobile widths. Draft graph preview uses owner-authorized data, not the public portfolio endpoint.
6. Open editor flushes valid saves, validates authoritative required content/ready owned assets, and records the permanent milestone with revision checks. Repeated handoffs are idempotent. Failure returns an actionable retry state without claiming success. Later missing required fields affect Publish only. Stale setup tabs must reload the editor state and cannot reinitialize content or clear the milestone.

Continuing from Address requires valid format, non-platform-reserved status, a successful availability check, and server confirmation of the reservation save. An availability check alone reserves nothing and does not permit continuation. A successful confirmed Address save creates an exclusive reservation owned by that portfolio, so another owner can no longer take the name. The owner may change the reserved address until first publication: a confirmed change atomically swaps the hold using the delete-then-insert batch in section 7.2, while an invalid, platform-reserved, unavailable, or failed change leaves the current reservation intact. First Publish verifies that the portfolio still owns the reservation, rechecks the platform blocklist, and converts it to the permanent claim; it attempts no fresh availability race. Do not force a completed owner back into onboarding.

### 8.1 Autosave and conflict handling (product 14)

The server contract is implemented in Phase 13 with Phase 14 expected-owner preconditions. Phase 14 implements the [shared client](../apps/web/lib/draft/README.md) and isolated browser fixture; Phase 15 adds the recovery coordinator and fixed same-tab callback, approved by the owner on October 19, 2026. Use the [production protocol](../specs/2026-10-17-revision-aware-drafts/protocol.md), not the rejected full-body experiment.

1. Obtain owner/portfolio IDs from the authenticated owner API. Send `X-Expected-Owner-Id` on every draft/progress request. The server compares it with the authenticated identity, returning 400 `invalid_input` when missing and 409 `owner_changed` on mismatch. Verify the response portfolio ID. Load `GET /api/owner/draft` for a consistent draft/revision/progress snapshot. Use `GET /api/owner/progress` when content is unnecessary. The large response streams D1-produced JSON without whole-document Worker decoding or reserialization.
2. Coalesce valid changed fields after a ~2 s debounce. Send `POST /api/owner/draft/patch` with `revision`, `change` and `context`. Setup includes progress; content writes preserve frozen progress and the milestone. Progress-only saves use the `progress` action under the same revision CAS.
3. Multi-command batches and large edits use begin/change/string-piece/commit actions within the protocol's byte, piece and expiry limits. Coordinate the single owner attempt across tabs/devices. Context persists in the attempt; first editor entry closes setup writes, including earlier prepared attempts.
4. A confirmed canonical write returns `{ revision }`. Only then show Saved for the acknowledged current edits; remaining invalid raw input shows Unsaved input. `flushValid()` returns the confirmed revision and whether local-only input remains. A staged change is not a canonical save. Conflicts return 409 with an error code, without a newer document; fetch and reconcile separately before offering Load newer version or Keep my edits for review. Do not add whole-draft payloads to conflict responses.
5. While saving show Saving; on failure show Couldn't save with Retry. Reconcile lost direct-patch responses through a canonical read. Recover lost staged replies through pending/status, identical-command replay and commit receipts. Sequence advancement alone never proves which command ran. Confirm a receipt against the captured complete batch before reporting Saved. Preserve a committed receipt until its confirmed revision is recorded. Explicit resume/discard follows the protocol. Web Locks serialize same-origin commands and BroadcastChannel carries revisions and attempt IDs only; server CAS protects separate devices. Pending metadata cannot reconstruct unknown staged content. An unfinished attempt without its matching journal requires its original browser or explicit discard. A lost begin receipt cannot verify the attempt ID or its captured progress; explicitly discard staging and rebuild from preserved input. An uncertain command cannot transfer sessions while its receipt hash remains unverified. Persist transfer intent and require the exact expected sequence increment. Persist explicit discard intent against the displayed attempt ID before abort, confirm it before cleanup and finish that discard after a lost reply. A known newer canonical snapshot cannot be replaced by an older receipt.
6. Mirror unsaved and structurally invalid input to IndexedDB scoped by owner, portfolio, browser instance and base revision. Persist immutable batches and command checkpoints before sending. A changed-base record blocks replay. Persist known revision/setup-closure blocks so reload or Retry cannot silently rebase unfinished input. The Phase 15 coordinator quiesces the source, fetches current canonical values separately and offers confirmed Load newer version or initially unselected three-way review. Stable IDs identify collection entries; additions/removals/reorder, rich text and schema-coupled objects are explicit selections. Missing entries remain review-only. Recheck revision/milestone before applying and when reopening an unexecuted prepared replacement, persist replacement/decision checkpoints and remap matching tab continuations before conditional source retirement, ignore clean checkpoints on reload, and save selected values in a fresh controller through bounded commands. Retained review copies remain available without blocking resolved active drafts. A terminal committed receipt can be retired only after canonical read and durable local review preservation, through a linked controller cleanup journal; this never replays/transfers an uncertain command or adopts unfinished staging. Discard intents also pin an observed absence and reject a newly appeared attempt. Restore pinned discard journals before changed-base/context checks, retaining working values and the original comparison base; finish only their cleanup before selected review. Applicable setup recovery remains available after handoff without replaying progress. Storage failures show a local-recovery warning and preserve memory edits. Keep the active controller usable until the review copy and continuation are durable, then finish disposal persistence before source retirement. Remove only confirmed saved input. Conditionally remove a recovery source only when its stored snapshot still matches; a live tab may have persisted newer input. Starting a review from an archived record keeps the active scope's recoverable checkpoint as its own preserved recovery; only a clean active record is retired. Retain the durable source if replacement persistence fails. On 401 persist recovery and an identifier-only versioned tab continuation before same-tab sign-in. Fixed `/auth/recovery` and `/auth/recovery/error` callbacks preserve normal `/auth/entry` resolution. Check uncached owner/portfolio identity before opening local records, require explicit continuation, and reconcile pending receipts before further writes. Continuing a preserved record quiesces the controller before source lookup and keeps fields suspended through restoration, including fresh prepared replacements; release the pause before receipt verification/saving or on failure. Wrong accounts cannot load/copy/delete the original recovery. Cancellation/failure/reload/Back keep continuation; missing records fall back to account entry. Matching callbacks also offer account entry for clean or not-yet-loaded checkpoints. Local recovery cannot promise cross-device recovery of invalid or unuploaded input. Legacy validation also needs its matching journal before committing unfinished staging; unknown corrections cannot be adopted from metadata. Persist raw destination correction text separately, bound to the reported path and base revision. Only remove matching current text after the exact validated revision is fetched; later input remains unsaved, including after explicit staging discard.

The same recovery works during required setup and private activity consent. Resume confirmed progress across devices. Structurally invalid unfinished input, including partial URLs, is stored locally and never labeled cloud-saved. After first-editor handoff, the recovery coordinator allows explicitly reviewed setup content in a fresh content scope without replaying progress, converting prepared setup attempts, reprovisioning or resetting the milestone. The future editor/guide adapters supply the surrounding navigation without fabricating a successful draft save. Owner/portfolio keys must prevent recovery into another account. Invalid input must not disable the optional Skip actions.

The [capacity model](../specs/2026-10-16-free-owner-saves/quotas.md) budgets about 37,000 writes/day with one near-1 MiB upload in each of 30 editing sessions, or about 68,000 with maximum piece counts. The [Phase 13 handler budgets](../specs/2026-10-17-revision-aware-drafts/quotas.md) include authentication and the historical streamed read's 268-row cost. The [Phase 14 measured model](../specs/2026-10-18-shared-autosave-recovery/quotas.md) records the current 65,536-code-point chunks at 76 rows, direct action access prechecks and client orchestration costs. Clients must coalesce edits, avoid unnecessary complete reads and account for retries/validation/cleanup. Passing CPU percentiles does not prove sufficient D1 capacity for every document shape.

### 8.2 Uploads (product 13)

1. The client validates type and size (JPEG/PNG/WebP up to 5 MiB, exactly 5,242,880 bytes, and PDF up to 10 MiB, exactly 10,485,760 bytes), crops, resizes, and re-encodes images on a canvas (this also strips EXIF/GPS metadata).
2. The client sends the file with `XMLHttpRequest` to `PUT /api/assets` for progress events.
3. The server re-checks size and **magic bytes**, creates pending metadata, streams to `hasaweb-draft`, and marks the asset ready only after complete validated bytes and repeated persisted authorization. The [private upload protocol](../apps/web/lib/assets/README.md) defines exact framing, headers, failure cleanup and uncertain outcomes.
4. The draft references the new asset ID **only after** the asset is `ready`. A failed or interrupted replacement therefore leaves the previous asset in place in both draft and published use.
5. Draft assets are fetched only through `GET /api/assets/{id}` with an ownership check; everyone else gets `404` (AC 13.7).

Onboarding's combined profile step and editor share reposition/zoom/reset/apply/cancel crop dialogs and previews. Provider-photo import enters through an owner-accepted, validated private import/upload path and returns an owned ready asset, never an external URL in the draft. Cropping applies to imported photos too. Reuse existing image limits and canvas re-encoding. Keep only the finished cropped file, with no durable source/crop metadata. Reset uses the current local selection; recovering excluded regions after returning requires reselecting the original. Do not introduce retained originals as an implicit implementation extension.

### 8.3 Publish (product 15), the core flow

Publication is pending. Implement durable, replay-safe tasks in `jobs` only after measuring the required Queue/D1 fallback; the former fragment-per-step Workflow design was rejected.

S-8 measured the bounded fragment approach on October 15, 2026. The deployed three-page stress experiment also failed the per-invocation API request limit while retaining the old pointer. Even one near-limit portfolio needs 141 durable steps, or 4,230 steps at the planning estimate of 30 publishes/day, before preparation and cleanup. This exceeds the Free daily allowance. Treat the sequence below as logical publication operations, not an approved Free Workflow implementation. Record Queue plus D1 task dispatch as the required fallback to validate before Phase 24. A naive one-message-per-fragment replacement also exceeds the Queue allowance, so measured batching and a complete shared quota model are required. CPU feasibility remains unproven. See [S-8/S-9 results](../specs/2026-10-15-workflow-assets/results.md).

1. **Request.** The planned publish endpoint carries `draftRev`. Route its hot handler through the thin owner API, with uncached session/deletion checks. Reject unless `draftRev` equals the saved revision and autosave has flushed. Specify its final route and bounded validation protocol before implementation.
2. **Validate.** Share validation rules between the editor checklist and authoritative server checks for profile fields, links, ready assets, GitHub fetch state, verified recipient, resume PDF, catalog membership and the address reservation/claim. Issues carry field paths. Publication needs its own measured bounded validation/snapshot preparation; a pure whole-document helper does not prove a 1 MiB hot invocation fits the CPU budget.
3. **Snapshot.** Write `snapshot.json` for version `n` to `hasaweb-sites`. Omit untouched samples and include only assets reachable from included components (Face Reveal's second image is included only when enabled).
4. **Promote assets.** Copy only referenced ready owned images from `hasaweb-draft` to `hasaweb-assets/s/{siteId}/...`. The draft bucket is currently bound only to web; jobs cannot read it directly. Phase 24 must specify and measure the authorized transfer boundary before implementing promotion. Do not infer draft-bucket access from the jobs binding or the spike's synthetic input setup.
5. **Render.** Produce the portfolio, each case study, `/resume`, `404`, `robots.txt` and `sitemap.xml` under `sites/{siteId}/v{n}/`. S-1 rejects whole-page render steps near the 1 MiB ceiling. Use bounded preparation/render/assembly from [S-1](../specs/2026-10-15-publish-render/results.md), with measured batching and per-invocation budgets addressing S-8's failures. Do not repeat one whole page per step or one Queue message per fragment.
6. **Flip.** For first publication, a single atomic D1 batch verifies the portfolio's `held` namespace row, rechecks platform-reserved names, converts exactly that row to `claimed`, sets `portfolio.subdomain` and `portfolio.published_version = n`, and marks the version `live`. For republishing, including after unpublish, verify the portfolio's existing `claimed` row matches its fixed `portfolio.subdomain`; retain the claim, switch the pointer to `n`, mark the new version `live` and the previous version `superseded`. Both paths condition the commit on the expected publication state; any failed guard aborts the whole batch. A missing or mismatched reservation/claim fails the attempt with an actionable address error and preserves the existing pointer and namespace row. Neither path attempts a fresh availability insert. A retry of the same committed publication returns its durable success receipt without requiring a `held` row or moving the pointer again. A delayed retry after a newer publication must not restore the older version; an uncommitted attempt retries against the current authoritative state.
7. **Clean up.** Delete public objects no longer referenced by the manifest (this is how a disabled Face Reveal photo disappears), purge those URLs from the CDN cache, and delete old versions beyond a short retention window.

Failure before the pointer flip leaves `published_version` and the existing reservation or permanent claim untouched. After a successful commit, cleanup failures retain retryable work while the new complete version remains live; do not claim the old pointer survives a post-commit failure. Keep withdrawal pending until origin deletion and observed cache absence succeed under the verified browser/query/edge policy. The UI offers Retry for failed publication and polls until `live` without treating pending cleanup as completed withdrawal.

### 8.3.1 Case study URLs

Case studies use `/projects/{slug}`. Generate a slug from the title with lowercase ASCII letters, numbers, and hyphens. Convert spaces and punctuation to hyphens, collapse repeated hyphens, and trim leading and trailing hyphens. Slugs contain at most 80 characters. Use `project` if the title produces no usable characters. Resolve collisions within the portfolio with `-2`, `-3`, and subsequent suffixes, truncating the base to keep the complete slug within 80 characters.

Regenerate the slug when the title changes before the case study's first successful publication. Freeze it on first publication. Later title edits retain the URL. The MVP has no slug editor or redirect management.

Deleting a case study from the draft does not change the published site. After the deletion is published, its old URL returns `404` and the slug becomes available to another project in that portfolio. If a new project reuses it, old links point to the new project.

### 8.4 Visitor request (the `site` Worker)

1. Parse the host; accept only a single label before `hasaweb.site`; platform-reserved or unknown hosts get a generic platform page.
2. One D1 query by subdomain: `status`, `published_version`, `id`. Anything other than `published` returns the generic "unavailable" page (covers unpublished, suspended, deleted).
3. Map the path to an R2 key under `sites/{id}/v{n}/` and stream it, honoring `If-None-Match` and `HEAD`.
4. Special paths: `/resume.pdf` (served same-origin with `Content-Disposition` so the download button works), `/_/github.json`, `/_/contact`.
5. Responses carry strict security headers and `Cache-Control: public, max-age=0, must-revalidate`. HTML for a given version is immutable, so a Cache API layer keyed by host, path, and version is a straightforward later optimization.

Each request is served wholly from one version. Navigating between pages during a publish can cross versions, but no single response is ever a mixture.

### 8.5 GitHub activity (product 9)

**Why counts are not in the snapshot:** private counts must vanish on revoke without a republish, and refreshes must not require republishing. Freeze the selected GitHub account identity/username, profile link, and `includePrivate` publication choice in the version's graph configuration, with placeholder markup. Counts and tokens remain outside snapshots. The public endpoint resolves this immutable configuration from the active published version rather than trusting draft choices or visitor query parameters; a small script loads `/_/github.json` and draws the graph.

- **Endpoint:** `site` reads activity and the published graph configuration. Serve the safe public calendar, or the complete authorized calendar only when the published graph permits private activity and its selected account matches the currently valid private grant. Never sum calendars or infer private counts by subtraction. Onboarding/draft authorization does not expose private counts before Publish. `s-maxage` is about five minutes, with an explicit cache purge on revoke or disconnect.
- **Refresh-on-visit:** if `fetched_at` is older than the confirmed six-hour TTL and no refresh was recently requested, `site` records `refresh_requested_at` and enqueues one refresh message with `ctx.waitUntil`. The visitor is served the last good data immediately.
- **Daily scheduled sweep:** a cron handler enqueues one message per `private_enabled` connection. The consumer validates the token, refreshes, and on `401` marks `needs_reconnect` and strips private counts. This is how revocation made directly on GitHub is detected.
- **Failure:** the last successful graph and its date stay published; the editor shows the failure with Retry or Reconnect. A fetch failure never blocks the rest of the page.
- **Auth:** public data uses a platform-held GitHub token (GraphQL requires authentication). Private activity requires a separate, explicit `read:user` authorization stored in `github_connection`, valid only when the authorized account matches the selected username. Sign-in requests identity and email scope only. Disconnect revokes the grant with GitHub, deletes the token, and purges private data. Exact scopes and visibility behavior are verified against test accounts **[spike]**, per AC 9.10.

S-6's [tested projection and remaining credential check](../specs/2026-10-15-github-permissions/results.md) supersede the former additive `private_counts` description. Phase 11D implements the storage, projection, encryption and conditional refresh contracts in the production packages. Product provider fetching, OAuth routes, graph endpoints and scheduling remain Phases 40–42. Phase 11C [verified the separate platform credential live](../specs/2026-10-16-github-platform-credential/results.md): a zero-scope classic PAT resolved the public baseline at 425/0, returned unavailable/restricted when private contributions were shown, and never maps platform failures to owner reconnect; sign-in tokens are not a public-only fallback. Connection generations and conditional writes now guard both successful refreshes and errors, so an old job cannot repopulate removed private data or withdraw a newer grant.

Both onboarding and editor explicitly add graphs and offer public/private setup. Google owners need no GitHub sign-in link for activity authorization. Use the separate activity app, `read:user`, one-use expiring owner/session-bound state, S256 PKCE, and matching stable GitHub ID plus case-insensitive username. Return only to the controlled pending step/settings flow. Cancelled/failed/wrong-account consent offers Retry, public-only setup, or later incomplete editor repair without silently replacing the username or adding another mandatory setup gate.

Explicit graph removal confirms withdrawal, removes the draft graph, immediately disables private serving, advances the connection generation, clears active credentials/private data, purges cache, and performs durable retryable remote grant revocation. Any cleanup credential must be encrypted and unavailable to active graph refresh, then removed after cleanup. Phase 11D adds a global app/account coordinator. Consent waits for pending/in-flight cleanup; duplicate deliveries must claim the current operation before calling GitHub. Confirmed failures retain encrypted retry state, while interrupted provider calls stay locked for reconciliation without automatic lease stealing. Unknown legacy credential bindings block new private consent until reconciled. This activity cleanup is required before onboarding; Phase 47 reuses it for provider settings instead of implementing a second path. Graph removal leaves sign-in connected. Ordinary Skip preserves the graph and grant. Public-only/changed-username serving and revocation continue to follow the published-configuration and immediate-withdrawal rules.

S-6 establishes that grant deletion can revoke all tokens for the same activity app/user. Generation checks on D1 writes alone do not protect fresh tokens against a delayed provider-side delete. Serialize grant-wide cleanup and new private consent for that app/account: do not start new consent while older cleanup is pending or in flight, and fence duplicate/stale cleanup tasks before provider calls. Surface cleanup/retry status while retaining public-only setup and optional editor entry. Verify remove, remote failure, attempted reconnect, old cleanup retry, and subsequent successful consent without the old task revoking the new grant.

### 8.6 Contact form (product 10)

1. Visitor submits to `/_/contact` on the same origin, with a Turnstile token.
2. `site` validates fields, verifies Turnstile, applies fixed-window limits from `counter` (per site and per hashed IP), and checks the site's recipient is verified.
3. In one atomic D1 operation, reserve the site's and global contact email allowances and insert a `contact_outbox` row. Enqueue delivery, then return `202` "accepted". Reject blocked, rate-limited, or exhausted-budget submissions explicitly before acceptance. Retries retain the original reservation.
4. The consumer sends through `EmailProvider` with an idempotency key and the visitor as Reply-To, then marks `sent` and deletes the payload.
5. Attempt delivery immediately, then at 5 minutes, 30 minutes, 4 hours, and 24 hours after acceptance. Retry transient failures. Honor a provider's longer retry delay only within the 24-hour deadline. Permanent errors fail immediately. If delivery remains unsuccessful at the deadline, mark the row `failed`, delete the visitor payload, and notify the owner. Retain delivery status and diagnostic metadata without message content. The sweeper re-drives stuck work without resetting the deadline or exceeding five attempts.
6. Send test message uses the same path with `is_test`. Limit tests to two per site per UTC day and count them against the site's and global contact allowances. Preview-mode forms never make a network call.

Limits are five submissions per visitor/IP per site per hour and ten accepted messages per site per UTC calendar day. The global contact allowance is 90 emails per UTC day. Reserve the remaining ten of the 100 daily emails for recipient verification and owner notices. Defer those emails when their allowance is exhausted. Show delivery failures in the editor even when the owner notice is deferred.

S-7 confirms the Resend adapter and all three live email types. [Evidence and implementation decisions](../specs/2026-10-15-email-delivery/results.md) include an additional dispatch-day guard to prevent cross-midnight retries from exceeding the provider cap or consuming the ten reserved notice slots. Acceptance reservations still use the original UTC day. Production outbox integration belongs to phases 43 through 45.

### 8.7 Unpublish and delete (product 18)

- **Unpublish:** set `status = unpublished` (the `site` Worker stops serving immediately because it checks D1 on every request), delete public objects, purge cache URLs. The draft and the published address claim are retained.
- **Delete account:** after explicit confirmation, atomically mark the account as deleting, set its portfolio to `deleting`, invalidate sessions, delete the portfolio's held reservation rows, and clear the owner on its published address claim so the name remains permanently reserved. Owner and public endpoints deny access immediately, including through cached sessions. Durable bounded cleanup revokes connected access, removes portfolio R2 prefixes, verifies CDN withdrawal and deletes account-related D1 rows, including email audits. Reuse the measured dispatcher and GitHub grant coordinator; temporary encrypted cleanup state may survive owner deletion until remote revocation is resolved. Retry failures. After cleanup only the published address's ownerless permanent claim survives, without identity or content. A reservation that was never published is deleted; an account that never reserved or claimed a subdomain leaves no reservation.
- **Suspend (abuse kill-switch):** `suspended_at` set by an operator script (`pnpm ops suspend <subdomain> --reason ...`) that updates D1 and purges the cache; `site` serves the generic unavailable page. No admin UI in the MVP.

---

## 9. Component system and rendering

### 9.1 Component registry (supports "new components over time")

The canonical data contracts and registry live in `packages/schema`, with a module per optional component type. `packages/components` re-exports this registry and attaches the shared markup-only renderer through an exhaustive typed display projection. Editor implementations remain in their scheduled phases. This keeps draft validation usable in browsers and Workers without importing React or creating a package dependency cycle. The registry is the only list of supported optional types; it generates their discriminated union.

The full component definition will combine these data contracts with the following UI and rendering adapters:

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

- **One renderer, two hosts.** Phase 16 implements markup-only React shared by client browser preview and static `react-dom/server` output. Its display-only model excludes private recipient configuration, raw asset IDs, setup/recovery fields and disabled second photos. Callers resolve authorized ready assets before projection. Shared markup renders incomplete drafts honestly. Display strings normalize HTML-parser line endings and invalid scalar cases without changing saved draft input, so client and static DOM text match. See the [renderer contract](../packages/render/README.md) and [protocol](../specs/2026-10-19-shared-portfolio-renderer/protocol.md).
- **Bounded production entry.** `renderFragment` checks a prepared profile or component against input node/depth/string/byte and output limits. Oversized valid content returns `needs_partitioning`, never truncated HTML. The separate offline full-document helper proves fixture parity only. Phase 24 must implement revision-bound resumable preparation, split large text and nested wrappers without duplication, and measure actual units, CPU, Queue/D1 batching, operations and assembly. A size check alone proves no CPU bound.
- **Zero React on published pages.** Static output loads content-hashed platform CSS and a small vanilla script. Phase 16 shares native theme switching, preference handling and image loading/error behavior with browser preview. Face Reveal, independent decoration playback, GitHub graph drawing, contact submission and resume fallback activate in their later phases. No React hydration is included in snapshot output.
- **Preview is client-rendered.** The live preview and the full-page preview render the draft in the browser without server rendering. Phase 17's editor uses actual **iframe** viewports of 390 px or 1120 px, independent of the available panel width, so CSS media queries respond correctly. A cancellable display projection reaches the iframe through acknowledged `postMessage` chunks. The shared bridge pins parent window, exact origin, channel and increasing render sequence, validates display data and rechecks asset origins. It supplies no authorization itself. The editor's private-preview adapters authorize the owner before serving or mounting, and reauthorize the original identity after browser restoration. They remain dormant outside handoff fixtures. Product entry, full-page preview routes (`/preview/...`) and ready-asset integration retain Phases 18/39/42E. Private routes require authentication, `noindex` and `no-store`. See the [current preview contract](../packages/components/README.md#browser-adapter).
- **Renderer versioning.** Each snapshot records `renderer_version`. Retain content-hashed platform CSS/JS so old snapshots keep working after deploy. A future `rerender-all` job must use the same measured bounded dispatcher and pointer flip, including a shared quota budget for a bulk run.

### 9.3 Appearance system

- `packages/theme` currently exports only `appearanceCatalog` for later provisioning, rendering, validation and review. Phase 36 will add the pure custom-color generator, returning paired light/dark palettes and editor adjustment explanations.
- Phase 11E approved exactly six presets: `leaf`, `violet`, `clay`, `matcha`, `strawberry` and `coffee`, each with paired light/dark tokens, plus three curated fonts and two optional animated decorations (`cat`, `hands`). Use the [approved versioned catalog](appearance-catalog.md) for provisioning and production appearance validation. Keep the single template and approved defaults. Opaque draft IDs already support these additions; no schema migration is required. Publication must check approved catalog membership in Phase 23.
- Phase 36 will use OKLCH and adjust generated colors to the confirmed WCAG 2.2 AA thresholds, 4.5:1 for normal text and 3:1 for large text and control indicators. Current catalog checks cover all declared preset pairs; custom-color generation and seed-color sweeps remain pending.
- Tokens are emitted as CSS custom properties. Tailwind v4 maps its theme to those variables, so the same utilities style the editor preview and published pages.
- Fonts are self-hosted variable fonts from `hasaweb-assets`, with real fallback stacks. No third-party font requests.
- Phase 16 starts with the approved system default and stores an explicit visitor choice in `localStorage`, with no cookies or tracking. Its shared external script initializes theme state and handles system preference changes. Phase 35 adds saved owner initial modes and all catalog choices. Theme flash prevention across the final retained asset delivery path must be verified there; no inline script exemption is currently required.

### 9.4 Face Reveal and avatar decoration

Markup: a positioned avatar slot containing a portrait and decorative overlay. With Face Reveal enabled, the portrait is an interactive `<button>` containing both images. The reveal is a CSS `clip-path` diagonal wipe (top-left to bottom-right); `prefers-reduced-motion` switches instantly; the accessible name toggles between "Reveal face" and "Show avatar"; Enter and Space work natively on a `<button>`. When the add-on is off, plain portrait markup with no reveal button, cue, or second image is rendered; a selected decoration can still animate.

The [faithful React import](avatar-decorations.md) is the visual and animation reference. Its Umer portraits and fixed label are review fixtures, not defaults for owner sites. Keep those source files unchanged. The production renderer uses owner assets and the product labels above through shared markup, source-equivalent CSS and trusted decoration assets. It must preserve the cleaned 212 × 220, 32-frame cat loop and still, the six-second inline SVG/CSS hand choreography, responsive 124/104 px portrait sizing and envelope, and stable image loading. Published pages retain zero React hydration. The two decoration implementations do not require rewriting CSS animations as GSAP.

Autoplay yields to `prefers-reduced-motion`; use the cleaned still cat or stationary hands, and skip the reveal wipe. Phase 38 adds a separate native pause/play button and shared preview/public `site.js` behavior, independent of Face Reveal. Pausing selects the cat still or stops the hand animation without changing portrait state; playing resumes the original sequence only when reduced motion is not active. Motion preference changes apply immediately. Treat decorative SVGs/images as hidden from assistive technology. The source review demonstrates original behavior and reduced motion; it does not yet implement production pause/play.

Publish and retain content-hashed clean cat loop/still and hands CSS/SVG with each renderer version through the platform asset host. Raw cat inputs, generator and source portrait fixtures are tooling/review dependencies, not assets to add to every owner publication. This adds no custom upload permission or owner-provided SVG/CSS. The generator environment exception is recorded in the import guide; the source-verified clean assets can be approved without changing the generator guard.

---

## 10. Security and privacy

| Area | Measure |
| --- | --- |
| **Owner content** | No raw HTML, scripts, or CSS accepted. Rich text is stored as Tiptap JSON, validated against an **allowlist schema** (paragraph, headings, lists, links, images in case studies), and rendered by our own serializer, never via `dangerouslySetInnerHTML`. Link schemes are allowlisted (`https`, `http`, `mailto`). External links get `rel="noopener noreferrer"`. |
| **Published page CSP** | `default-src 'none'`; scripts only from our hashed `site.js` and Turnstile; images from `assets.hasaweb.site`; `frame-ancestors` restricted; `object-src` limited to same-origin PDF embedding on `/resume`. Phase 16 permits platform styles/scripts/fonts at explicitly configured trusted origins and forbids inline scripts/styles. Later generated custom tokens must use retained generated CSS or an explicit reviewed CSP hash, never arbitrary owner CSS. Also `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. |
| **Cookies and origins** | Auth cookies are host-only (no `Domain` attribute) and set only by the apex app; where Better Auth permits, use the `__Host-` prefix **[spike]**. Portfolio pages run no owner scripts and receive no auth cookies. Submit `hasaweb.site` to the Public Suffix List after launch. Launch does not depend on acceptance of the submission. |
| **CSRF** | Better Auth origin checks, `SameSite=Lax`, and strict `Origin` verification plus JSON content type on every mutating route handler. |
| **Authorization** | Every repository function takes the session user and scopes by `user_id`. Draft previews and assets return `404` to anyone else (AC 16.5). Planned first-editor routing validates persisted setup/milestone state; direct client routes cannot bypass it. Shared setup saves/uploads remain authorized before editor entry. |
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

Use the [README commands](../README.md): `pnpm dev` builds and starts all three Workers in workerd with local D1/R2/Queue/Workflow state under `.wrangler/state`. `pnpm dev:runtime` restarts the build; `pnpm dev:web` provides Next.js-only hot reload and cannot exercise the Worker owner-API adapter. Separate development OAuth apps use the exact loopback callbacks. The seed creates two fixture users with empty private drafts, no usable sessions/credentials/address reservations, and runtime probe files. It creates no published example. `ConsoleProvider` exists for later email integration; the product delivery path is not wired yet.

### 12.3 CI/CD (GitHub Actions)

- **Current CI:** the [foundation workflow](../.github/workflows/ci.yml) runs `pnpm check`, the full build, shared renderer preview/snapshot Chromium parity, auth/Chromium fixtures, persistence, production draft API integration, the isolated autosave Playwright/axe fixture, runtime smoke and local runtime/routing spikes. It runs on pull requests and pushes to main, with no deployment credentials. Complete journey/browser-matrix coverage remains pending Phase 53.
- **Planned production release, Phase 52:** manual GitHub Environment approval, backward-compatible migrations, then deploy `jobs`, `site`, `web`. Report Wrangler startup measurements and enforce the one-second limit. There is no current automatic main-to-production deployment.
- **No staging:** mitigate with gradual deployments and instant rollback where Wrangler supports them, feature flags in D1 for risky changes, D1 Time Travel, and the `rerender-all` job for renderer rollouts.

---

## 13. Testing strategy (mapped to acceptance-criteria.md)

Use the [agent workflow](agent-workflow.md#choose-local-checks) for incremental local profiles, affected application builds, high-risk review and selective evidence. The layers and confirmed release matrix below retain their scope. CI keeps the foundation correctness suites; runtime profiling is an explicit measurement command rather than a routine regression requirement.

| Layer | Tooling | Covers |
| --- | --- | --- |
| **Unit** | Vitest | Palette generation and contrast (AC 12.3-12.5), `validateDraft` (AC 2.5, 4.1-4.3, 15.4-15.6), subdomain rules (AC 15.1), rich-text allowlist and XSS payloads (AC 8.3), link validation, date validation (AC 7.3), renderer snapshot tests |
| **Worker integration** | Existing scripts start isolated Wrangler/workerd Workers with local D1/R2/Queues/Workflows; fixtures are separate integration builds | Extend this approach to `site` routing and states (AC 16.5-16.6, 17.4-17.5), publish atomicity and failures (AC 15.7-15.8), concurrent reservations and claims (AC 15.2), autosave conflicts (AC 14.4), delivery/GitHub jobs (AC 10.5-10.6, 9.4, 9.8-9.9), asset access (AC 13.7) and Face Reveal removal (AC 4.14). The workers Vitest pool is not installed or required by the current harnesses. |
| **End-to-end** | Playwright, axe-core, three viewport sizes | Full journeys (cross-feature AC 2), editor on desktop and mobile (AC 3.6), keyboard and focus (AC 16.4), reduced motion, Face Reveal and independent decoration playback (AC 4.11–4.12, 4.15), theme switching (AC 12.6), upload limits and failures (AC 13) |
| **Manual / usability** | Timed session with target users | The 15-minute publish target and the qualitative outcomes (cross-feature AC 1, 5) |

Worker integration checks also cover permanent published address claims after account deletion and the release of never-published reservations, immediate denial of cached sessions during deletion, retryable cleanup, case study slug collisions and reuse after a published deletion, atomic contact budget reservations, and operator email audit retention.

Extend these layers with AC 2's ON checks: required setup/direct-route guards, two owners concurrently reserving one name with a single winner, reservation replacement, publish from the holder, one draft under repeated callbacks, progress/content conflicts, permanent handoff under stale setup tabs, private activity consent for both providers, generation races and non-additive calendar projection. End-to-end coverage includes completed and skipped optional paths, incomplete content, same-browser invalid-input recovery, private Review, crop cancellation/failure, authorization returns, and first-editor field parity. The profile-only timed journey includes required setup and Review while skipping optional content; the existing 15-minute target is unchanged.

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
| Worker requests (all Workers) | Original baseline ~20,000/day; maximum-piece save model ~52,400 before final publication costs | 100,000/day | Recalculate with final dispatcher and recovery frequency |
| D1 rows written | ~37,000–68,000/day with 30 large field uploads, before final publication/other-job costs | 100,000/day | See bounded-save model; not the original ~20x |
| D1 rows read | Shape-dependent; ordinary 3,000-save fixture alone costs 270,000 repository reads; add actual handler/read/recovery costs | 5,000,000/day | No general headroom claim; dense-component stress exceeds Free |
| R2 Class A | ~15,000/month | 1,000,000/month | ~60x |
| R2 Class B | ~200,000/month | 10,000,000/month | ~50x |
| R2 storage | ~1-2 GB | 10 GB | ~5x |
| Queue operations | Original contact/GitHub estimate ~1,000/day; publication batching/retries not budgeted yet | 10,000/day | Unknown until S-8 fallback measurement |
| Emails (Resend) | <20/day typical | 100/day, 3,000/month | ~5x |

Deployed S-4 observations support Next.js build-file requests bypassing Worker invocation accounting under asset-first routing. Prerendered Next.js documents and missing build files still invoke the Worker. Adaptive analytics is approximate; [evidence and configuration limits](../specs/2026-10-15-host-routing/results.md) are recorded. This does not prove overall Free-tier feasibility.

The October 16 [bounded-save quota model](../specs/2026-10-16-free-owner-saves/quotas.md) supersedes the save portion of the original estimates. It models about 52,400 conservatively counted web/jobs invocations with maximum-piece uploads, versus the table's original 20,000 baseline, and a 426.2 MB local storage stress result for 100 maximum drafts plus attempts/pieces. Phase 13 adds [measured handler costs](../specs/2026-10-17-revision-aware-drafts/quotas.md), including 268 rows per maximum streamed draft read. Neither the old request/R2 estimates nor warm CPU percentiles prove total capacity. Recalculate the shared budget with publication batching, retries and actual read frequency; observe deployed counters and size before broad autosave traffic.

### 14.2 Capacity risks to measure

1. Worker requests from visitor bursts plus web/jobs autosave and staging traffic. The final publication request budget remains unknown.
2. D1 reads for dense collections, writes for string pieces/cleanup, and storage for retained staging. Existing stress evidence can exceed Free even when CPU passes.
3. Resend's daily email allowance and shared Queue operations for publication, contact and GitHub work.
4. Invocation CPU and API-call limits in the final dispatcher, renderer and new owner handlers. Completed spikes do not establish these later budgets.

### 14.3 Alert thresholds

Planned alerts log and notify the operator at 60% of daily Worker requests, any `exceededCpu` outcome, 80 emails/day, 50% of daily D1 writes, any failed publish, and before D1 reaches 350 MB per the bounded-save storage model. Observe D1 row reads as well as writes. These operational alerts are not implemented yet.

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
| S-1 | Publish render work fits the CPU budget on Free | Whole-page local rendering failed; bounded rendering/storage were tested in S-8 | [S-1 revision](../specs/2026-10-15-publish-render/results.md) remains required. S-8 rejected the unbatched dispatcher; measure the final renderer with Queue/D1 batching before Phase 24. |
| S-2 | Next.js hot APIs fit the CPU target | Original OpenNext and later thin full-body saves failed. Phase 11A introduced bounded operations; [Phase 13](../specs/2026-10-17-revision-aware-drafts/results.md) implements and measures the production handlers. | Keep the named Hono/jobs entry and current bounded/streamed protocol. All 22 original Phase 13 provider cases met warm p95 below 10 ms in LHE, with recorded tail/cold and D1-cost limits. The [Phase 14 investigation](../specs/2026-10-18-shared-autosave-recovery/performance.md) records the initial KHI failure and bounded-read follow-up; retain location limits before dependent activation. New publish/owner handlers still need measurement; no paid-plan assumption. |
| S-3 | Wildcard Worker route coexists with the R2 custom domain and the apex | [Deployed October 15 evidence](../specs/2026-10-15-host-routing/results.md) passes apex/www, wildcard/reserved/invalid hosts, private R2 fixture boundaries and TLS. Explicit assets no-script exception works | Serving assets through `site` would add Worker requests and require a revised budget |
| S-4 | Static asset requests do not count toward the Workers request limit | [Deployed asset-first measurements](../specs/2026-10-15-host-routing/results.md) report no Worker invocations for existing build files or R2 asset hits/misses. Next.js documents and missing build files invoke Workers. Adaptive counts are approximate | Preserve asset-first handling; remeasure worker-first changes. Paid requires owner approval |
| S-5 | Better Auth on workerd/D1: per-request init, cookie cache, `__Host-` cookies, account-linking behavior vs AC 2.2 | [October 15 local evidence](../specs/2026-10-15-auth-behavior/results.md): 26 provider-fixture/Chromium checks pass. Adopt exact apex/Origin guards, verified-only linking, and the documented cookie configuration. Copied cache cookies survive D1 sign-out for up to 300 seconds; require uncached checks where immediate revocation matters. Live provider applications and deployed callbacks remain to verify | Custom Arctic-based auth (already evaluated as the alternative) |
| S-6 | GitHub scopes and private-contribution semantics, token revocation detection | [October 15 fixture and live evidence](../specs/2026-10-15-github-permissions/results.md): 40 workerd/D1/Web Crypto checks pass. Separate narrow-scope apps, matching-account projection, both profile-visibility settings, grant deletion, independent sign-in, and external-revocation detection pass. Visibility-off public/authorized totals are 425/818. The owner approved Phase 06 completion on October 15 with the separate no-scope platform credential check explicitly untested (AC 9.10). Phase 11C [completed the check live](../specs/2026-10-16-github-platform-credential/results.md) on October 17: the separate no-scope credential accepts the 425/0 public baseline, its restricted counts make the baseline unavailable when private contributions are shown, and invalid credentials are platform retry, never owner reconnect | Revisit provider/query strategy if live checks fail; private activity cannot be deferred under the agreed MVP |
| S-7 | Resend: domain verification (SPF/DKIM) and the 100/day cap against all email types | Verify domain; send each email type; confirm budget guard | Upgrade to Paid and use Cloudflare Email Service |
| S-8 | Workflows on free: step CPU, step count, concurrency | [October 15 experiment](../specs/2026-10-15-workflow-assets/results.md): concurrent three-page candidates, bounded R2 assembly, retries and atomic commit; deployed three-page stress hits the per-invocation API cap; daily step budget fails even for 30 near-limit single-page portfolios | Validate Queue plus D1 task state with measured batching and full CPU/operation budgets before Phase 24. No naive per-fragment Queue substitution or paid upgrade |
| S-9 | CDN purge-by-URL removes withdrawn assets promptly (AC 4.14) | [October 15 live evidence and cache policy requirements](../specs/2026-10-15-workflow-assets/results.md). Origin deletion alone leaves CDN HITs; purge acceptance is not completion | Correct browser TTL and query cache-key policy, verify observed absence, and use short edge TTLs for withdrawable assets before Phase 26 |
| S-10 | `.site` availability on Cloudflare Registrar | Owner already registered hasaweb.site through Porkbun; RDAP and active Cloudflare full-zone/delegation evidence recorded October 15 | External-registrar alternative is in use. No purchase or transfer performed by the spike |

---

## 16. Confirmed answers and design follow-up

The architecture interview resolved Q-1 through Q-6. The owner confirmed these decisions on October 13, 2026.

| ID | Topic | Confirmed decision |
| --- | --- | --- |
| Q-1 | Subdomain after account deletion | Reserve every published address permanently. Retain only its name after cleanup. A held but never published reservation is released. Block public and owner access immediately and retry cleanup until complete. See section 8.7. |
| Q-2 | Case study URLs | Use `/projects/{slug}` with the generation rules in section 8.3.1. Freeze each slug on first publication. A published deletion frees it for reuse within the portfolio. |
| Q-3 | Themes, fonts, and decorations | The owner approved six named presets, three fonts, the imported cat/hands pair, defaults and playback policy on October 17, accepting the documented generator exception. See the [catalog decision](appearance-catalog.md). |
| Q-4 | Operator account email access | Allow access through an authenticated operator script for abuse follow-up. Require a case reference and record each lookup without the email. Retain audits for 90 days or until account deletion. See section 11. |
| Q-5 | Public Suffix List | Submit `hasaweb.site` after launch. Submission acceptance is not a launch prerequisite. |
| Q-6 | Verification settings | Use the confirmed settings in section 13, including automated browser and viewport tests and provider fixtures. Exclude real-device and assistive technology checks. |

The October 16 [onboarding agreement](onboarding.md) adds confirmed decisions D-13 through D-15 and the flows in section 8.0. D-15 was amended on October 21, 2026: the address is reserved on the confirmed Address save and claimed on first Publish. ADR-19 records that decision. No onboarding behavior decision remains open. The catalog, prerequisite migrations, provisioning and draft APIs are implemented through Phase 13. Remaining client/UI, handoff/routing and publication integrations require their phase specs and evidence; foundation completion does not complete the guided journey.

---

## 17. Decision log

| ID | Decision | Alternatives considered | Why |
| --- | --- | --- | --- |
| ADR-1 | Next.js via OpenNext on Workers (D-4) | Cloudflare's `vinext` (Wrangler's current auto-configuration target), Astro, React Router | Your preference; OpenNext supports Next.js 16. Revisit if the adapter lags. |
| ADR-2 | Pre-render at publish, thin serve Worker (D-5) | Per-request SSR; client-side render from JSON | 10 ms CPU makes SSR risky; pre-render gives real SEO and social metadata (AC 17.2) and makes atomic publish a pointer flip. |
| ADR-3 | D1 for publish pointer and live state; KV unused | KV pointer | KV allows only 1,000 writes/day on free. |
| ADR-4 | Canonical JSON draft with revision CAS and bounded change/staging protocol | Normalized component tables; rejected full-body hot saves | Atomic canonical content/progress, one row write for ordinary patches; large changes add private preparation, pieces and cleanup. Phase 13 is the current HTTP contract. |
| ADR-5 | Original Workflows publish choice requires S-8 revision; validate Queue/D1 dispatch before publication | Unbatched Workflows; naive per-fragment Queues | Bounded steps work locally, but daily step allowance fails the planned worst-case volume. Do not infer fresh CPU budgets from durable step boundaries. Queue batching still needs measurement. |
| ADR-6 | Three R2 buckets (draft private, sites private, assets public) | One bucket with prefixes | Hard isolation of drafts (AC 13.7); public bucket needs no Worker, saving requests. |
| ADR-7 | Markup-only components plus one vanilla `site.js` | Hydrate React on published pages | Zero React on visitor devices; faster pages; same behavior in preview. |
| ADR-8 | Transactional outbox for contact delivery | Send inline from the request | Honest "accepted" semantics, retries, and survival of Queue retention limits. |
| ADR-9 | Live GitHub data outside snapshots; hybrid refresh (D-8) | Bake into HTML; refresh all on a schedule | Meets revoke-without-publish (AC 9.9); scheduled refresh for all would exhaust Queue and cron limits. |
| ADR-10 | App on the apex with host-only cookies; no owner scripts on portfolio pages | Separate app domain | Fewer domains; risk contained because portfolio pages execute only our code. |
| ADR-11 | `EmailProvider` adapter with Resend now (D-6) | Cloudflare Email Service now | Cloudflare sending requires Workers Paid; the adapter keeps the swap trivial. |
| ADR-12 | Client-side image crop and re-encode | Cloudflare Images transformations; server-side processing | No CPU or quota cost; strips EXIF; matches "saved crop equals published crop". |
| ADR-13 | Better Auth with Drizzle (D-7) | Auth.js, custom Arctic | Your preference; first-class account linking rules; D1 support. |
| ADR-14 | Local + production only (D-11) | Add staging | One wildcard TLS level on free; staging would need another domain. |
| ADR-15 | Required initial setup, optional content, permanent first-editor milestone | Fully skippable onboarding; rerunning onboarding after editor entry | Owner's October 16 interview decision. Guide address/profile/links before editor access, then retain all later editing in the editor. |
| ADR-16 | Shared canonical draft plus private progress and a mirrored reserved address | Replay a separate answer document; save the address into the unique claimed-subdomain column | Preserve revisions/partial content, prevent duplicate preparation, and keep the publish-only address column unambiguous. |
| ADR-17 | Store only finished crops | Retain original sources and durable crop settings | Owner confirmed existing cropped-asset approach. Reset uses local selection and later uncropping requires reselecting the source. |
| ADR-18 | Display-only renderer projection with shared React markup and bounded fragment boundary | Transport PublicContent directly; introduce a custom markup event language; whole-draft hot SSR | Contact recipient configuration remains private, both hosts share markup, and oversized units remain an explicit preparation prerequisite. The offline fixture helper establishes parity without claiming publication feasibility. See Phase 16 protocol/results. |
| ADR-19 | Reserve the address on the confirmed Address save, convert the reservation to the permanent claim on first Publish, and hold it for the life of the account | Unreserved selection with a first-Publish race; a fixed hold expiry | Removes the onboarding-to-publish race: the losing owner sees an unavailable name at the first setup step instead of after building a site. The account-lifetime hold is the accepted cost of that guarantee; dormant-account reclamation can release holds later without changing the selection contract. Owner decision October 21, 2026. |

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
