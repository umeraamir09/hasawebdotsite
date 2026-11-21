# End-to-end suites

Playwright Test suites that run the built Workers in workerd with fresh local D1/R2 state and drive Chromium through real routes. Build first (`pnpm build`); `pnpm verify` builds for you.

```sh
pnpm e2e                                   # everything
pnpm e2e --project=editor                  # one project
pnpm e2e --project=editor -g "case studies"  # one test
GROUP_FILTER="withdraw" pnpm e2e --project=editor -g "resume"  # some steps of a test
GROUP_FILTER="contact" pnpm e2e --project=api -g "draft and progress"  # some API checks
E2E_WORKERS=2 pnpm e2e                     # more workers (default: one per four cores)
BROWSER_GROUP_LIMIT_MS=20000 pnpm e2e --project=editor -g "contact form" --reporter=line  # debug: stuck steps fail in 20s
E2E_RETRIES=1 pnpm e2e --project=editor    # retry locally the way CI does
```

## Projects

| Project | Spec | Covers |
| --- | --- | --- |
| `editor` | `editor.spec.mjs` | One test per journey in `editor/`: core editor, setup guide, every content control, publish, case studies, resume, GitHub graph, appearance, decorations, Face Reveal, draft preview, publishing the internal example portfolio |
| `autosave` | `autosave.spec.mjs` | Autosave, local recovery, conflict review and reauthentication (`autosave/harness.mjs`; its groups share a page and run in order) |
| `api` | `draft-api.spec.mjs`, `persistence.spec.mjs` | Draft/progress API contracts, setup entry and publication API, D1 migrations and owner boundaries |
| `uploads` | `uploads.spec.mjs` | Private uploads and owner-only asset reads |
| `auth` | `auth.spec.mjs` | Provider fixtures, sessions, provisioning, connecting and disconnecting providers, cookie isolation, the rendered entry page and sign-in UI |
| `renderer` | `renderer.spec.mjs` | Preview and static output parity, first paint, Face Reveal markup |
| `publication` | `publication.spec.mjs` | Dispatcher with maximum assets; commit and public serving |
| `runtime` | `runtime.spec.mjs` | The three committed Worker configs with bindings, queue and restart persistence (uses `.wrangler/state`) |

## How it fits together

- `support/fixtures.mjs` defines worker-scoped fixtures. `ownerRuntime` starts the built web Worker with the real jobs owner router (`support/owner-runtime.mjs`), seeds synthetic owners and sessions signed with the real Better Auth algorithm, and exposes `sql`, `request`, `cookie` and draft helpers. `editor` adds a local proxy and one Chromium context (`editor/harness.mjs`). Every port comes from `support/ports.mjs`, so workers and worktrees never collide.
- A journey is an exported `check…(controls)` function that calls `run(name, work)` for each group. Each group becomes a `test.step` with a time limit; on failure it writes `<label>-failure-N.{json,png,html}` under `test-results/evidence/<fixture>-<worker>/` (for example `evidence/owner-0/`).
- `nodeSuite` runs the standalone suites (`persistence`, `uploads`, `renderer`, `auth`, `runtime`, `publication`) as a child process and attaches their output.
- Fixture-only routes (`/__fixture/*`, SQL access, failure injection) exist only in the integration entries under `apps/*/integration`, never in production code.

## Adding a test

Add a `run("what it proves", async () => { … })` group to the journey that owns the feature, or a new journey file plus one line in `editor.spec.mjs`. Start each group from known state so journeys can run in any order on any worker. `boot()` deletes alice's portfolio and creates a new one with a new ID, so read the portfolio ID and insert rows keyed to it (contact recipient, outbox, publications) after `boot()`, not before.

The api project is one Playwright test that runs every check in `draft-api/checks.mjs` in order; `GROUP_FILTER` selects checks by name. Give a new check its own state (`setDraft`, or a dedicated owner) so it can run alone. A few early checks continue from the previous check's draft and fail when run without it. Prove behavior through user actions and observed HTTP or storage results, not by calling internal controllers.

Don't reuse the seeded owners (`alice`, `bob`, `revoked`) for checks that claim an address, set a contact recipient or delete the account (`leaver` and `closer`, each with an `-other` session, exist for deletion). Address claims are permanent by trigger (`claim_no_delete`, `claim_no_transfer`), so cleanup fails and later checks see the claim. Insert a dedicated synthetic owner and portfolio for that check instead.

Each browser group has a 120-second limit (`BROWSER_GROUP_LIMIT_MS`). Lower it while debugging so a step that waits forever fails quickly.

In CI, Playwright retries a failed test once and reports a pass on retry as flaky. Treat flaky reports as bugs to fix with a proper wait, not as noise. Local runs don't retry unless you set `E2E_RETRIES`, so a failure reports after one attempt.

## Debugging a failure

1. Read the evidence: `test-results/evidence/<fixture>-<worker>/<label>-failure-N.{json,png,html}` holds the page state, a screenshot and the DOM at the failing step, and `test-results/*/error-context.md` holds Playwright's view.
2. Re-run only that test with `--reporter=line`, narrowed with `GROUP_FILTER` to the failing group or check, and don't pipe the output through `grep`.
3. Rebuild (`pnpm build`) only after changing code under `apps/` or `packages/`. Files under `e2e/` run directly.
