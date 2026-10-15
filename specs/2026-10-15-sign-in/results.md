# Phase 11 results

Implemented on October 15, 2026 on `feat/sign-in`. The owner approved completion on October 15, 2026, and Phase 11 is checked off in the roadmap.

## Delivered behavior

`/sign-in` starts GitHub or Google OAuth and opens `/editor` after success. Both providers use the product D1 auth tables and the Phase 05 verified-only linking rules. Returning sign-in, verified matching-email linking in either order, cancelled authentication, failed requests, retry, and sign-out preserve the existing owner and portfolio identity. Password and email-only sign-in are unavailable.

The editor is a statically rendered shell. Its client reads `/api/owner`, which performs an uncached Better Auth session lookup and the Phase 10 persisted session/deletion checks. The endpoint returns only the owner's ID/name and existing portfolio ID. Signed-out, expired, revoked and deleting sessions cannot retrieve owner data. Copied cache cookies fail immediately after sign-out. A deleting account cannot create a new session.

Production auth accepts only the exact HTTPS apex. Mutations require the exact Origin and JSON content type. The sign-in entry accepts only the two approved providers, the editor success destination and a provider-specific sign-in recovery destination. Arbitrary scope requests, client-supplied ID tokens, password routes and unrelated account mutations fail. Responses use private/no-store, noindex and Vary: Cookie. Production cookies use the proven `__Host-` configuration. Local loopback HTTP has separate development cookie names.

The Next route adapter verifies the original Host before restoring the configured origin. This handles Next's internal localhost URL reconstruction without trusting forwarded-host headers. The browser suite caught the initial mismatch; the corrected built routes pass their smoke checks.

The responsive screens use the read-only Figma authentication designs at nodes `12:48`, `12:118`, `12:145`, `12:178`, and `12:88`. Artwork and provider SVGs are local downloads from those nodes. DM Sans is self-hosted with its license and optical size 14. The browser verifies the font loads, the desktop illustration occupies the reference 576 by 736 rectangle, and all provider assets render at their intended dimensions. At 360, 390 and 768 pixels, the mobile artwork is visible and the document has no horizontal overflow. The fixed-size decorative artwork retains its reference crop.

The Terms and Privacy agreement line is omitted because Figma's handoff at `12:264` explicitly says final policy content is still needed. No unfinished policy links appear. Removing that line changes the right panel's vertical spacing. No Figma content was created, edited or deleted.

## Verification evidence

| Check | Result |
| --- | --- |
| `pnpm check` | Biome, all 11 package typechecks, and all 143 unit tests pass |
| `pnpm build` | All 11 packages pass, including the OpenNext web bundle and site/jobs Worker dry runs |
| `pnpm test:auth:browser` | All 21 product auth integration groups and nine browser journey checks pass |
| Chromium cookie enforcement | HTTPS apex cookies accepted; sibling/asset/HTTP hosts receive none; sibling Domain injection rejected |
| `pnpm test:persistence` | All 31 workerd/D1 persistence/access groups, migration reapplication and restart persistence pass |
| `pnpm test:runtime` | Three Workers, D1, all three R2 buckets, services, Queue, Workflow and restart persistence pass |

[evidence.json](evidence.json) contains sanitized checks, cookie attributes, asset geometry and the Chromium version. It contains no account email, session token, OAuth state value, signing secret or provider secret.

The browser journey verifies a pending live announcement, disabled duplicate requests, a failed-start retry, keyboard-triggered Google consent cancellation, a successful GitHub callback, editor entry, sign-out, and Google reauthentication to the same account and portfolio. Signed-out navigation back to `/editor` redirects to sign-in without rendering the prior owner's name. Chromium reports no runtime exceptions.

Screenshots:

- [Desktop sign-in](sign-in-desktop.png)
- [Mobile sign-in](sign-in-mobile.png)
- [Cancellation](sign-in-cancelled.png)
- [Connecting](sign-in-connecting.png)
- [Authenticated entry](editor-entry.png)

CI runs the browser/auth integration suite after building. [Authentication setup](../../docs/authentication.md) records local and production bindings, callback URLs, commands, and remaining verification.

## Live provider verification

On October 15, 2026, the owner configured development OAuth applications and completed real sign-in through GitHub and Google at `http://127.0.0.1:8787`.

- GitHub returned the owner to `/editor`. D1 confirmed a new verified account, one GitHub provider record and one active session.
- After the owner signed out, D1 confirmed zero stored and active sessions for that account.
- Google then returned the owner to `/editor`. D1 confirmed the same account reference, both provider records and one active session. No additional user account was created.
- The owner reported successful sign-out and returning sign-in with Google, followed by sign-out and returning sign-in with GitHub. The final D1 snapshot confirms the same verified account, both provider records, exactly one stored/active session and no additional account. Provider choice for these returning browser actions comes from the owner's report; session rows do not identify the provider used.

The owner then cancelled real Google authorization. The supplied Zen screenshot and accessibility snapshot show `error=access_denied`, the cancellation message and both provider retry buttons. D1 confirms zero stored/active sessions, unchanged provider links and no additional account. The owner then completed Google sign-in successfully on retry. D1 confirms the original verified account, unchanged GitHub/Google links, exactly one stored/active session and no additional account.

[live-evidence.json](live-evidence.json) records sanitized observations and hashed account references. It excludes provider credentials, account emails, OAuth codes, state values and session tokens. Provider application IDs in generated authorization URLs were checked against the saved configuration without recording their values.

The local real-provider journey passes initial sign-in, verified-email linking, sign-out revocation, returning sign-in, cancellation and retry. Google-first linking and missing/unverified email cases retain fixture coverage. Sample portfolio provisioning is Phase 12, so this live test verifies account identity rather than an existing portfolio's recovery. Fixture coverage for existing portfolio recovery is recorded above. The owner approved completion, and the roadmap checkbox is checked.

## Scope and limitations

The automated integration tests replace provider HTTP responses and consent with fixtures. They retain Better Auth 1.7.7's shipped provider adapters, OAuth state handling, cookies and product D1 writes. The separate owner-assisted live checks above use real development provider applications and actual provider callbacks. Browser tests serve the built application through OpenNext and proxy authentication/owner API requests to those same product handlers in the fixture Worker. Separate requests exercise the actual Next route adapters and local cookie configuration.

Real GitHub and Google callbacks and verified matching-email account linking now pass in the local runtime, as recorded above. Deployed callbacks/TLS and deployed auth CPU remain unverified. This phase does not establish Free-tier production feasibility. The owner configured development provider applications; no production deployment was made.

Phase 12 still owns provisioning the single sample portfolio. Phase 17 owns the complete editor. Phase 15 owns recoverable unsaved edits across session expiry; this phase proves persisted account/portfolio recovery without changing or clearing local draft storage. Phase 47 owns connected-provider settings and disconnect flows.
