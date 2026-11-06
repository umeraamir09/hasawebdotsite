# CI reliability and speed

## Scope and acceptance

Owner request on November 6, 2026. `main` at `4a0299a` (Phase 31/32 merge) was red and stayed red on rerun. The single `foundation` job took about 11 minutes. Known failures had no confirmed root cause:

- `scripts/skills-controls-browser.mjs` showed the category order from before a reorder in the preview.
- `scripts/text-controls-browser.mjs` failed `fill` on the "Section body" textbox with `contenteditable="false"`.

Acceptance:

- Find whether each failure is a test race or a product defect, and fix the cause.
- CI passes consistently and finishes much sooner, with no loss of suite coverage.
- Failures report the failing group and its state quickly instead of running into a timeout.
- The required check keeps the name `foundation`.

This is not a roadmap phase and has no phase prerequisites. Shared base: `main` at `6ef042d`. Branch `ci/test-reliability`, worktree `.claude/worktrees/ci-reliability-performance-0c38ff`. Write boundaries: `.github/workflows/ci.yml`, browser harness scripts, `apps/web/components/editor-preview.tsx`, CI guidance in `docs/agent-workflow.md` and `docs/architecture.md`, and `turbo.json` pass-through env.

## Decisions

### Skills preview: product defect

`EditorPreview` sent each edited draft to the preview bridge from a passive `useEffect`. React 19 may run passive effects only after the browser yields. In that window the status still read **Preview up to date** (`data-preview-state="displayed"`) while the committed draft was newer than the preview. The test's `displayed()` helper trusts that status, so it read the old preview.

A temporary CI diagnostic job showed this on the GitHub runner in every execution, 7 of 7. After "Move Tools up", the working draft held `[Tools, Languages]` and the status reported displayed sequence 21 = requested 21. The preview still showed `[Languages, Tools]` until sequence 22 arrived later. The group failed in 5 of 6 focused iterations. Local runs on this machine never showed the stale read. See [the diagnostic excerpt](ci-diagnostic-excerpt.txt).

Fix: issue the preview request from `useLayoutEffect`. The bridge then moves to `preparing` in the same commit as the edit, so the status never claims a newer draft is displayed. The bridge, transport and renderer are unchanged. The bridge effect's dependencies (`channel`, owner and portfolio IDs) do not change within a mounted preview, because `EditorSession` remounts on an owner change. The earlier layout timing therefore cannot send a draft to a bridge for a different identity.

A new deterministic editor group, "preview status leaves up to date in the same task as a committed edit", makes an edit and lets only microtasks run before reading the status. It fails against the old `useEffect` and passes with the fix.

### Rich text body: test race

After "Continue preserved edits", `continueRecord` restores the preserved 1 MiB body and then awaits `flushValid()` while holding the recovery lock (`busy`). While that lock is held, the editor disables its controls and the rich text editor is `contenteditable="false"`. A local trace showed the restored text visible about 0.5 s before the lock released. The test waited only for the text length, then called `fill`. Playwright waits for a disabled `<input>`, but it does not retry `fill` on a `contenteditable="false"` element.

The lock is intentional: recovery actions are serialized and edits are refused until the restored draft is saved. The test now waits for `contenteditable="true"`. The other suites that continue preserved edits fill ordinary inputs, which Playwright already waits on.

### CI layout

The serial job was replaced. One `build` job uploads the built workers (`apps/web/.open-next`, `apps/site/dist`, `apps/jobs/dist`). `check` runs lint, typecheck and unit tests in parallel. Seven `suite` jobs run every previous suite on the shared build:

- the editor browser suite in three shards
- autosave
- uploads
- draft API plus persistence
- renderer, auth browser, runtime, runtime smoke and routing

`foundation` is an aggregate job (`if: always()`) that passes only if every job passed. Jobs have time limits. Superseded pull request runs are cancelled. Failed suites upload their `.wrangler/evidence` directories.

The editor harness now uses `scripts/lib/browser-groups.mjs` for `--browser-filter`, round-robin `--browser-shard=k/n`, a 120-second per-group limit, and failure capture. On failure it prints the group name, duration, page errors and editor/preview state, and writes `editor-failure-*.{json,png,html}`. All three shards passed locally, so no group depends on state left by another. The autosave harness shares one page across groups, so it is not sharded.

Tradeoff: total runner minutes rise because each job repeats checkout and install, about 30 s each. Wall-clock time falls.

## Results

- Baseline: run 42216516353 took about 11 minutes serially. Its slowest steps were editor 191 s, autosave 117 s, uploads 114 s and draft API 51 s.
- Local: `vitest run scripts/browser-groups.test.mjs` passed (shard partition, malformed shards, stuck-group failure evidence). All three editor shards passed: 17, 17 and 16 of 50 groups. The new regression group passed with the fix and failed without it.
- Local gate: `pnpm verify --profile=editor` passed on the final working changes (recorded against base revision `5a3c6a6` before commits were reorganized): `pnpm check` 47 s, web/jobs build 96 s, editor suite 396 s with 51 groups. The profile covers the changed live-preview component and the editor harness. Workflow and test tooling changes are checked by `pnpm check` and by CI.
- CI: run 42232280791 on `0d3204c` passed all three attempts, in 4 min 48 s, 4 min 39 s and 4 min 11 s wall-clock, against about 11 min before. In the first attempt the `check` and `build` jobs took about 1.5 min each, and the slowest suite jobs (autosave; renderer, auth and runtime) took about 2.7 min. The editor shards took 2.1–2.4 min. Three passing attempts are evidence of stability, not proof.

## Documentation impact

The changed assumptions are that CI is no longer one serial job, and that editor browser groups support sharding, time limits and failure evidence. Updated [CI guidance and local options](../../docs/agent-workflow.md#ci-and-future-improvements) and the [architecture CI summary](../../docs/architecture.md#123-cicd-github-actions). README and implementation-status links to the workflow stay accurate. No prerequisites are unresolved.

## Approval

The owner approved this change for merge on November 6, 2026, after reviewing PR #46.
