# Repository guidelines

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
