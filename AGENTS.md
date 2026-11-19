# Working in this repo

hasaweb.site is a free portfolio builder: Next.js on OpenNext plus three Cloudflare Workers (`apps/web`, `apps/site`, `apps/jobs`), D1, R2 and Better Auth. One developer builds it with AI agents. The goal right now is shipping v1.

## Where things are

| Need | Read |
| --- | --- |
| What to build next | [docs/roadmap.md](docs/roadmap.md) |
| Required behavior | [docs/product.md](docs/product.md), [docs/acceptance-criteria.md](docs/acceptance-criteria.md) |
| Contracts to keep | [docs/architecture.md](docs/architecture.md), [docs/protocols/draft-api.md](docs/protocols/draft-api.md), the README in the package you touch |
| Setup guide behavior | [docs/onboarding.md](docs/onboarding.md) |
| Themes, fonts, decorations | [docs/appearance-catalog.md](docs/appearance-catalog.md) |
| Visual design | [docs/ui-direction.md](docs/ui-direction.md) |
| Commands | [README.md](README.md) |

Read the roadmap entry and the sections relevant to your change. You do not need to read everything. In code, find what you need with `grep -n` and read that line range rather than whole files; everything you read stays in context for the rest of the session. Old phase records are in the `archive/specs-2026-11` git tag; look there only if you need a historical measurement.

## Workflow

1. Pick a roadmap phase (or task) whose dependencies are checked off on `main`.
2. Branch from `main` as `<type>/<short-description>` (see below). Use a worktree if other work is in flight.
3. Implement it with tests. Run `pnpm check` while iterating, and the e2e tests you added or changed before opening the PR (`pnpm verify` picks projects from your diff).
4. Open a PR. Its description is the record: what changed, how it was verified, and anything left open.
5. When the phase's completion criteria pass, check its roadmap box in the same PR with a one-line note. **A merged PR is the owner's approval**; no separate approval step or commit.

You may use subagents, parallel worktrees and reviews whenever they help. Keep each PR focused enough to review.

Ask the owner only for real product decisions: scope changes, new user-visible behavior not covered by the docs, or spending money or using external accounts.

## Docs

Docs describe the current system only. When a change alters a contract, update the doc that states it in the same PR, and delete text it makes wrong. Do not add dated history, approval notes or "superseded" paragraphs; git history keeps those. Do not create per-phase record files.

## Verification

| Command | Runs | When |
| --- | --- | --- |
| `pnpm check` | Biome, typecheck, Vitest (~1 min) | Constantly |
| `pnpm e2e --project=<name> -g "<test>"` | One e2e test against the last build | For each e2e test you add or change, and when debugging |
| `pnpm verify` | `check`, build, and the e2e projects your diff affects, up to a local limit (three per e2e worker) | Before a PR that changes app code |
| `pnpm verify --projects=<a,b>` | `check`, build and the named projects | When you want specific projects regardless of the diff |
| `pnpm verify --all` | `check`, build, every e2e project | Rarely; CI already does this in parallel |

E2E projects run on Playwright Test against the built Workers in workerd (see `e2e/README.md`). On a 4-core machine they run on one worker, so all eight projects take about 30 minutes locally. CI runs them in parallel in about six minutes on every PR that touches code. When a diff touches a shared path (`packages/db`, `packages/schema`, `e2e/support`, the lockfile) verify selects every project, goes over the local limit and leaves them to CI. Run the tests you wrote or changed yourself, then push. Don't re-run tests that already passed in this session, and fix anything CI reports, including tests marked flaky.

Run the e2e tests that cover your change, plus a careful self-review of the diff, for any change to authentication, authorization, private data, publication or withdrawal, migrations or deletion. These boundaries are where bugs cost real users.

When an e2e test fails:

- Read its evidence first: `test-results/evidence/<label>-failure-N.{json,png,html}` and `error-context.md`. Most failures are explained there.
- Iterate on one test with `pnpm e2e --project=<name> -g "<test>" --reporter=line`. Local runs don't retry. Don't filter the output through `grep`; a filter that matches nothing hides the failure.
- Set `BROWSER_GROUP_LIMIT_MS=20000` so a stuck browser step fails in 20 seconds instead of 120.
- Run `pnpm build` again only after changing app or package code. Changes under `e2e/` don't need a rebuild.

Run long commands such as `pnpm verify` in the background and continue when the completion notice arrives. Don't poll the log with `sleep` or `until` loops.

Write tests for user-visible behavior, privacy and data safety. Prefer a Vitest unit test when the logic can be tested without the runtime; add e2e coverage for flows that cross Workers or the browser.

## Code

- Validate unknown input once at the boundary that owns it, then pass typed values inward. Don't re-check values a schema, constructor or type already guarantees.
- Don't extract single-use helpers unless they hide a genuinely complex boundary or have a name that makes the caller clearer.
- Avoid `try`/`catch` unless you handle the error meaningfully.
- Keep hot owner routes bounded: no whole-draft parsing or serialization in request handlers (see [architecture](docs/architecture.md#1-shape-of-the-system)).
- `apps/web` uses a Next.js version with breaking changes; see `apps/web/AGENTS.md`.

## Figma

Use the Figma file in [docs/ui-direction.md](docs/ui-direction.md) through the Figma MCP when building UI. The file is read-only: never create, edit or delete anything in it unless the user asks. If a change seems necessary, explain it and ask first.

## Git

Branches: `<type>/<short-description>`, lowercase kebab-case, issue number first if there is one (`fix/42-mobile-menu`). Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`.

Commits: Conventional Commits, `<type>(<optional-scope>): <description>`, imperative and lowercase, no trailing period, about 72 characters. Same types plus `revert`. One logical change per commit; explain why in the body when it isn't obvious. Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.

Never push to `main`. Don't rewrite existing history to rename commits.
