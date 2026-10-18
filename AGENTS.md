# Repository guidelines

## Implementation baseline

Before planning or implementing a phase, read [docs/implementation-status.md](docs/implementation-status.md), its decision changes and the relevant phase protocol/results. Use [docs/roadmap.md](docs/roadmap.md) for order and owner-approved completion. Historical spike instructions do not override the later production protocol. Preserve the documented CPU, quota, recovery and publication constraints when extending completed foundations.

## Required documentation impact check

Every implementation or decision change must include a check for guidance it makes stale. This applies especially when failed tests, measurements, provider restrictions, security findings or owner decisions force a different approach. Passing code checks alone does not complete the work.

1. Identify what changed from the previous plan, why it changed and which earlier assumptions are no longer valid. Search with `rg` for the old approach, names, routes, values and affected capabilities across `AGENTS.md`, `README.md`, `docs/`, `specs/` and package READMEs. Follow references and inspect later roadmap phases that depend on the changed behavior, even if those phases are not being implemented yet.
2. Update affected current guidance in the same change. Check the implementation-status baseline, architecture/decision log, roadmap, product/acceptance requirements, onboarding/authentication/UI guides and package usage instructions as applicable. Correct contradictory instructions where they appear; a new results note alone is insufficient if another current document still prescribes the rejected approach. Leave unaffected documents alone.
3. Update dependent phase scopes, prerequisites and completion checks so they explain how to use the replacement approach. Include required compatibility/migration work, recovery/error handling, access boundaries, measurements and verification where affected. Distinguish implemented behavior from a proposed or unverified replacement. Record unresolved work as an explicit prerequisite before dependent implementation; never imply that a fallback decision proves feasibility.
4. Preserve historical evidence, test counts, migrations and owner approval records. When an older spec can still be mistaken for current instructions, add a dated supersession note linking to the replacement protocol or decision. Do not rewrite the original result to make a rejected approach appear successful. Preserve agreed product scope and the existing phase-approval rules.
5. Before reporting completion, opening a PR or requesting a phase checkoff, repeat the search for superseded guidance, verify affected links and review the diff for contradictions. Record a Documentation impact section in the current spec's `results.md`, listing the changed assumption, documents and dependent phases updated, and unresolved prerequisites. If no documentation needs changing, record what was checked and why it remains accurate.

Do not leave known misleading guidance for a later documentation cleanup. Documentation updates are part of the change's completion criteria. This rule does not authorize changes to the read-only Figma file or checking off a phase without owner approval.

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

## Roadmap Rule

- Make sure to check off the phases that I have explicitly approved after implementation as complete and not leave a completed phase not checked which will cause confusion. After Implementation ask me if you should check it off or not yet.
