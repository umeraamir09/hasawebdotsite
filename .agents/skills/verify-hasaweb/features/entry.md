# Entry and signed-out navigation

A visitor reaches sign-in from the entry page, returns home, and receives a sign-in prompt when opening the account page without a session.

## Sub-features

- `entry-home` displays the entry heading and Start building link.
- `entry-start` opens the real sign-in page with both provider choices.
- `entry-return` returns to the entry page from sign-in.
- `entry-direct` handles direct signed-out account navigation.

## How to get to it (user POV)

- Open `/` and choose `Start building`.
- Open `/sign-in` through that link and choose `Back to home`.
- Open `/editor` directly without signing in.

## Driving it with Playwright

Preconditions: fresh migrated local state, no session, three ready Workers. Run `./.agents/skills/verify-hasaweb/scripts/verify.mjs` from the repository root. It performs every entry listed here.

- Open home with `page.goto(origin)`. Require `page.getByRole("heading", { level: 1, name: "Everyone should have a website." })`; capture `01-home`.
- Choose `page.getByRole("link", { name: "Start building", exact: true }).click()`. Require `/sign-in` and enabled buttons named `Continue with GitHub` and `Continue with Google`; capture `02-sign-in`.
- Choose `page.getByRole("link", { name: "Back to home", exact: true }).click()`. Require `/`; capture `03-home-return`.
- Open `page.goto(origin + "/editor")`. Require `/sign-in?reason=session_expired` and heading `Welcome back.`; capture `04-signed-out-entry`.
- Read `journey.json` after cleanup. Require `passed`, zero unexpected external requests/page errors, a 401 rejection for the shell's `POST /api/owner/portfolio`, no other mutation requests and unchanged zero database counts. Confirm trace, screenshots and ARIA snapshots survive and scratch storage is gone.

## Gotchas

- This checks the implemented entry navigation, corresponding to acceptance 1.4 and the signed-out part of 2.1. Discovery examples, complete offer copy and the full initial guide remain future work. Do not claim all of acceptance section 1 passed.
- The helper never clicks provider buttons. That belongs to the account recipe with its different state and fixtures.
- A 200 response from `/editor` serves a static shell. Wait for the client redirect; HTTP status alone cannot prove signed-out behavior.
- The shell attempts provisioning before redirecting. Require the actual 401 and unchanged storage; do not assume that signed-out navigation sends only GET requests.
