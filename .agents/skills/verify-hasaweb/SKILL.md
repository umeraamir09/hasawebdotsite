---
name: verify-hasaweb
description: "Verify hasaweb.site changes: run the affected e2e projects, debug a failing Playwright journey, or drive the local app in a browser."
---

# Verify hasaweb.site

Run from the repository root on Linux/WSL with Node 22.22.1 and pnpm 12.11.2. If pnpm resolves to Windows, see the README.

## Run the right checks

```sh
pnpm verify          # check + build + e2e projects affected by the diff against origin/main
pnpm verify --all    # everything
```

`pnpm verify --dry-run` prints which projects it would run. Projects (see `e2e/README.md`): `editor`, `autosave`, `api`, `auth`, `renderer`, `publication`, `runtime`.

## Debug one journey

The e2e suites run against the last build, so run `pnpm build` after changing app code.

```sh
pnpm e2e --project=editor -g "resume download"
GROUP_FILTER="replace and withdraw" pnpm e2e --project=editor -g "resume download"
```

`-g` selects tests; `GROUP_FILTER` selects named groups (test steps) inside a journey. On failure read, in order: the test output, then `test-results/evidence/*/<label>-failure-N.{json,png,html}` (diagnostics, screenshot and DOM of the failing group). Journeys use Chromium at `/opt/google/chrome/chrome`; set `AUTH_SPIKE_CHROMIUM` to use another binary.

Fixture setup (SQL, seeded sessions) establishes state; only user actions and observed HTTP/storage results prove the behavior under test. Do not count assertions that call internal controllers as end-to-end proof.

## Drive the real app

`pnpm dev` builds and starts all three Workers at `http://127.0.0.1:8787` with local D1/R2 state in `.wrangler/state` (setup in the README). OAuth needs development provider apps; without them you can reach `/`, `/sign-in` and the signed-out redirect from `/editor`. The full guide and editor are behind `OWNER_ENTRY_ACTIVATION=active` in `apps/web/.dev.vars`.
