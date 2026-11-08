# Phase 40: Public GitHub graph setup

## Scope and acceptance

Requirements: [product section 9](../../docs/product.md#9-github-activity-graph), [acceptance criteria 9](../../docs/acceptance-criteria.md#9-github-activity-graph) (items 1–3, 6 and 11 for the public path) and [ON-08](../../docs/acceptance-criteria.md#initial-setup-checks), [architecture 8.5](../../docs/architecture.md#85-github-activity-product-9), and the [Phase 40 roadmap entry](../../docs/roadmap.md#phase-40-add-public-github-graph-setup).

Change: an owner adds one GitHub graph from the editor with public data only. A detected or typed username is fetched with the separate platform credential. The graph shows in the draft preview, the full-page preview and published output. The published page uses the configuration frozen into the active version. Phase 41 (private activity) and Phase 42 (independent refresh) build on the same service. Phase 42D reuses the same setup panel.

Acceptance checks:

- Zero contributions is a successful result.
- A missing, restricted or failed first fetch blocks publication of that graph only, and does not break the draft or the other sections.
- A Google owner needs no linked sign-in provider.
- Public responses never contain an authorized calendar, and the public endpoint uses the frozen published configuration, never draft choices.
- The owner gets a detected or typed username, a link to the exact GitHub profile, a visible status and Retry.

Prerequisites (owner-approved on `main` at `347ed6c`): 06, 11C–11D, 13–17, 27, 23, 25–26, 39. Branch `feat/40-github-graph` (renamed from the harness-created `claude/phase-40-github-graph-475354`), worktree `.claude/worktrees/phase-40-github-graph-475354`. No other implementation worktree touches these files (`git worktree list` showed `feat/39-draft-preview` already merged, plus unrelated experiment worktrees). No delegated workers.

Write boundaries: `packages/github` (public fetch), `packages/db` (setup service, facts), `packages/components` and `packages/render` (graph model, frame, script, CSS, CSP option), `apps/jobs` (routes, manifest freeze, batched rendering), `apps/site` (endpoint), `apps/web` (editor controls, preview data), harness scripts, and current guidance.

## Decisions

- **Where the frozen configuration lives.** The sealed publication facts now include the connection's stable account ID and login. When the manifest is sealed, the same statement writes `{id, login, includePrivate}` from those facts and the sealed `source` into the candidate index (`$.graph`). The index survives cleanup and is what `site` already reads for the active version, so no migration was needed. `includePrivate` is frozen now so Phase 41 does not change the shape.
- **Public data only.** Setup never reads an owner token, never creates a grant and never links a provider. `ownerGraphSetup.preview()` returns the allowlisted public calendar even when a private grant exists (checked in the persistence suite).
- **Restricted profile.** A profile that shows private contributions yields no public calendar (Phase 11C: never add or subtract). The owner sees an explanation with the GitHub setting to change, and Publish stays blocked.
- **Cooldown.** One 10-second cooldown covers Retry and changing the account, because the platform credential is shared. `github_connection.last_checked_at` is cleared on a new selection so `pending` and `restricted` stay distinguishable.
- **Draft records the account after the server accepts it.** The editor writes the canonical username into the draft only after setup returns a connection. A failed fetch keeps the selection so Retry needs no retyping.
- **Preview data.** `resolvePreviewImages` loads the owner-authorized calendar once per revision. Setup and Retry bump a revision that re-projects an unchanged draft. Full-page preview uses the same loader for the saved draft. Preview markup never fetches.
- **Published drawing.** Published HTML carries a `graph` frame placeholder. The platform script draws the same markup that the React preview renders, from the same-origin `/_/github.json`. Because that needs `connect-src 'self'`, `portfolioHeaders` has an explicit `connectSelf` option that `site` sets only for published HTML documents. Every other response keeps `connect-src 'none'`. `PUBLICATION_RENDERER_VERSION` is `publication-v6`.
- **Endpoint caching.** `/_/github.json` is `no-store` with `CDN-Cache-Control: no-store`, matching all other served files until S-9 verifies deployed browser/edge behavior. The architecture's five-minute `s-maxage` is not adopted yet.
- **Draft username change after Publish.** The connection holds one account, so after the owner selects a different account in the draft, the live endpoint reports `available: false` (with the published username) until the next Publish. It never serves the new account's data or the draft's choice. This follows the Phase 11D contract. Keeping the old account's graph live until Publish would need a second cached calendar and is left to Phase 42.
- **Reuse for onboarding.** `GitHubSetupPanel` takes only the saved username, a disabled flag and an `onAccepted` callback. The editor section wraps it with the draft controller. Phase 42D renders the same panel.
- **Provider test seam.** `GITHUB_API_ORIGIN` redirects provider calls to a fixture only when `APP_ENV` is `local` or `test`.
- **Not built (belongs to later phases):** the private-activity toggle and authorization (41), consent return/withdrawal on removal (41), refresh TTL and daily sweep (42), the onboarding step (42D).

Figma (read-only, session `5c65b012-…`): inspected `200:2025` (GitHub activity inspector: username field, status text, outlined refresh button) and `203:2240` (couldn't-refresh state). The editor section follows that layout. The private toggle and authorize button in that frame are Phase 41 and are not rendered. Nothing in the file was changed.

## Results

Profile chosen: `full` (shared contracts, renderer version, routes, all three apps). It did not complete locally, and the owner chose to leave the remaining checks to CI.

Passed on the final tree (before only documentation edits):

- `pnpm check`: lint (no new warnings), all typechecks, 603 unit tests in 57 files. New tests: public fetch/classifier (37), graph layout (13), GitHub graph render and model privacy (6), owner routes (7), site endpoint (7).
- `pnpm verify --profile=full` run `2026-11-08T02-26-54.825Z-0B3XkL`: `check`, `build`, renderer browser, auth browser, persistence (89 checks, including the new public-graph service check with real D1), uploads, publication dispatch and serving, draft API and autosave all passed, then 12 editor groups passed.
- The three new editor browser groups passed in a filtered run before the last cosmetic change (a fluid chart width and no scroll region). They did not run in the full run, because the gate stopped earlier. They cover manual entry, unknown/outage/invalid input, Retry and cooldown, restricted profile, zero contributions, preview, publish, the frozen configuration and the `/_/github.json` allowlist, a real visitor browser drawing the graph under the CSP, withdrawal after a draft account change, graph removal, and detection from a sign-in as a suggestion only.

Not passed or not run:

- Editor group `case studies publish with cards, keep frozen URLs and withdraw removed pages and images` exceeded its 120-second limit twice (full run, then alone). Both runs shared four cores with another session's test run (load average 13). I did not establish whether this is load only or a regression from this change; the group was not run on the unchanged base. Other publishing groups passed with the new facts, manifest and `publication-v6` changes.
- Not run: the remaining editor groups after case studies, runtime, runtime smoke and routing.
- No live GitHub call, no real platform token and no deployed check were made. The provider is a local stand-in that mimics the Phase 11C envelopes.
- No separate boundary review of publication, privacy or runtime budgets was run. Chromium only.

Defect found outside this phase: Workers reject `fetch(..., { redirect: "error" })`. `deleteActivityCredential` in `packages/github/src/credentials.ts` uses it, so every real grant cleanup would end `uncertain` and block new consent. Phase 40 code uses `manual`. A separate session was started to fix the cleanup path.

Approval: the owner approved completion on November 8, 2026 after PR #51 merged to `main` at `9770647`. The roadmap checkbox is checked.

## Documentation impact

Changed assumptions: the GitHub component was a placeholder ("Contribution graph unavailable."); `/_/github.json` was unavailable; published pages had `connect-src 'none'` everywhere; product public fetching and setup were future work; the renderer version was `publication-v5`.

Updated guidance: [architecture](../../docs/architecture.md) (site row, special paths, 8.5), [authentication](../../docs/authentication.md) (new owner routes), [implementation status](../../docs/implementation-status.md) (GitHub row and new row), [onboarding](../../docs/onboarding.md) (reuse note), [roadmap](../../docs/roadmap.md) (record link only, checkbox unchanged), and the package guides for [github](../../packages/github/README.md), [db](../../packages/db/README.md) and [components](../../packages/components/README.md).

Follow-up (PR 51 review): `parseContributionCalendar` now accepts GitHub's week-alignment padding (up to six days outside the window) and drops those days rather than classifying the payload `invalid`. The manifest seal writes `$.graph` only when `facts.github` has an `id` and `login`, and `publishedGraph` requires both to be strings, so a missing identity returns 404 instead of a graph for the login `undefined`. Regression tests: `public.test.ts` (padding) and `github-graph.test.ts` (missing identity). The seal SQL has no direct unit test. After merge, `pnpm verify --profile=publication` passed on `main` (2026-11-08: 331 unit files, 58 editor browser groups including the three GitHub graph journeys, which publish and serve through the seal). The persistence suite was not rerun.

Unresolved prerequisites: Phases 41, 42 and 42D; the production `GITHUB_SERVICE_TOKEN` secret; the deployed S-9 cache check.
