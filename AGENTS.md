# Repository guidelines

## Start here

Read [implementation status](docs/implementation-status.md), the relevant [roadmap entry](docs/roadmap.md), and the acceptance criteria and current contracts for the affected subsystem. Use the subsystem links in the baseline. Read historical experiments only when their measured constraints matter to the change. Product requirements control scope; current production contracts supersede older experiments.

Follow [the agent workflow](docs/agent-workflow.md) for phase records, parallel work and verification. Historical spec plans describe their original work; they do not require future design panels, delegation, evidence ledgers or repeated review loops. Explicitly invoked skills and higher-priority instructions still apply.

## Parallel work and approval

Support two modes. Separate owner-led chats remain the default. When the owner requests parallel implementation in one chat, such as "Implement phases 17 and 18 in parallel", that chat coordinates delegated phase work through subagents. The lead checks independence, supplies each worker's scope and worktree path, handles shared contracts, integrates sequentially and reports to the owner. This authorizes delegation for the named work, not creating separate sidebar chats or approving completion. See [the mode instructions](docs/agent-workflow.md#parallel-implementation-and-integration).

Default to two implementation workers, whether owner-led chats or coordinator-led subagents, each in a separate worktree and branch. Inspect `git worktree list` first. Record each task's phase, prerequisites and write boundaries in its phase record. Give overlapping code/contracts one implementation owner; integrate branches sequentially and reconcile shared guidance in that integration. Run heavy verification through `pnpm verify` so worktrees share the local resource lock.

Start work only after the owner approves its prerequisites and their code is integrated into the shared base. A separately approved reusable milestone can unblock a consumer while its parent phase remains unchecked. Request such approval only when it unblocks actual work. Ask for full phase checkoff after implementation and local verification; check the roadmap only after explicit owner approval. Record approvals already given without requesting them again.

## Required documentation impact check

Assess which assumptions the change affects. Search affected current guidance and downstream references once, and update misleading instructions in the same change. Inspect historical specs when current guidance links to an affected contract. Repeat the search only if later changes invalidate it. Check changed links and the final diff before completion.

Record the changed assumption, updated guidance and unresolved prerequisites in the phase record's Documentation impact section. If no documentation changes are needed, one sentence explaining why is enough. Do not inventory unrelated documents or produce search receipts. Preserve historical failures, measurements, migrations and owner approvals. Add a dated supersession note only where an old instruction can still be mistaken for current guidance.

## Verification and evidence

Use targeted checks during development and the applicable local verification profile before completion review. Build affected applications; shared contracts, dependencies, runtime/toolchain changes or uncertain impact require the full gate. Tooling-only and test-only changes need their own checks. Unknown impact defaults to full verification. CI supplements the local gate.

High-risk changes require a separate review focused on the changed boundary: authentication, authorization, privacy, data loss/recovery, migrations, publication/withdrawal or runtime budgets. Ordinary changes need a normal diff review. Do not automatically start review chats or delegate without authorization.

Keep one concise `results.md` per phase, linking existing requirements. Update that record for small follow-up fixes. Keep routine logs/screenshots in ignored run directories. Commit selected reproduction proof for consequential failures, regressions, benchmarks or provider decisions. Existing historical evidence stays intact. A passing fixture does not prove production feasibility, and an approved fallback decision does not prove its implementation works.

## Figma UI reference

Use the [Figma UI direction file](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U/hasaweb.site---Direction-A---SIDE-B?node-id=8-38&t=Yu7NSm3nQFBs7sQL-1) as the visual reference during development. See [docs/ui-direction.md](docs/ui-direction.md) for Figma MCP access details. Use the connected Figma MCP to read the design when implementing UI.

The Figma file is read-only during development. Do not create, edit, or delete anything in it unless the user specifically asks for changes to the file. If a change is necessary and the user has not requested it, explain the proposed change and why it is needed, then ask for permission before making it. Access through Figma MCP does not authorize changes.

## Git branch names

Use `<type>/<short-description>` for new work branches.

- Choose a type from `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, or `ci`.
- Write the description in lowercase kebab-case. Keep it short and specific.
- If the work has an issue number, put it before the description, such as `fix/42-mobile-menu`.
- Examples: `feat/face-reveal`, `docs/git-conventions`, `chore/update-dependencies`.
- Leave existing shared branch names unchanged.

## Git commit messages

Use Conventional Commits: `<type>(<optional-scope>): <description>`.

- Use the same types listed above. Use `revert` when reverting a commit.
- Add a lowercase scope when it clarifies the affected area, such as `spec`, `architecture`, or `ui`. Omit the parentheses when there is no scope.
- Write the description in the imperative, starting with a lowercase verb, such as `add`, `fix`, or `remove`. Do not end it with a period.
- Aim to keep the subject within 72 characters.
- Keep each commit focused on one logical change. Use an optional body to explain why the change was needed and any relevant tradeoffs.
- Mark breaking changes with `!` before the colon and explain them in a `BREAKING CHANGE:` footer.
- Examples: `feat(ui): add face reveal`, `fix(ui): prevent mobile menu overflow`, `docs: add git naming conventions`.

Apply these conventions to new branches and commits. Do not rewrite existing history solely to rename commits.
