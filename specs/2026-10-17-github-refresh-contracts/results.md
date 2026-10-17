# Phase 11D results

Implemented October 17, 2026 on `feat/github-refresh-contracts`. The owner approved Phase 11D completion on October 17, 2026; the roadmap checkbox is checked.

## Implementation

- Migration `0004_github_refresh_contracts.sql` adds generation-bound caches and global app/account consent and cleanup coordination without rebuilding existing portfolio tables. Unknown legacy calendars are cleared. Unbound legacy ciphertext is quarantined and blocks private reconsent until reconciled. Public-only setup remains available.
- Owner selection, withdrawal, and grant activation use conditional D1 transitions. Refresh success and error writes check captured generation, stable identity, account deletion, and current authorization. Old unconditional connection/activity upserts are removed. Database triggers also reject unversioned authorization and legacy `private_counts` writes.
- The public projection selects the independently safe public calendar or the complete authorized calendar. It never sums or subtracts them. Authorization alone cannot change a public-only publication; stable ID, username, cache generation, published private choice, and current grant must match. Output contains only username/profile link, availability, fetch date, and date/count values.
- AES-GCM ciphertext binds the portfolio, activity app, stable account, and consent operation. Withdrawal clears active credentials and authorized data atomically and moves encrypted credentials to separate durable cleanup storage. Graph operations leave sign-in provider rows intact.
- Cleanup claims are global to the activity app/account. One persisted attempt may call GitHub. Failed HTTP responses retain ciphertext with a one-minute retry floor. Duplicate/old deliveries cannot obtain credentials or call the provider after a fresh consent. Interrupted/in-flight requests retain their lock for reconciliation, without clock-based lock stealing.

## Initial validation

| Check | Result and evidence |
| --- | --- |
| Repository check | `pnpm check` passes lint, all workspace typechecks, and 183 unit tests in 18 files. Ten unit tests directly cover the new projection/encryption/deletion contracts. |
| Build | `pnpm build` passes all 12 workspace builds, including OpenNext and jobs/site dry-run bundles. |
| Migration, access and lifecycle | `pnpm test:persistence` passes 64 groups, including 19 new GitHub groups, tracked migration reapplication, repeatable fixtures, and restart recovery. See [persistence evidence](persistence-evidence.json). |
| Auth regression | `pnpm test:auth` passes 22 groups, including Chromium cookie enforcement. See [auth evidence](auth-evidence.json). Provider responses are controlled fixtures. |
| Bounded saves | `pnpm test:bounded-saves` passes all 17 groups, including exact 1 MiB, conflicts, owner/session boundaries, recovery, and canonical progress. See [bounded-save evidence](bounded-save-evidence.json). This is a local regression run, not a new deployed CPU measurement. |
| Runtime | `pnpm test:runtime` passes three Workers, D1, three R2 buckets, service bindings, Queue, Workflow and restart persistence. The first attempt encountered a local address collision while other test Workers were running; the separate retry passed. |

Persistence fixtures cover public 2 versus authorized 7 counts, draft consent under a public-only publication, mismatched account/username, every stale error class after withdrawal, selection during consent, active username changes, concurrent consent reservations, remote failure, attempted cross-owner reconnect, one in-flight cleanup, delayed retries, fresh authorization, duplicate old cleanup delivery, and unknown legacy caches. An encrypted failed cleanup survives owner deletion and a Worker restart, decrypts on retry, finishes, and clears its ciphertext. Earlier phase evidence remains unchanged; regression artifacts are stored here.

## PR review follow-up

The [Codex P1 finding](https://github.com/umeraamir09/hasawebdotsite/pull/15#discussion_r4302296911) identified issued tokens discarded on identity/scope rejection. A new workerd/D1 regression reproduced it before the fix: the rejected callback left `consent` instead of the expected `pending` cleanup state.

Rejected callbacks now encrypt and persist the issued credential before reporting failure. The AES-GCM binding authenticates the verified account and token-only cleanup purpose. Cleanup revokes that token through GitHub's single-token endpoint, preserving another account's active grant. The original selected-account reservation stays blocked through failed cleanup and releases after successful retry. Existing grant-wide cleanup bindings remain compatible, and no schema migration is needed.

After the fix, `pnpm check` passes all 184 unit tests and all workspace lint/typechecks. `pnpm build` passes all 12 workspace builds. `pnpm test:persistence` passes 65 groups, including rejected scopes, a wrong account with an existing active grant, encrypted retention, failed cleanup/retry, reconnect blocking, unchanged graph selection/output, and duplicate cleanup delivery after a new consent reservation. See [review-fix persistence evidence](review-fix-persistence-evidence.json). The original phase evidence above remains unchanged.

## Remaining integration

Production provider fetching, session/state/PKCE callbacks, graph UI, immutable publication-config resolution, the public endpoint, cache purge, queues, cron, key/secret provisioning, and operational reconciliation remain their scheduled phases. These contracts have no public routes or production deployment. The Figma file was not needed for this backend-only increment and was not modified.

Future OAuth adapters must reserve consent before exchanging a code and must not cancel an exchange that may still issue a token. Uncertain provider deletion and crashed in-flight attempts need durable execution/operator reconciliation before a retry or release. A lost response is not proof of deletion; 401/404 alone does not release the grant-wide lock. Account deletion must withdraw active grants before removing connection rows, then complete remote cleanup and remove residual coordinator metadata.
