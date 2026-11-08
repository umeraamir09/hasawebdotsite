# Phase 42: Refresh GitHub activity independently

## Scope and acceptance

Requirements: [product section 9](../../docs/product.md#9-github-activity-graph), [acceptance criteria 9](../../docs/acceptance-criteria.md#9-github-activity-graph) (items 4, 8, 9 and 11) and the [verification prerequisites](../../docs/acceptance-criteria.md#verification-prerequisites) row for GitHub refresh and revocation, [architecture 8.5](../../docs/architecture.md#85-github-activity-product-9) and decision D-8, the [Phase 11D storage and refresh contract](../2026-10-17-github-refresh-contracts/results.md), and the [Phase 42 roadmap entry](../../docs/roadmap.md#phase-42-refresh-github-activity-independently).

Change: GitHub graphs refresh without Publish. A published-page visit past the six-hour TTL, the owner's status read past the TTL, and a daily sweep of private connections each request one background refresh. Deduplication, bounded work and stuck-job recovery come from D1, and every write is checked against the connection generation. The editor and onboarding share the same graph service.

Acceptance checks (from the roadmap entry):

- Graphs update without Publish.
- Transient failures keep the last good data and its date.
- Retry and Reconnect work.
- Revocation withdraws data on the next refresh or sweep.
- Stale responses and errors cannot restore removed access or corrupt a new grant.

Owner decisions on November 8, 2026, made before implementation in this chat:

- **Prerequisite.** The "shared job/runtime/quota checks" dependency counts as satisfied by the [paid-at-launch policy](../../docs/deployment-policy.md), with a recorded estimate (see Decisions). Paid native verification stays a release gate.
- **Visit scope.** A due visit refreshes both calendars in one message: the public calendar, plus the authorized one while the grant is active. The daily sweep covers private connections nobody visits.
- **Request window.** 15 minutes. One window covers deduplication, stuck-job recovery and the wait before retrying after a transient failure. The six-hour TTL counts from the last successful fetch.
- **Sweep scheduling.** Each cron tick requests a bounded batch, at most 25, of private connections whose authorized calendar is at least a day old. There is no dedicated daily cron expression.
- **Phase 40 gap included.** After Publish, a draft username change keeps the published account's public graph live and refreshing until the next Publish. Before this phase it showed "unavailable".
- **Editor status reads.** A status read past the TTL requests the same queued refresh.

Prerequisites: Phases 40 (approved November 8, `9770647`) and 41 (approved November 8, `a196587`) are on `main` at `0cda8bb`. Branch `feat/42-github-refresh`, worktree `.claude/worktrees/phase-42-github-refresh`, created from `main` at `0cda8bb` after `git fetch` and fast-forward. No delegated workers. `git worktree list` showed only merged phase branches, plus `fix/workers-redirect-mode` (uncommitted edits to `apps/jobs/src/publication-cache.ts` and `packages/email`). This phase touches neither.

Write boundaries: `packages/github` (refresh policy), `packages/db` (migration 0016, refresh service, transition, setup and private-refresh reuse), `apps/jobs` (queue consumer, cron sweep, status enqueue), `apps/site` (refresh-on-visit, retained-account serving), the integration jobs worker and editor harness, the persistence and browser checks, and current guidance.

## Decisions

- **D1 is the source of truth; the Queue is a trigger.** `github_refresh.requested_at` is set with one compare-and-set that succeeds at most once per 15-minute window (`requestGitHubRefresh`). The message is `{ kind: "github-refresh", portfolioId, requestedAt }` and carries no identity, token or count. `claimGitHubRefresh` sets `started_at` only when it is unset or older than the request, so one delivery per request does the work. Duplicate deliveries and superseded messages are skipped. A lost message, failed send or crashed consumer leaves the request recorded, and the next trigger after the window requests again. The consumer always acknowledges; there are no Queue-level retries.
- **One message refreshes everything for the portfolio.** It covers the selected account's public calendar, the authorized calendar while the grant is active, and the published account's public calendar when the draft selected another account. Owner Retry, consent and the consumer call the same `refreshPublicCalendar` and `refreshAuthorizedCalendar` functions. Each write goes through the Phase 11D `githubJobs().refresh` with the ticket captured before the provider call. A 401, changed scope or other account withdraws private data and queues the grant (Phase 41 path). The consumer then runs grant cleanup immediately, and the cron retries it.
- **What "due" means.** For a visit, a calendar the endpoint serves is due when its last successful fetch is at least six hours old, or it is missing or from another generation. For the authorized calendar, this applies only while the grant is active. The owner status read uses the same rule, except that a selection that has never fetched successfully stays with setup and Retry (`requireData`). That keeps the editor from auto-retrying first-fetch failures behind the owner's back. The sweep compares the authorized calendar's ISO `fetchedAt` in SQL; `parseCalendar` normalizes it to `toISOString`.
- **Retained published account.** New table `github_published_activity` holds one row per portfolio: public data only, with no authorized column. When `ownerGithub.select` moves to a different account, the same D1 batch copies the outgoing account's current-generation public calendar. It does so only when the active version's frozen `$.graph.id` names that account. `site` uses the row only when the connection doesn't serve the published account with data, and only for the frozen account ID. The projection receives it without authorization, so a published `includePrivate` version shows public counts. That matches AC 9.7 and 9.9: the username change already withdrew private access. Refresh keeps the row current, rebuilds it after a Publish that raced the switch, and removes it once the active version names no graph or another account, or the connection again holds usable data for that account. Account deletion cascades.
- **Staleness at the endpoint.** `site` checks staleness on the calendar it actually serves: the connection's calendars, or else the retained row. The enqueue (D1 write plus Queue send) runs in `waitUntil` after the body is built, so the visitor gets the last good data immediately.
- **Message routing.** The jobs consumer handles `github-refresh` messages on `GITHUB_QUEUE_NAME` (default `hasaweb-github-local`). Outside local development it acknowledges any other message on that queue, rather than retrying the batch until it is dropped. Locally, other messages still go to the existing runtime probe. The entry file imports `cloudflare:workers`, so this branch has no unit test; the runtime suite covers the probe path and the editor suite covers refresh messages. `GITHUB_QUEUE` is optional for the owner routes and `site`; without it, nothing is requested.
- **Quota estimate (not a measurement).** One message costs about three Queue operations ([architecture section 4](../../docs/architecture.md#4-platform-budgets-and-historical-free-comparison)). With *N* published graphs visited at least every six hours and *P* private connections nobody visits, normal load is about 3 × (4*N* + *P*) operations a day. Example: 1,000 graphs and 200 private connections give about 12,600 a day, or 378,000 a month. Added to the 313,290 forecast for publication, that is about 690,000 of the 1,000,000 monthly operations included in Workers Paid ([deployment policy](../../docs/deployment-policy.md)), before contact work. During a GitHub outage, each visited or private portfolio can be requested every 15 minutes, up to 96 times a day. Each message makes at most three GitHub GraphQL calls (public, authorized, published account) plus grant cleanup, and about ten D1 queries. A cron tick makes one select, up to 25 conditional upserts and one `sendBatch`. The shared platform credential's GitHub rate limit, not the Queue, binds first in a long outage with many portfolios: 1,000 visited graphs at 96 a day is about 4,000 calls an hour. This needs paid-provider and GitHub rate verification before release.
- **Figma.** This phase adds no editor UI. The existing failure, Retry and Authorize again texts cover AC 9.8 and 9.9, so the Figma file wasn't opened and nothing in it changed.

## Results

Profile chosen: `full` (new migration, shared GitHub and db contracts, jobs, site and harness). Tested working tree: `feat/42-github-refresh` on base `0cda8bb`, with the changes uncommitted (not yet committed at the time of writing).

Targeted checks, all passing on the final source:

- `pnpm check`: lint (no new warnings; the seven `editor.css` warnings and one `useConst` warning in `scripts/social-links-publish-browser.mjs` are already on `main`), all typechecks, and 644 unit tests in 61 files, 14 of them new: refresh policy and message parsing (4); site refresh-on-visit, authorized TTL, no-queue, retained-account serving and identity rejection (6); and jobs status enqueue, consumer environments, revocation cleanup and sweep batching (4).
- `pnpm test:persistence`: 104 checks with real D1/workerd, seven of them new (`packages/db/integration/github-refresh.ts`). They cover:
  - One request per window and one claim per request, including duplicate and superseded deliveries and a crashed claim recovered by a later request.
  - A published graph updating without Publish.
  - A 502 that keeps the last good graph and its date and shows `lastError: "retry"` to the owner, held back by the window, then repaired.
  - Private counts refreshing, and access revoked on GitHub withdrawn on the next refresh without Publish. The dead-token proof releases cleanup, and Reconnect restores private counts.
  - Withdrawal landing during the authorized fetch, which writes nothing.
  - An old refresh whose token was revoked, then replaced by a new grant mid-flight, whose 401 leaves the new grant active.
  - The daily sweep: only the due connection is requested, once, in bounded batches, and not again within the window.
  - Status reads requesting one refresh past the TTL, and none for a never-fetched selection.
  - The published-account flow: switch, public-only retention, refresh, rebuild, switch back, Publish of the other account, and Publish without a graph.

  The first run on this tree stopped in the harness's own migration step (a wrangler call timed out under load) before any check ran. The rerun passed.
- Mutation checks, run as `pnpm test:persistence`. Removing the claim guard from `claimGitHubRefresh` fails the dedupe check (`Expected false, received true`). Removing the published-account condition from the account-change transition fails the published-account check (`Expected ["node-gh-refresh-switch-owner"], received ["node-gh-refresh-switch-second"]`). Both files were restored.
- `pnpm build` passed. `pnpm test:editor --browser-filter='GitHub'` passed all five GitHub groups in Chromium against the GitHub stand-in. The new group "GitHub refresh: live graphs update without Publish, keep the last good graph on failure, and lose revoked access on the next refresh" (45 s) checks:
  - A visit with aged calendars gets the old graph at once, then the live graph updates without Publish.
  - Further visits request nothing and make no GitHub calls.
  - A 502 keeps the counts and date for visitors, and the editor shows "Couldn't refresh GitHub. Showing the graph from…"; Retry recovers.
  - After a private Publish, revoking the app at the stand-in removes private counts from the live graph on the next refresh, with `needs_reconnect` and grant cleanup released. The editor shows "GitHub no longer allows private access", and Authorize again restores private counts without Publish.

  The Phase 40 publication group now expects the published account's public graph, instead of "unavailable", after a draft account change.

Full gate (`pnpm verify --profile=full`), run `2026-11-08T09-52-09.126Z-mAujI5` on the final source: all 14 stages passed in a single run. They were `check` (644 tests), `build`, renderer (31 groups), auth browser, persistence (104), uploads, publication dispatch and serving, draft API, autosave, editor (60 groups, including all five GitHub groups), runtime (three Workers, D1, R2, Queue including the GitHub queue probe, Workflow, restart), runtime smoke, and routing (31 boundaries). An earlier full run was stopped deliberately to add the unknown-message acknowledgement, so the passing run covers that change.

Not run or not established:

- No live GitHub, deployed Queue, cron trigger or Workers Paid measurement. The cron path ran only as a function call in the persistence suite, not through a scheduled event.
- No separate boundary review. This phase changes privacy-relevant serving (which calendar `site` shows after an account change) and withdrawal timing, so the boundary review in [AGENTS.md](../../AGENTS.md) applies before completion.
- Chromium only. No deployed S-9 cache check; `/_/github.json` stays `no-store`.

Remaining integration:

- Production Queue consumer and cron configuration (committed Wrangler configs are local-only).
- Paid-provider Queue and GitHub rate verification.
- Phase 42D (guide step: the onboarding status read gets the same refresh through `ownerGraphSetup`).
- Phase 49 (account deletion; both new tables cascade with the portfolio).

Approval: completion approval is pending. The roadmap checkbox is unchanged.

## Documentation impact

Changed assumptions:

- Refresh-on-visit used to be described as writing `github_activity.refresh_requested_at`, and the sweep as enqueuing every private connection from one daily cron. Now the request lives in `github_refresh`, and the sweep is a bounded per-tick batch of due connections.
- A draft username change after Publish used to make the live graph unavailable. Now it keeps the published account's public graph.
- Refresh queues and scheduling are no longer "remaining Phase 42".

Updated guidance: [architecture 8.5](../../docs/architecture.md#85-github-activity-product-9) (refresh bullets, the Phase 40 paragraph's account-change sentence, a new Phase 42 paragraph, and the "remain Phases 40–42" sentence), [implementation status](../../docs/implementation-status.md) (GitHub, Phase 40 and Phase 41 rows, plus a new row), the [db](../../packages/db/README.md) and [GitHub](../../packages/github/README.md) package guides, and the [roadmap](../../docs/roadmap.md) (record link only; checkbox unchanged). Historical records, including the Phase 40 decision that left this gap to Phase 42, stay as written.

Unresolved prerequisites: the boundary review, production Queue and cron configuration, paid-provider and GitHub rate verification, deployed S-9, and Phases 42D and 49 as listed above.
