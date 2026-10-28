---
name: shinzouwosasageyo
description: "Advance to the next roadmap phase of this project"
argument-hint: "user will provide the phase number"
disable-model-invocation: true
---

# Shinzou wo sasageyo (Dedicate your heart)

## What This Skill Does

Checks prerequisites and advances the project to the next roadmap phase based on the provided phase number.

## When to Use

- When user wants to implement the next phase

## Procedure

1. Check the phase's Dependency Chain, Prerequisites, other related blocking issues like bugs, owner approvals and others in this repository workflow
2. Gather or inspect the required context.
3. Create a fresh git worktree and branch with an appropriate name.
4. Implement the phase's requirements and commit the changes.
5. Verify that the implementation meets the phase's requirements, acceptance criteria and passes all tests. 
5. Report the outcome and any follow-up actions. Include what was implemented, what was tested, and any issues encountered.

## Guidelines

- Do not commit or push changes until owner approval.
- Validate unknown values once at the boundary that owns them. Pass typed values inward instead of repeating `typeof value === "object"` and property-existence checks.
- Do not defensively revalidate values already guaranteed by a schema, constructor, or internal type.
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible

## Resources

Reference bundled resources with relative paths, for example:

- [Roadmap.md](../../../docs/roadmap.md)