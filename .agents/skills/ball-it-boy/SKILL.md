---
name: ball-it-boy
description: "Commit, push and open a PR for uncommitted changes in a branch or worktree"
argument-hint: "branch name, or 'current' for the current branch"
disable-model-invocation: true
---

# Ball it boy

1. If the branch is `main`, create a `<type>/<short-description>` branch first. Never commit or push to `main`; if asked to, confirm first.
2. Commit the changes in focused groups using the Conventional Commit rules in [AGENTS.md](../../../AGENTS.md).
3. Push the branch.
4. Open a PR if none exists. Its description says what changed, how it was verified (`pnpm verify` output) and what is left.
5. Report the branch, each commit hash and message, and the PR link.
