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
| `site` | Resolves claimed `*.hasaweb.site` hosts and the public asset host through the active version's manifest, streams R2 files, denies unknown/unpublished hosts. Serves `/_/github.json` and `/_/contact`. Imports no React. |
| `jobs` | Named Hono `OwnerApi` for every hot owner route (provisioning, drafts, progress, recovery, address, publication, GitHub), the bounded publication dispatcher, Queue consumers and cron. Its default HTTP entry exposes no owner routes. |

Keeping hot owner APIs out of OpenNext is deliberate: measured OpenNext handlers and whole-document 1 MiB saves exceeded the CPU budget. Do not add whole-draft parsing, validation or serialization to a hot path.

### Hostnames

| Hostname | Target |
| --- | --- |
| `hasaweb.site` (and `www` → redirect) | `web` |
| `assets.hasaweb.site` | R2 public bucket custom domain, excluded from the wildcard route |
| `*.hasaweb.site` (one label) | `site` |
| `mail.hasaweb.site` | Resend sending domain |

Platform-reserved names (`www`, `app`, `api`, `assets`, `mail`, `admin`, `status`, `docs`, `blog`, `help`, `support`, `static`, `cdn`, `demo`, plus a brand deny-list) live in a code constant and the `reserved_subdomain` table.

The entry page's example portfolio is a real published site at `example.hasaweb.site`, owned by the internal account `internal-example`. Migration `0022` creates that account with no sign-in provider and an `internal-example@hasaweb.invalid` email, so nobody can sign in or be linked to it, and moves `example` from the reserved list to that portfolio's address hold in one step, so no owner can take it. `pnpm example:publish` (`scripts/example-portfolio`) fills and publishes it through the same routes an owner's browser uses: private uploads, revisioned patches, the setup handoff, then publication start, status and commit. Its only operator privilege is inserting a 15-minute session for that account (signed with `BETTER_AUTH_SECRET`), which it deletes when the run ends. The first run claims `example` permanently; later runs republish.

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
| Publication tables | Candidates, tasks, pages, version index, retained-version references, admission slots, publish versions and receipts (migrations `0007`–`0014`), and one `publication_withdrawal` cleanup per Unpublish (`0020`). See [`packages/db`](../packages/db/README.md#immutable-candidate-delivery). |
| `owner_save_attempt`, `owner_save_piece` | One expiring private staged attempt per owner and its ordered string pieces. |
| GitHub (`github_connection`, `github_activity`, `github_grant`, `github_legacy_credential`, `github_refresh`, `github_published_activity`, consent attempts) | Generation-checked, encrypted, coordinated per app/account. See [GitHub](#github-activity). |
| `contact_recipient` | One private recipient per portfolio: address, `verified_at`, and a pending link's SHA-256 token hash and expiry. Never in drafts, publication facts or output. |
| `email_reservation`, `email_dispatch` | Shared email budgets (migration `0018`): one row per accepted email and per provider attempt, no addresses or content. Triggers enforce the allowances in [Contact form](#contact-form-phases-4345). |
| `contact_outbox`, `counter` | Transactional outbox (one row per accepted message or test, keyed by its reservation ID, with attempts, lease, final state and the owner notice's state) and fixed-window visitor limits (`contact:{portfolio}:{hashed visitor}` per UTC hour). |
| `operator_email_audit` | Phase 51: one row per operator email lookup (operator handle, account ID, case reference, time), never the email. Kept 90 days, and cascades away with the account. |
| `maintenance_cursor` | Phase 51 (migration `0023`): resumable positions of bounded cleanup passes. No owner data. |
| `account_deletion` | Phase 49 (migration `0021`): one durable cleanup per deleted account, with no foreign keys so it outlives the owner's rows. See [Unpublish, delete, suspend](#unpublish-delete-suspend-phases-48-49-51). |

### Draft document

The schema lives in `packages/schema`. Shape: `schemaVersion`, optional `requestedSubdomain` (private mirror; the namespace row is authoritative), fixed `profile` (name, bio, location, avatar, banner, `decorationId`, `faceReveal`), `links` (one list for both profile and social component placement), ordered `components` (`{ id, type, version, data }`), `appearance` (`themeId`, `customColor`, `fontId`, `colorMode`), `seo`, and `samples` (fields still holding untouched sample content).

- Draft validation allows unfinished content; publication checks are separate and also check authoritative asset/provider records.
- URLs ≤ 2,048 UTF-8 bytes, email addresses ≤ 254 bytes, `seo.title` ≤ 70 and `seo.description` ≤ 160 characters, whole draft ≤ 1 MiB. Longer stored values need explicit correction, never truncation.
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

Sign-in is GitHub or Google at `/sign-in`. GitHub requests only `user:email`; Google its default identity scopes. Accounts auto-link at sign-in only on a provider-verified matching email, and never for a provider the owner disconnected; missing or unverified emails never merge owners. The HTTP surface accepts only social sign-in, linking, sign-out, session lookup and the two callbacks; no passwords, arbitrary scopes or callback destinations.

**Connected sign-in methods** (Phase 47). The editor's account menu, opened from the avatar on the rail or the mobile dock, lists GitHub and Google. A link return (`/editor?account=…`) opens the menu with the outcome. An owner has at most one account per provider (a Better Auth account hook refuses a second one, and any account for an owner being deleted).

- Connect: `POST /api/auth/link-social` accepts only `{provider, callbackURL, errorCallbackURL}` with the fixed returns `/editor?account=connected` and `/editor?account=not-connected`, from a signed-in owner (uncached check) who has not connected that provider (409 `already_connected`). Completing the provider's OAuth flow in the same browser is the proof of ownership. The provider account's email must be provider-verified. A GitHub account may use a different email; a Google account must use the account email (`user.validateUserInfo`, error `email_does_not_match`). An account already linked to another owner is refused.
- `GET /api/owner/providers` returns `{providers: [{provider, connected}]}`, no identities or emails.
- `POST /api/owner/providers/disconnect` accepts `{provider}` with a matching `X-Expected-Owner-Id`. It returns 409 `last_method` rather than remove the last sign-in provider; the check and delete are one statement, so concurrent disconnects leave one. Disconnecting GitHub first runs the GitHub private-activity withdrawal (`withdrawPrivateActivity`, then the cleanup sweep): private output goes at once, the grant is revoked, and the public graph stays. If the withdrawal cannot commit, sign-in is kept and the owner retries. Reconnecting restores no grant; private activity needs new consent. Activity consent and its withdrawal never add or remove a sign-in provider.
- Disconnecting records the provider in `disconnected_provider` (migration `0020`), in the same batch as the delete. While that row exists, signing in with the provider never links it again by matching email; the callback fails with `unable_to_link_account` and creates nothing. Connect from settings removes the row. Rows go with the user.

Cookies are host-only. HTTPS uses `__Host-hasaweb` cookies (Secure, HttpOnly, SameSite=Lax, Path=/, no Domain); only loopback HTTP uses non-Secure `hasaweb-local` cookies. The Better Auth cookie cache (300 s) is kept for status endpoints, but every owner/editor authorization performs an uncached lookup plus repository access checks, so sign-out and deletion take effect immediately.

Owner routes:

- `GET /api/owner` returns owner ID, name and optional portfolio ID, never email. `?include=email-suggestion` and `?include=profile-suggestions` are explicit opt-in reads that require `X-Expected-Owner-Id`; reading or dismissing a suggestion changes no draft.
- `POST /api/owner/portfolio` and `POST /api/owner/entry` accept only `{}` (≤1,024 bytes). Provisioning inserts one private portfolio once (`portfolio-v1`, Leaf/DM Sans/system, empty fields, no decoration, Face Reveal off, progress at Address, no milestone) and never rewrites it. Provider identity is never copied into public content automatically.
- `/api/owner/entry` returns `entry: setup` (revision and saved progress) or `entry: editor` (revision and milestone timestamp).

Post-auth destinations are fixed: `/auth/entry` for normal sign-in and signed-in `/sign-in` visits, and the pair `/auth/recovery` + `/auth/recovery/error` for same-tab draft-recovery sign-in. Arbitrary return URLs and mixed pairs are rejected.

**Owner-entry gate.** `/auth/entry` and `/editor` mount the real guide and editor only when the web Worker has `OWNER_ENTRY_ACTIVATION=active` (`apps/web/lib/owner-entry-gate.ts`). Committed configuration leaves it closed, so both routes render the welcome shell. It opens after the contact-delivery integration (Phases 43–45). With the gate open, `OwnerEntry` follows only the persisted entry answer: owners without the milestone get `SetupGuide` at `/auth/entry` (and `/editor` sends them there); entered owners get the editor at `/editor`.

**Setup check and handoff.** `POST /api/owner/setup/check` and `/setup/handoff` accept exactly `{portfolioId, revision}`, run in web (so private image objects can be resolved without giving jobs bucket access), and require an uncached session, exact Origin, JSON and matching `X-Expected-Owner-Id`. Required setup means: generation-2 draft at that revision; non-sample name and bio, with the bio at most 160 characters (`BIO_MAX`; the draft schema still accepts a longer one); ready, owned, correctly purposed avatar and banner whose objects exist with the recorded size; at least one valid labeled link shown in the profile; the mirrored address matching this portfolio's `held` row and not platform-reserved; no open staging. Handoff rechecks all of this in one conditional update, sets the milestone once and is idempotent. Later removal of required content blocks Publish only; it never reruns onboarding.

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
- Account deletion writes an owner tombstone at key `[ownerId]` in the same IndexedDB transaction that removes the owner's whole `[ownerId, …]` range, and every record write checks it in its own transaction, so a late write from any tab is refused instead of recreating data (see [Unpublish, delete, suspend](#unpublish-delete-suspend-phases-48-49-51)).
- After handoff, setup recovery can contribute explicitly selected content to a fresh content scope; it never replays progress or converts setup attempts.
- Local recovery cannot promise cross-device recovery of invalid or unuploaded input.

### Uploads

[Protocol](../apps/web/lib/assets/README.md). JPEG/PNG/WebP up to 5,242,880 bytes, PDF up to 10,485,760 bytes. The client validates, crops, resizes and re-encodes images on a canvas (stripping EXIF). `PUT /api/assets` streams to the draft bucket after purpose, signature and actual-byte checks; the asset becomes `ready` only after complete validated bytes and a repeated persisted authorization check. The draft references an asset only once it is ready, so a failed replacement leaves the previous asset in use. Abandoned and unreferenced uploads are collected later (Phase 51, see [Operations](#9-operations)). Only finished crops are stored; no source images or crop metadata. Provider photos are fetched server-side from the approved GitHub/Google hosts (`GET /api/assets/provider-photo`), then cropped and uploaded like any file.

### Address reservation and claim

- Availability checks reserve nothing. A confirmed Address save inserts an exclusive `held` row for the portfolio and updates the `requestedSubdomain` mirror in the same D1 batch as the revision CAS, with a durable `address_confirmation` receipt.
- Changing the address before first Publish deletes the current `held` row and inserts the new one in that same atomic batch. Any constraint or CAS failure aborts everything; the old hold and draft remain. Generic, staged and legacy saves never reserve.
- First Publish verifies the portfolio still holds the name, rechecks the platform list and converts the row to `claimed` in the pointer transaction. No fresh availability race.
- The hold lasts for the life of the account. The account deletion request deletes held rows, so a never-published name is free at once, and clears `portfolio_id` on claimed rows, which keep the name permanently as ownerless claims.

### Publication

Implemented end to end locally; owner routes are `POST /api/owner/publication/*` (start/status/commit, case-study slugs) in jobs.

1. **Admission.** The client flushes autosave, rejects unfinished input/uploads/recovery, pauses the controller and checks readiness at one confirmed revision. `publicationTasks.create` validates the revision, blocks open save attempts and captures only included public fields (no samples, setup data, hidden links, disabled Face Reveal photos or contact recipients). Readiness checks share rules between the editor checklist and the server: required profile/link facts, included component rules, catalog membership, ready owned assets, GitHub fetch state, address hold/claim.
2. **Preparation.** The bounded dispatcher (Queue + D1 tasks) renders through the shared renderer in bounded fragments with streamed assembly, transfers referenced private uploads through the named web entry, and writes a complete private candidate: documents, sanitized snapshot, selected platform files and a hashed manifest. Oversized valid content returns `needs_partitioning`; it is never truncated.
3. **Commit.** One guarded D1 batch verifies the expected state, converts the hold to a claim on first Publish (or verifies the existing claim), moves `published_version`, marks the new version live and records a durable receipt. A retry of a committed publication returns the receipt; a delayed retry can never restore an older version.
4. **Cleanup.** A checkpointed operation scans superseded manifests in batches of eight, deletes removed public uploads, verifies absence and keeps private assets and unchanged retained files.

Failure before commit leaves the pointer and namespace row untouched. After commit, cleanup failure reports that the new version is live and offers Retry. Its final homepage check runs only while the portfolio is still published; after Unpublish that withdrawal verifies absence instead. `PUBLICATION_RENDERER_VERSION` is `publication-v8`; retain content-hashed platform files so old versions keep working.

**Search and sharing metadata.** `resolveSeo` (`packages/schema`) is the one rule for the editor's sharing preview and Publish: an owner override wins, otherwise the title is the profile name, the description is the bio clipped to 160 characters on a word boundary, and the image is a generated profile card. Finalization reads bounded prefixes of the sealed source and writes each page's `<title>`, description, canonical URL, Open Graph tags and `twitter:card` into its immutable document. Case studies are titled `{project} · {name}` and `/resume` `Resume · {name}`. The sharing image is the version's published asset URL on the asset host, so it stops serving when a later version drops it.

**Generated sharing card.** Without an owner sharing image, a `card` finalization stage renders `SharingCard` (`packages/components`) to a 1200×630 PNG with satori and resvg-wasm and records it as the version's public asset `/assets/sharing-card`. It shows the banner, avatar, a still of the selected decoration, name, bio, location and up to five profile links in the saved theme, font and starting mode (System uses the light tokens). Inputs are the version's transferred uploads (WebP is decoded with `@jsquash/webp` and re-encoded as PNG; undecodable bytes leave that area blank), the selected font from the platform pack and the committed decoration stills that `pnpm generate:sharing-card-art` captures from the real avatar markup. Text uses only the theme font, so characters it lacks (Arabic, for example) draw as missing-glyph boxes. The card is retained, served, superseded and cleaned up like any other public asset of its version. Workers cannot compile WebAssembly at runtime, so the jobs Worker imports every module precompiled: `apps/jobs/scripts/extract-satori-wasm.mjs` writes satori's embedded HarfBuzz shaper (pinned by hash) and its one emscripten callback wrapper when `pnpm install` runs (the files are not committed), and `src/satori-prelude.ts` hands those modules to satori. `robots.txt` allows everything and names the sitemap; `sitemap.xml` lists every page of the version.

**Case study URLs.** `/projects/{slug}`: lowercase ASCII letters, digits and hyphens, ≤80 characters, `project` when empty, collisions get `-2`, `-3`… Slugs follow the title until first publication, then freeze. A deleted case study keeps its slug reserved until the deletion is published; the `case_study_url` check rejects drafts that change a frozen slug or take another project's live slug.

### Visitor serving

`site` accepts one label before `hasaweb.site`, does one D1 lookup and serves only `published` portfolios (everything else gets the generic unavailable page). Paths resolve through the active manifest; arbitrary bucket keys and private snapshot files have no route. A path missing from a published portfolio's manifest returns that version's `/404`, which carries `noindex` in its markup and `X-Robots-Tag`. Published pages carry no robots directive, so they are eligible for indexing; previews, setup Review and owner routes stay `noindex` and `private, no-store`. Resume PDFs are served from `assets.hasaweb.site/candidate/{id}/assets/{assetId}` with `Content-Disposition: attachment`; `/resume` embeds a `/view` variant framable only by the portfolio host. Each response comes wholly from one version.

**Withdrawal (S-9).** Origin deletion and an accepted purge did not remove cached copies in the deployed test. Until deployed browser/edge absence is observed, every served file is `Cache-Control: no-store` and `CDN-Cache-Control: no-store`, query variants map to the same manifest entry, and cleanup completes only after verifying 404, no-store and no stale hit. Changing this cache policy requires new withdrawal verification.

### GitHub activity

Contracts in [`packages/github`](../packages/github/README.md) and [`packages/db`](../packages/db/README.md#github-generations-and-cleanup).

- Counts never enter snapshots. Publication freezes the graph configuration (stable account ID, username, `includePrivate`); `site` reads only that record for the active version and serves `/_/github.json` (`no-store` until S-9). Published pages carry a placeholder that the platform script fills.
- Every graph is one authorized account, public and private. The draft records `includePrivate: true`; publication needs the authorized calendar.
- Public calendars use a zero-scope platform token (`GITHUB_SERVICE_TOKEN`). They resolve typed usernames and are the fallback after access is withdrawn. Platform failures never ask the owner to reconnect. Zero contributions succeed.
- The graph is the owner's GitHub sign-in account. Sign-in asks for `read:user` and `user:email`, and Better Auth stores the token encrypted (`encryptOAuthTokens`). `POST /api/owner/github/connect` (empty body) decrypts it with `BETTER_AUTH_SECRET`, reads GraphQL `viewer`, requires `read:user` with at most `user:email`, selects that account and stores the token as the graph's grant for the sign-in app (`GITHUB_CLIENT_ID`), re-encrypted with `GITHUB_ACTIVITY_KEY`. A missing, refused, undecryptable or under-scoped token answers 409 `reauthorize` and is never stored. Google owners without GitHub use `link-social` (Connect GitHub) so a sign-in account exists first.
- When the sign-in token cannot be used, the owner authorizes that same account with the separate activity OAuth app: `POST /detect` resolves the linked account's login, `POST /setup` selects it, then consent uses `read:user`, S256 PKCE, one-use ten-minute state stored as a hash and bound to user and session; selected stable account ID and username must match. Wrong-account or wrong-scope tokens are revoked.
- Cleanup revokes each grant with the credentials of the app that issued it, sign-in or activity. Revoking the sign-in app's grant also invalidates the token Better Auth holds; the next connect then asks to authorize on GitHub.
- Serve either the public calendar or the complete authorized calendar (which already includes public contributions). Never sum or subtract.
- Every write is generation-checked, so a stale refresh or callback cannot restore removed private data or withdraw a newer grant. Grant-wide revocation is serialized with new consent per app/account; consent waits for pending or in-flight cleanup. Unknown legacy credentials block reconsent until reconciled.
- Removing the graph, or disconnecting GitHub sign-in, withdraws private output immediately without Publish and queues durable revocation (run at once and by cron). Skip keeps an added graph and its grant; skipping a sign-in graph that was never added withdraws it.
- Refresh needs no Publish: a visit or owner status read past the six-hour TTL, or the daily private sweep (25 connections per tick), records at most one request per 15-minute window and sends one `GITHUB_QUEUE` message. Failures keep the last good graph and show Retry; a 401 withdraws private data and asks to authorize again. After a draft account switch, the published account's public calendar stays live until the next Publish.

### Contact form (Phases 43–45)

**Email adapters** (`packages/email`). `EmailProvider.send(email, idempotencyKey)` returns accepted, retry, quota or rejected, never provider text. `emailProvider(env)` picks `ResendProvider` when `RESEND_API_KEY` and `EMAIL_FROM` (the fixed sender on `mail.hasaweb.site`) are set, otherwise the console sink in `local`/`test` and no provider (sending unavailable) elsewhere. `RESEND_API_ORIGIN` points the Resend adapter at a stand-in, honoured only in `local`/`test`. Emails are plain text, one recipient, no header injection.

**Recipient** (Phase 43). The contact form needs the portfolio's recipient to be verified; the draft carries no address (`data.recipientId` is legacy and stripped from publication). Owner routes in jobs, all requiring `X-Expected-Owner-Id` because they return the owner's own address:

- `GET /api/owner/contact/recipient` returns `{recipient: null | {email, state: verified|pending|unverified}, accountEmail}`. `accountEmail` is the account email only when the provider verified it.
- `POST /api/owner/contact/recipient/account` with `{}` makes that account email the recipient, verified at once, with no email.
- `POST /api/owner/contact/recipient` with `{email}` (≤254 bytes) sets another address, clears verification and sends a link `{APP_ORIGIN}/settings/contact/verify#token=…` valid for 24 hours. The token is 32 random bytes; only its hash is stored. Re-requesting the verified address, or the verified account email, sends nothing.
- `POST /api/owner/contact/recipient/verify` with `{token}` confirms the pending address of the signed-in owner only. The page reads the token from the fragment and confirms on an explicit click, so link scanners cannot confirm by opening it.

Errors are closed codes and include the current status: `invalid_email` 422, `account_email_unverified` 409, `limited` 429, `unavailable` 503, `delivery_failed` 502, `invalid_token` 409, `expired_token` 410. Changing the address takes effect immediately, not on Publish, and blocks form publication until confirmed; publication tickets include `verified_at`, so a change during publishing invalidates it. Recipient settings live in the editor's contact form panel.

**Budgets** (UTC days, enforced by D1 triggers so concurrent requests cannot exceed them). Acceptance: 90 contact messages in total, ten per portfolio, two of them tests; ten owner notices in total (verification and final-failure notices share them), three verifications per portfolio. A notice over the allowance is deferred, never sent. Provider attempts: 100 a day (90 contact, 10 notice) and 3,000 a month, charged per attempt on the dispatch day, so cross-midnight retries stay inside the provider cap. Every send reserves acceptance, then the attempt, then calls the provider. Replayed IDs are not charged twice.

**Submissions** (Phase 44). Published pages render the form (`form[data-contact-form][data-contact-source="/_/contact"]`); preview markup has no source and only shows a preview-only notice. The platform script reads `GET /_/contact` (`{siteKey}`, or 404 when the active version has no form), loads Turnstile explicitly and posts same-origin JSON `{name, email, message, token}` (≤32 KiB). `site` (`apps/site/src/contact.ts`) then checks, in order: exact portfolio `Origin` and JSON (403/415/413/400 `invalid_request`); fields (422 `invalid_fields` with `{field: required|invalid|too_long}`; name ≤100 characters, email ≤254 bytes and one plain address, message ≤5,000 characters, shared with the browser in `packages/components/src/contact.ts`); that the claimed host's live version sealed `$.contact` (404 `unavailable`); five complete attempts per visitor per portfolio per UTC hour, blocked ones included (429 `limited` with `Retry-After`; the visitor key is a truncated SHA-256 of portfolio and `CF-Connecting-IP`); Turnstile siteverify (403 `blocked`; outside local/test the token's hostname must be the portfolio host and its action `contact`; Turnstile failures are 503 `unavailable`). Finally one D1 batch inserts the contact reservation and the `queued` outbox row (payload `{name, email, message, recipientVerifiedAt}`, deadline 24 hours) only while the portfolio is still published with a form and its recipient is verified. The allowance trigger aborts the whole batch (429 `limited`); an unverified recipient or a concurrent unpublish inserts nothing (503 `unavailable`). Only then does the endpoint return 202 `{status: "accepted"}`, and only 202 shows success. D1 errors return 503 `failed`. Responses are `no-store` and never contain the recipient. `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` and the local/test-only `TURNSTILE_VERIFY_ORIGIN` live on `site`.

**Delivery** (Phase 45, `packages/db/src/contact-delivery.ts`). After the 202, `site` sends `{outboxId}` on `CONTACT_QUEUE` in the background; the jobs consumer makes the first attempt, and the jobs cron sweep (every minute, ten attempts and five notices per tick) makes retries and recovers lost messages, so the queue is only a wake-up. Attempts are due at acceptance and 5 min, 30 min, 4 h and 24 h after it, at most five. A provider `Retry-After` longer than the slot is honoured if it stays within the 24-hour deadline; otherwise, after the fifth attempt, or on a permanent error, the message fails. A worker claims an attempt by moving the row to `sending` under a two-minute lease; a lease that runs out (an interrupted worker) makes the row due again, and an interrupted fifth attempt fails, as does a row still queued an hour past its deadline (no provider, or the sweep was down). Each attempt is charged to the dispatch budget before the provider call; a refused dispatch allowance does not spend the attempt and waits until it reopens, or fails if that is past the deadline. Every attempt of a message uses idempotency key `contact/{id}` and Reply-To the visitor. A message goes to the recipient confirmed at the time of the attempt. While the owner is confirming a new address the message waits, rechecking every 5 minutes without spending an attempt, and fails at the deadline if no address is confirmed by then; a suspended portfolio or an account being deleted fails it without a provider attempt. The payload's `recipientVerifiedAt` is recorded at acceptance but does not route delivery. Sent and failed rows lose their payload.

Final failure of a visitor message owes the owner a notice, to the provider-verified account email or else the verified recipient, with no message content. It is charged to the shared notice allowance; over it the notice is `deferred` until the next UTC day, never sent early. It gets three attempts. Owner routes in jobs, both requiring `X-Expected-Owner-Id`:

- `GET /api/owner/contact/delivery` returns `{delivering, test: null | {state: delivering|sent|failed, acceptedAt}, failures: [{acceptedAt, failedAt, notice: pending|deferred|sent|failed}]}` (visitor messages that failed in the last 30 days, at most ten). No addresses or content.
- `POST /api/owner/contact/delivery/test` with `{}` inserts a test reservation and outbox row (two a day per portfolio, needing only a verified recipient, not a published form), makes the first attempt inline and returns the status plus `outcome: sent|retrying|failed`. Errors: `no_recipient` 409, `limited` 429, `unavailable` 503. Tests retry like visitor messages but owe no notice.

The editor's contact form panel shows Send test message, its outcome, messages still being delivered and the undelivered list with each notice's state. Preview forms never send. The recipient address never appears in public HTML or data.

### Unpublish, delete, suspend (Phases 48, 49, 51)

- **Unpublish** (Phase 48). After confirmation, `POST /api/owner/publication/unpublish` sets `status = unpublished` with one guarded update, so `site` stops serving the pages, case studies, resume, assets, `/_/github.json` and `/_/contact` at once, and records a `publication_withdrawal` in the same batch. That durable cleanup (queue wake `{withdrawalId}`, plus the cron sweep) deletes every public-bucket object of the versions published up to then, purges both hosts and verifies under the S-9 policy: removed upload URLs and their query variants return 404 with no-store and no stale hit, then the portfolio root does while it is still unpublished. A repeated request returns the same state and records no second cleanup. The draft, `subdomain`, `published_version`, frozen case-study slugs and the `claimed` address row remain; claims are permanent, so no other account can reserve or claim the name. Private page output of retained versions stays in the sites bucket and has no route. `POST /api/owner/publication/site` returns `{portfolioId, status, url, withdrawal}` for the editor. Republishing is an ordinary Publish whose commit expects `unpublished` and the retained version, and serves at the same address; a publication still in flight when the owner unpublishes fails as `stale_publication`.
- **Delete** (Phase 49). Delete account in the account menu opens a confirmation (Figma "Delete your account permanently?") that lists what goes, including the address outcome; Keep my account (the focused default) and Escape change nothing. `POST /api/owner/account/delete` requires `{"confirm":"delete-account"}` and a matching `X-Expected-Owner-Id`. It first withdraws private GitHub activity through the Phase 41 path while the session still authorizes it (409 `conflict` if that cannot commit, with nothing else changed), then one D1 batch (`requestAccountDeletion`) sets `user.deleting_at` and `portfolio.status = deleting`, deletes every session, the held reservation and staged save attempts, clears `portfolio_id` on a claimed address and inserts the `account_deletion` record. Owner routes, previews, uploads and asset reads check session and deletion state uncached, and `site` serves only `published` portfolios, so a session cached on any device and every public page, asset and live endpoint stop at once. The response clears the auth cookies; a repeated request is 401.
- The cleanup (`apps/jobs/src/account-deletion.ts`, queue wake `{deletionId}` plus the cron sweep) runs one bounded stage per message and records each in D1, retrying failures with backoff: delete every public object the portfolio's candidates recorded (checking each is gone); purge the portfolio and asset hosts and verify the removed upload URLs under S-9 (deployed, published addresses only); drop the version index and hand every candidate to the dispatcher's prefix cleanup, waiting until none is linked (their anonymous tombstones keep rechecking late writes); once no upload has been active for two minutes, have the web `PublicationAssets` entry delete `draft/{portfolio}/` (its only capability is the persisted record); queue revocation of any grant activated meanwhile and delete the portfolio and user rows, which cascade to sessions, accounts, assets, GitHub, contact and publication rows; finally recheck the private prefix, verify the address serves nothing and delete the record. Email budget rows keep only the portfolio ID and day.
- In the browser, the deleting tab announces `{type: "owner-deleted", ownerId}` on the `hasaweb-account` BroadcastChannel, disposes its controllers and waits for their final local writes, then removes the owner's IndexedDB range (every portfolio, review copy, prepared replacement and continuation record) with the tombstone, its publication hints and its tab continuation. Other tabs of that owner dispose their controllers, drop their own continuation and show that the account was deleted. A per-tab marker resumes an interrupted local cleanup on the next owner entry or recovery page, which also drop a continuation naming a deleted owner. Other accounts' recovery is untouched.
- **Suspend** (Phase 51) is an operator script, with no admin UI: `pnpm ops suspend` moves the portfolio to `suspended` (with `suspended_at` and a case-referenced reason) in one guarded update, so `site` stops serving every page, asset and live endpoint at once, publication start and commit refuse it, and queued contact messages end undelivered. A portfolio that was ever published also gets a `publication_withdrawal`, the same durable cleanup as Unpublish, which the cron runs: delete the public upload copies, purge both hosts and verify absence while it is still suspended or unpublished. The draft, account and address claim stay. `pnpm ops unsuspend` returns it to `unpublished` (served again after the owner's next Publish, at the same address) or, if it never published, to `draft`.

## 7. Components, rendering and appearance

**Registry.** Data contracts live in `packages/schema`, one module per optional component; `packages/components` attaches the markup-only renderer through an exhaustive display projection. The registry is the only list of supported types: profile (fixed), projects (with case studies), skills, work experience, text sections (multiple), GitHub activity, contact form, social links, resume download.

**One renderer, two hosts** ([`packages/render`](../packages/render/README.md), [`packages/components`](../packages/components/README.md)). Markup-only React renders both the client preview and static publication output. The display projection excludes private recipient configuration, raw asset IDs, setup/recovery data and disabled second photos; callers resolve authorized assets first. Published pages ship zero React: content-hashed platform CSS and one vanilla `site.js` for theme switching, image states, Face Reveal, decoration playback and the GitHub graph.

**Preview.** The editor uses real iframe viewports (390 px and 1120 px). Display data reaches the iframe in acknowledged `postMessage` chunks; the bridge pins parent window, exact origin, channel and increasing sequence, validates data and rechecks asset origins. The bridge itself grants nothing: the preview adapters authorize the owner first. The editor's canvas outline lives inside the iframe beside the renderer's root, so the rendered markup stays what visitors get. It shows a hover outline, and the selected section's outline, tag and move up, move down and remove actions. A selection made on the canvas, in the page outline or with the keyboard crosses the bridge as one `select` message. Canvas actions return as `action` messages, and the editor checks the section ID against its draft before acting. A `scheme` message keeps the top bar's scheme toggle and the preview's own theme toggle in step. Setup Review never selects, so it shows no outline.

**Appearance** ([catalog](appearance-catalog.md), [`packages/theme`](../packages/theme/README.md)). Six presets with paired light/dark tokens, three self-hosted fonts, two decorations. Theme, font and initial mode are server-rendered attributes on `<html>` read by generated CSS. A render-blocking external platform script in `<head>` applies the visitor's stored choice (localStorage, no cookies) before first paint; there is no inline script. A custom color keeps the preset's `data-theme` and adds `data-custom-color`. The generated `themes.css` then reads the 20 `--pf-custom-{light,dark}-*` properties that the OKLCH generator produces from the seed. Publication writes those properties into a retained stylesheet, `/platform/<sha256 prefix>-palette.css`, which every page of the version links after the platform CSS. The preview sets the same properties through the CSSOM, which the strict preview CSP allows. Owners never supply CSS, and no page has an inline style.

**Face Reveal and decorations.** An enabled reveal is one native button containing both images, with a diagonal `clip-path` wipe, `Reveal face`/`Show avatar` labels and an instant switch under reduced motion. Decorations (cleaned 212×220 32-frame cat loop and still; six-second SVG/CSS hands) have an independent Pause/Play control that also works with Face Reveal off. Reduced motion shows the stills and hides the control. Disabling Face Reveal and republishing withdraws the public photo; the private draft asset stays.

## 8. Security and privacy

| Area | Measure |
| --- | --- |
| Owner content | No raw HTML, scripts or CSS. Rich text is Tiptap JSON checked against an allowlist and serialized by our code. Link schemes `https`, `http`, `mailto`; external links get `rel="noopener noreferrer"`. |
| Published CSP | `default-src 'none'`; scripts only from hashed platform files, plus `https://challenges.cloudflare.com` in `script-src` and `frame-src` on documents of a version with a contact form; images from `assets.hasaweb.site`; `object-src`/`frame-src` only on `/resume`; no inline script or style; `nosniff`, `Referrer-Policy`, `Permissions-Policy`. |
| Origins | Apex-only host-only auth cookies; portfolio pages run only our code and receive no auth cookies. Submit `hasaweb.site` to the Public Suffix List after launch. |
| CSRF | Better Auth origin checks, SameSite=Lax, exact `Origin` plus JSON content type on every mutation. |
| Authorization | Repository functions take the session user. Drafts, previews and private assets return 404 to anyone else. |
| Secrets | `BETTER_AUTH_SECRET`, OAuth credentials, `GITHUB_SERVICE_TOKEN`, `GITHUB_ACTIVITY_*`, `RESEND_API_KEY` (with the `EMAIL_FROM` variable), `TURNSTILE_SECRET` (with the `TURNSTILE_SITE_KEY` variable), cache-purge token. Never in the repo. |
| Tokens | GitHub tokens AES-GCM encrypted; deleted and revoked on withdrawal or deletion. Activity key rotation is not implemented. |
| Contact data | Payload kept only until delivered or finally failed. |
| Dev probes | `isLocalProbe` (`packages/config`) allows fixture routes only on loopback in local/test environments. Integration fixtures are built from `apps/*/integration`, never imported by production code. |
| Privacy | No visitor accounts, analytics or cookies on published pages. |

## 9. Operations

- Structured JSON logs with a request ID; counters for publish duration/failures, email budget, queue depth and `exceededCpu`. No visitor analytics.
- Fail closed when limits are hit; `site` returns 503 with `Retry-After` when D1 is unavailable.
- Backups: D1 Time Travel plus optional weekly export to private R2.
- Operator scripts (Phase 51, `pnpm ops`, [README](../README.md#operator-scripts)): find and abuse report (no email), suspend/unsuspend, rerender, cache purge, outbox inspection (no message content), audited email lookup with a case reference, audit cleanup and D1 size. They run SQL through `wrangler d1 execute`; rerender alone uses the owner routes, with a 15-minute session for the owner that it deletes afterwards, and only when the saved revision is the one the live version was built from, so no unpublished edit goes public.
- Garbage collection (Phase 51, `apps/jobs/src/maintenance.ts`) runs on every fifth cron minute, one bounded pass per task: abandoned private uploads and draft-bucket orphans (through the web `PublicationAssets` entry, the only holder of the draft bucket), dormant staged attempts, candidate cleanups that ran out of attempts, resolved GitHub coordination of deleted accounts and expired lookup audits. It never deletes an upload unfinished setup, the draft, an open staged attempt or a sealed or retained candidate may still use, never releases address holds or confirmation receipts, and keeps GitHub cleanup state until revocation resolves. Rules in [`packages/db`](../packages/db/README.md#operator-controls-and-cleanup-phase-51).
- The hourly cron logs the D1 size and `{"event":"d1_size_alert"}` from 350 MB.
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
