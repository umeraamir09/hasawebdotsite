# Phase 07 results

S-7 passes. On October 15, 2026, Resend confirmed `hasaweb.site` and its SPF/DKIM records as verified. With the owner's explicit permission, the adapter sent one verification email, one contact test, and one failure notice to the designated recipient. All three later reached `delivered`. See [live-evidence.json](live-evidence.json). Initial API acceptance and the later read-only delivery check were separate. No real quota was exhausted.

## Local evidence

Run `pnpm spike:email` to reproduce [evidence.json](evidence.json). The isolated loopback Worker runs 63 checks in workerd with local D1. Provider fixtures cover all three message envelopes, plain-text hostile input, fixed sender, visitor Reply-To, permanent rejection, network loss, bounded timeout, malformed responses, rate limits, daily/monthly quota errors, both Retry-After forms, idempotent replay, payload conflict, and recovery after losing the acceptance response.

Atomic D1 insert triggers stop concurrent acceptance at ten contacts per site, ninety contacts globally, and two tests per site per UTC day. Tests consume normal contact capacity. Verification and failure notices share ten separate reservations. A retry reuses its original acceptance reservation. An exhausted notice allowance returns deferred. Failed insertions do not leave reservations.

A separate dispatch ledger limits the actual sending day to ninety contact attempts and ten notice attempts. This prevents yesterday's accepted retries from exhausting today's capacity or consuming notice capacity. An attempt is charged before fetch and stays charged after failure. This deliberately underuses capacity rather than risking the provider cap. The fixture also exercises a 3,000-attempt calendar-month guard. Its UTC calendar-month rollover is a local policy, not proof of the account's billing-period reset. Align the production period with provider usage before release.

Validation passed: all 63 workerd/D1 checks, all 14 repository Vitest tests across six files, repository Biome checks, eleven workspace TypeScript configurations plus the email spike configuration, and `git diff --check`. TypeScript ran directly through the local executable because the WSL pnpm command resolves to an incomplete Windows package-manager installation. No package-manager settings or dependencies changed.

## Provider decisions

- Keep the single-recipient fetch adapter with a fixed verified sender. Visitor input is plain text and never changes From. No CC, BCC, attachments, or automatic reply is present.
- Distinguish permanent rejection, retryable transport/service errors, and quota exhaustion. Preserve safe error codes and Retry-After without retaining provider messages that may contain addresses or tokens. The caller handles deferral and deadlines.
- Resend documents 100 emails per UTC day and 3,000 per month on the free plan. Multiple recipients count separately; inbound traffic also consumes that allowance. Keep this account's capacity dedicated to the app and route abuse mail through the separately planned Cloudflare inbound routing. External traffic/manual sends can still reduce provider capacity. [Quota documentation](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
- Daily quota errors reset at midnight UTC. Monthly quota errors must not be treated as a short request-rate delay. Quota and rate-limit paths are verified with controlled provider fixtures, not a live exhaustion experiment. [Error reference](https://resend.com/docs/api-reference/errors).
- Resend retains idempotency keys for 24 hours and requires an identical request payload. Persist the key and original body for production retries. The final scheduled attempt at the 24-hour deadline must also respect the deadline and key retention. Do not resend ambiguous work after key expiry. Late recovery must record failure without a new send and retain owner-visible status. [Idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Scope and remaining implementation

The sending adapter and templates live in `packages/email/src`. D1 tables and fixture endpoints are isolated spike code, not deployed production APIs. No UI was added or changed.

Phases 43 through 45 still implement recipient verification tokens and expiry, the authoritative recipient lookup, durable outbox insertion in the same transaction as acceptance reservations, dispatch leases, the confirmed retry schedule and deadline, stuck-work recovery, payload deletion, and editor status for deferred notices. The five-per-IP/hour abuse guard, Turnstile, and preview prohibition belong to the public contact flow in phase 44. The console provider writes only to an explicitly chosen local sink and must never be configured in production.

The live harness calls the shared Resend adapter directly and sends only the three approved tests. It does not claim to exercise the future production outbox, verification endpoint, or failure scheduler. `delivered` proves acceptance by the receiving mail server, not inbox placement or human receipt. Credentials, addresses, and verification tokens are absent from committed evidence. Domain DNS values and message content are omitted as well.

The owner approved checking off phase 07 in the roadmap on October 15, 2026.
