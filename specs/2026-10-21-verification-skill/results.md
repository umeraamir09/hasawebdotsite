# Project verification skill

## Scope and acceptance

The owner invoked create-verification-skill on October 21, 2026. Generate a local skill and feature map, then execute launch, doctor, one real user journey, evidence capture and cleanup. Follow the [current baseline](../../docs/implementation-status.md), [workflow](../../docs/agent-workflow.md), [authentication contract](../../docs/authentication.md) and [acceptance criteria](../../docs/acceptance-criteria.md). This is verification tooling, outside roadmap phase implementation. It does not approve or activate later features.

Shared base is `59fafc0` on `main`. Work uses branch `chore/verification-skill` in `/home/umer/hasawebdotsite`. Inspected worktrees include separate address-contract and landing-page work. Write boundaries are `.agents/skills/verify-hasaweb`, its `.cursor/skills` compatibility links, this record and a README pointer. No delegated work or application changes.

## Decisions

Use the existing Playwright dependency, Chromium path and shared verification runner. The real signed-out entry is executable without provider credentials. Existing auth, editor, autosave and renderer suites remain the recipes for their implemented boundaries. Dormant editor fixtures cannot prove production activation, publication or the complete signup journey.

The entry helper creates fresh migrations and local-only auth configuration, checks port ownership and all three Workers, captures browser actions and resulting states, compares database counts, and removes its own scratch storage and process group. Evidence stays in a unique ignored directory. It does not use the developer's `.wrangler/state` or `.dev.vars`.

## Results

Created [verify-hasaweb](../../.agents/skills/verify-hasaweb/SKILL.md), its executable lifecycle helper and a [five-feature map](../../.agents/skills/verify-hasaweb/features/README.md). The map covers entry, accounts, recovery, editor/preview and portfolio rendering. It distinguishes real routes from existing fixture coverage and pending product entry points. Only the entry journey was newly executed for this task.

The generated command completed build, empty-state migration, doctor, Playwright actions, evidence capture and cleanup. All 12 build tasks succeeded using the existing Turbo cache. The journey covers Start building, both provider choices, Back to home and direct signed-out `/editor` entry. The real owner API rejected both observed provisioning attempts with 401. User/session/portfolio/claim/asset counts remained zero. No page errors or external browser requests occurred.

Local proof is retained in [journey.json](../../.wrangler/evidence/verify-hasaweb-a6ZrcG/journey.json), [doctor.json](../../.wrangler/evidence/verify-hasaweb-a6ZrcG/doctor.json) and [the trace](../../.wrangler/evidence/verify-hasaweb-a6ZrcG/trace.zip), with four screenshots and four ARIA snapshots. Inspected the sign-in screenshot. Confirmed all proof files remain after cleanup, scratch storage is absent, all six reserved ports are free and `cleanupErrors` is empty. The [wrapper summary](../../.wrangler/verification/2026-10-21T14-43-30.895Z-l5VkJl/summary.json) records revision `59fafc0` and working-change provenance.

The first attempt incorrectly assumed that signed-out navigation makes only GET requests. The account shell legitimately attempts provisioning before redirecting. Corrected the helper to require the actual 401 and unchanged database, preserving the original journey. The failed attempt's [report](../../.wrangler/evidence/verify-hasaweb-V3D3Lq/journey.json) and screenshots/trace remain; its processes and scratch state were removed too. This was a helper assumption error, not an application defect.

`pnpm verify --profile=checks` passed lint, all 12 workspace typechecks and 354 tests in 30 files. This tooling-only profile plus the executed helper covers the change; application packages and contracts are unchanged. See the [checks summary](../../.wrangler/verification/2026-10-21T14-44-55.670Z-6ySTga/summary.json). Used the Linux pnpm binary because the shell default resolves to an incomplete Windows installation.

Checked generated frontmatter, executable mode, all feature files' four required sections, changed local links and the final diff. Routine proof remains ignored. Live providers, production TLS/callbacks, publication, full signup, dormant production editor entry and the complete release browser matrix were not verified here. No roadmap phase status or approval changed.

The owner subsequently requested Codex and other tool discovery. Moved the canonical skill, feature map and unchanged executable helper to `.agents/skills/verify-hasaweb`; `.cursor/skills/verify-hasaweb` contains relative file symlinks to the canonical skill so both tools share one maintained copy. Updated the documented commands and README links. Checked both paths resolve to the same files, all relative documentation links remain valid, and Node resolves the helper dependencies through both entry points. Used file symlinks because the verification runner reads every untracked file for source provenance and rejects a directory symlink with `EISDIR`. The initial docs gate exposed that packaging incompatibility; the file-link version passes the repeated gate. This packaging change does not alter application or helper behavior.

## Documentation impact

The new maintained feature map adds a user-journey entry point alongside existing regression profiles. README links to the canonical `.agents` location and explains the Cursor compatibility links. Current status, authentication and roadmap boundaries still apply; later editor/setup/publication activation remains an unresolved product prerequisite, not a requirement for this tooling task.
