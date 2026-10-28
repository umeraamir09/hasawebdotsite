---
name: ball-it-boy
description: "Commit, push and open a pr for uncommitted changes in a branch or worktree"
argument-hint: "user will reference the branch or say current to use the current branch"
disable-model-invocation: true
---

# Shinzou wo sasageyo (Dedicate your heart)

## What This Skill Does

Commit, push and open a pr for uncommitted changes in a branch or worktree

## When to Use

- When user wants to Commit, push and open a pr for uncommitted changes in a branch or worktree

## Procedure

1. Commit changes in appropriate groups following the commit naming convention of this repo (AGENTS.md).
2. Push the changes to the remote repository.
3. Open a pull request for the changes if doesnt already exist.
4. Report commit hashes with messages and pull request link to the user. (also include the branch name)

## Guidelines

- NEVER commit and push directly to main
- If asked to push to main always confirm if they user wants to really do that.

## Resources

Reference bundled resources with relative paths, for example:

- [Roadmap.md](../../../docs/roadmap.md)