# End-to-end suites

Playwright Test suites that run the built Workers in workerd with fresh local D1/R2 state and drive Chromium through real routes. Build first (`pnpm build`); `pnpm verify` builds for you.

```sh
pnpm e2e                                   # everything
pnpm e2e --project=editor                  # one project
pnpm e2e --project=editor -g "case studies"  # one test
GROUP_FILTER="withdraw" pnpm e2e --project=editor -g "resume"  # some steps of a test
E2E_WORKERS=2 pnpm e2e                     # more workers (default: one per four cores)
```

## Projects

| Project | Spec | Covers |
| --- | --- | --- |
| `editor` | `editor.spec.mjs` | One test per journey in `editor/`: core editor, setup guide, every content control, publish, case studies, resume, GitHub graph, appearance, decorations, Face Reveal, draft preview |
| `autosave` | `autosave.spec.mjs` | Autosave, local recovery, conflict review and reauthentication (`autosave/harness.mjs`; its groups share a page and run in order) |
| `api` | `draft-api.spec.mjs`, `persistence.spec.mjs`, `uploads.spec.mjs` | Draft/progress API contracts, setup entry and publication API, D1 migrations and owner boundaries, private uploads |
| `auth` | `auth.spec.mjs` | Provider fixtures, sessions, provisioning, cookie isolation, the rendered sign-in UI |
| `renderer` | `renderer.spec.mjs` | Preview and static output parity, first paint, Face Reveal markup |
| `publication` | `publication.spec.mjs` | Dispatcher with maximum assets; commit and public serving |
| `runtime` | `runtime.spec.mjs` | The three committed Worker configs with bindings, queue and restart persistence (uses `.wrangler/state`) |

## How it fits together

- `support/fixtures.mjs` defines worker-scoped fixtures. `ownerRuntime` starts the built web Worker with the real jobs owner router (`support/owner-runtime.mjs`), seeds synthetic owners and sessions signed with the real Better Auth algorithm, and exposes `sql`, `request`, `cookie` and draft helpers. `editor` adds a local proxy and one Chromium context (`editor/harness.mjs`). Every port comes from `support/ports.mjs`, so workers and worktrees never collide.
- A journey is an exported `check…(controls)` function that calls `run(name, work)` for each group. Each group becomes a `test.step` with a time limit; on failure it writes `<label>-failure-N.{json,png,html}` under `test-results/evidence/`.
- `nodeSuite` runs the standalone suites (`persistence`, `uploads`, `renderer`, `auth`, `runtime`, `publication`) as a child process and attaches their output.
- Fixture-only routes (`/__fixture/*`, SQL access, failure injection) exist only in the integration entries under `apps/*/integration`, never in production code.

## Adding a test

Add a `run("what it proves", async () => { … })` group to the journey that owns the feature, or a new journey file plus one line in `editor.spec.mjs`. Start each group from known state (`boot()` resets the owner's draft) so journeys can run in any order on any worker. Prove behavior through user actions and observed HTTP or storage results, not by calling internal controllers.

Playwright retries a failed test once and reports a pass on retry as flaky. Treat flaky reports as bugs to fix with a proper wait, not as noise.
