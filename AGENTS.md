# Repository guidelines

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
