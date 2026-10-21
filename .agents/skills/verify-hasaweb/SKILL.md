---
name: verify-hasaweb
description: "Drive hasaweb.site's local web app and existing Playwright/API suites to verify entry, authentication, draft recovery, editor preview and renderer behavior after changes. Distinguish real routes from dormant fixtures."
---

# Verify hasaweb.site

Read [the feature index](features/README.md) before choosing a journey. Read the repository's [implementation status](../../../docs/implementation-status.md) and [verification profiles](../../../docs/agent-workflow.md#choose-local-checks) for current boundaries. Run from the repository root on Linux/WSL.

## Launch

Use Node 22.22.1, pnpm 12.11.2, the installed Playwright dependency and Chrome at `/opt/google/chrome/chrome`. Set `AUTH_SPIKE_CHROMIUM` to an installed Linux Chromium executable if needed. Install dependencies with `pnpm install --frozen-lockfile` when absent. If pnpm resolves to Windows, use the [README fallback](../../../README.md#local-and-production-separation). For example, enter a Linux pnpm shell with `npm exec --yes --package=pnpm@12.11.2 -- sh`, then run the commands below there.

```sh
./.agents/skills/verify-hasaweb/scripts/verify.mjs
```

This command holds the existing shared `flock` through `runVerification`, runs `pnpm build`, migrates an empty isolated D1 store, starts the three Workers and drives the mapped `entry` journey. It prints `Verification output:` and `Journey evidence:` with unique absolute directories. Readiness requires all three health responses, the owner API's signed-out 401/private-no-store response, matching source revision and web bundle digest, and a web port owned by the launched process group. A listening port alone is insufficient.

No seed users or sessions are needed for `entry`. Zero users, sessions, portfolios, claims and assets are its explicit precondition. The helper records these counts before and after. It generates temporary local configuration with a fresh signing secret and dummy OAuth credentials. It never copies `.dev.vars` or resets `.wrangler/state`. No provider login is possible with this configuration. Choose the auth fixture suite below for provider behavior.

The web origin is `http://127.0.0.1:8837`; inspector starts at 9337. The helper refuses occupied ports 8837–8839 and 9337–9339. Existing suites have fixed ports and shared scratch paths of their own. Serialize all heavy commands through `pnpm verify`; do not double-drive an existing development browser or launch suites concurrently. A separate worktree does not isolate service discovery, ports or suite scratch paths.

Normal termination, a browser/assertion failure and SIGINT/SIGTERM run cleanup automatically. The command exits zero only after the journey and cleanup succeed. `--drive` is an internal runner command; invoking it directly bypasses the lock and build.

## Doctor

The helper runs this read-only check before browser actions. While its instance is alive, rerun it using the printed evidence directory:

```sh
./.agents/skills/verify-hasaweb/scripts/verify.mjs --doctor .wrangler/evidence/verify-hasaweb-a6ZrcG
```

Substitute the current run's directory. The doctor reads `instance.json`, checks the revision/bundle, verifies the listening process group with `ss`/`ps`, and reads all three health routes plus `/api/owner`. It does not seed, provision or alter storage. Failure after the run completes is expected because cleanup has stopped the instance. For other suites, inspect that run's `summary.json`, failing command log and suite report before retrying. They own their instance lifecycle; do not point this doctor at their ports.

## Drive

The entry helper uses Playwright against the built web Worker and real jobs binding. Its fresh browser context performs these actions without request fulfillment or application-state setters:

1. Open `/` and wait for heading `Everyone should have a website.`.
2. Click link `Start building`; require `/sign-in` and enabled buttons `Continue with GitHub` and `Continue with Google`.
3. Click link `Back to home`; require `/`.
4. Navigate directly to `/editor` while signed out; require `/sign-in?reason=session_expired` and heading `Welcome back.`.

The helper does not click OAuth buttons. It observes the account shell's provisioning POST and requires the real API to reject it with 401. It rejects other mutation requests and unexpected external requests, and checks unchanged empty D1 counts. For authenticated features use the existing suites via their locked profiles:

```sh
pnpm verify --profile=auth
pnpm verify --profile=drafts
pnpm verify --profile=editor
pnpm verify --profile=renderer
```

These profiles include checks, affected builds and their named browser/API suites. Read the selected feature recipe for selectors, preconditions and limitations. Suite fixture seeding establishes state; only user actions and observed storage/HTTP results prove the interaction under test. Do not count assertions that call internal controllers as end-to-end UI proof.

## Evidence

The entry proof lives under the printed `.wrangler/evidence/verify-hasaweb-*` directory. It contains `journey.json` with ordered actions, request methods/paths, response statuses, before/after database counts and failures; four numbered screenshots and ARIA snapshots; `trace.zip` with actions and snapshots; `doctor.json`; migration and runtime logs; and non-secret `instance.json`. Inspect the trace with `pnpm exec playwright show-trace` followed by the absolute trace path. Browser failure may leave a partial trace; `failure.png`, `journey.json` and logs remain the diagnosis.

The wrapper's `.wrangler/verification/<run>/summary.json` records the source revision, working-change digest, command results and logs. Existing profiles write suite artifacts below their own verification directory unless an explicit evidence override is supplied. Do not reuse an override directory that contains earlier evidence.

Prove every mapped entry point claimed in a report. Capture the initiating action and resulting state, and read durable side effects after writes. A screenshot alone cannot prove saving, provisioning or privacy. Fixtures may replace external provider HTTP/consent at the existing auth boundary; disclose that limitation. They do not prove live provider callbacks, deployed TLS, CPU budgets, publication or the full signup-to-published-site journey. No real provider messages or deployments belong to this skill by default. Build scripts use Wrangler `deploy --dry-run`; that prepares bundles rather than publishing them. Entry evidence independently records browser network attempts and database state; do not infer absence of side effects from a command's name.

## Cleanup

The entry helper closes its own Playwright browser, signals only the process group it started, checks the D1 counts and removes only its run's `scratch/` folder. Evidence is outside scratch and survives. Do not kill processes by name or remove `.wrangler/state`. After an interrupted shell or machine crash, inspect `instance.json` and confirm process ownership before stopping leftovers. Never use a stale PID record as permission to kill a reused PID.

Confirm cleanup and proof retention after each run. Require `journey.json` to report `passed` and an empty `cleanupErrors`, require the numbered screenshots and `trace.zip` to exist, and require `scratch/` and the run's listening ports to be gone. Keep failed-run artifacts too. The existing suites close their own Workers/browsers, but some retain ignored scratch state for diagnosis. Their evidence directories are separate; do not delete the whole `.wrangler` tree to clean one run.

## Helpers

[`scripts/verify.mjs`](scripts/verify.mjs) is executable. Its default invocation builds, launches, doctors, drives `entry` and cleans up under the shared lock. Its only public option is `--doctor evidence-directory`, shown above. It reuses [`scripts/verify.mjs`](../../../scripts/verify.mjs) at the repository root for locking and source provenance. `ss`, `ps` and `flock` are required Linux/WSL utilities.

Use `/maintain-verification-skill` after app changes to keep the feature map aligned with actual routes, selectors and activation status.
