---
name: shinzouwosasageyo
description: "Implement a hasaweb.site roadmap phase end to end: branch, build, test, PR, and check it off"
argument-hint: "phase number, e.g. 43 or 42F"
disable-model-invocation: true
---

# Shinzou wo sasageyo (Dedicate your heart)

Implement the requested roadmap phase following [AGENTS.md](../../../AGENTS.md).

1. Read the phase in [docs/roadmap.md](../../../docs/roadmap.md). If a dependency is not checked off on `main`, stop and say which one.
2. Read only what the phase touches: the linked acceptance criteria, the relevant [architecture](../../../docs/architecture.md) sections and package READMEs, and any [open follow-ups](../../../docs/roadmap.md#open-follow-ups) it should absorb.
3. Create a worktree and a `<type>/<short-description>` branch from `main`.
4. Implement the phase with tests: Vitest for logic, a Playwright step in `e2e/` for behavior that crosses Workers or the browser.
5. Update any doc whose contract you changed. Keep docs current-only.
6. Run `pnpm verify` and fix what fails.
7. If the completion criteria pass, check the phase box in the roadmap with a one-line note. If something is left, say so in the note or add an open follow-up instead.
8. Commit in focused Conventional Commits, push, and open a PR whose description says what changed, how it was verified and what is left.
9. Report the branch, PR link, verification results and anything left open.

Ask the owner only for real product decisions (scope, new user-visible behavior the docs don't cover, money or external accounts). Merging the PR is the approval.
