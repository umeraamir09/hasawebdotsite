# S-7 live check

The owner authorized one verification email, one contact test, and one failure notice to the recipient in the ignored local env file on October 15, 2026. Use `hasaweb.site`. No other recipients or real-quota exhaustion are authorized by that check.

The ignored [.env.email-spike.local](../../.env.email-spike.local) contains:

```dotenv
RESEND_API_KEY=
RESEND_DOMAIN_ID=
EMAIL_SENDING_DOMAIN=hasaweb.site
EMAIL_FROM=hello@hasaweb.site
EMAIL_TEST_TO=
```

Use a key that can read the domain and email delivery status as well as send. Do not commit credentials or paste them into evidence. The sender and recipient must each be one plain email address. The sender's domain must match the verified domain exactly.

Run `pnpm spike:email:live` for read-only domain and existing-delivery checks. Only after the designated recipient has authorized the three tests, run `pnpm spike:email:live --send`. The script checks the domain and every SPF/DKIM record before sending. Messages clearly identify themselves as tests. The verification URL is inert fixture content, not a working recipient-verification flow.

The private journal in `.wrangler/email-live/journal.json` preserves provider IDs and idempotency keys across restarts. A lock prevents overlapping runs. Successful messages are never resent by the harness. Ambiguous sends may retry only within its conservative 23-hour safety window, using the original key and payload. That harness window is not a replacement for the production retry schedule. Do not delete or reset the journal to force resending. After a crash, inspect the journal and provider dashboard before removing a stale lock.

Re-run without `--send` to retrieve delivery statuses without sending mail. Sanitized results go to [live-evidence.json](live-evidence.json). Provider acceptance alone does not pass delivery. `delivered` means the receiving server accepted the message, not that the owner opened it or that it landed in the primary inbox.
