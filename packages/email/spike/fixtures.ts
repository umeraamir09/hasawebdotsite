import {
  ConsoleProvider,
  contactEmail,
  type Email,
  failureNotice,
  ResendProvider,
  type Transport,
  verificationEmail,
} from "../src/index";
import { reserve, reserveDispatch, SCHEMA, utcDay } from "./budget";

export type Check = { name: string; passed: true };
function check(checks: Check[], name: string, condition: unknown) {
  if (!condition) throw new Error(`Failed: ${name}`);
  checks.push({ name, passed: true });
}
const NOW = Date.parse("2026-10-15T23:59:59Z");
export const messages = [
  verificationEmail(
    "owner@example.com",
    "https://hasaweb.site/settings/contact/verify?token=fixture",
  ),
  contactEmail("owner@example.com", {
    name: "<script>alert(1)</script>\nBcc: nobody@example.com",
    email: "visitor@example.com",
    message: "<img src=x onerror=alert(1)> & plain text",
  }),
  failureNotice("owner@example.com"),
];
export async function runProviderFixtures(): Promise<Check[]> {
  const checks: Check[] = [];
  for (const email of messages) {
    let envelope: Record<string, unknown> = {};
    let headers = new Headers();
    const provider = new ResendProvider(
      "fixture-only",
      "hello@hasaweb.site",
      async (url, init) => {
        if (url !== "https://api.resend.com/emails")
          throw new Error("Wrong URL");
        envelope = JSON.parse(String(init?.body));
        headers = new Headers(init?.headers);
        return Response.json({ id: "fixture-id" });
      },
    );
    const result = await provider.send(email, `fixture/${email.kind}`);
    check(
      checks,
      `${email.kind} is accepted with one fixed-sender recipient`,
      result.status === "accepted" &&
        envelope.from === "hello@hasaweb.site" &&
        JSON.stringify(envelope.to) === '["owner@example.com"]',
    );
    check(
      checks,
      `${email.kind} uses plain text and a stable idempotency header`,
      envelope.text === email.text &&
        !("html" in envelope) &&
        headers.get("Idempotency-Key") === `fixture/${email.kind}`,
    );
    check(
      checks,
      `${email.kind} has only its intended Reply-To`,
      envelope.reply_to === email.replyTo,
    );
  }
  const cases = [
    [400, "validation_error", "rejected"],
    [401, "missing_api_key", "rejected"],
    [403, "validation_error", "rejected"],
    [422, "validation_error", "rejected"],
    [409, "invalid_idempotent_request", "rejected"],
    [409, "concurrent_idempotent_requests", "retry"],
    [409, "resource_locked", "retry"],
    [429, "rate_limit_exceeded", "retry"],
    [429, "daily_quota_exceeded", "quota"],
    [429, "monthly_quota_exceeded", "quota"],
    [500, "application_error", "retry"],
    [503, "service_unavailable", "retry"],
  ] as const;
  for (const [status, name, expected] of cases) {
    const provider = new ResendProvider(
      "fixture",
      "hello@hasaweb.site",
      async () =>
        Response.json(
          { name, message: "PRIVATE visitor@example.com token=secret" },
          { status, headers: { "Retry-After": "600" } },
        ),
    );
    const result = await provider.send(messages[0] as Email, "fixture");
    check(
      checks,
      `${status} ${name} maps to ${expected}`,
      result.status === expected,
    );
    check(
      checks,
      `${name} preserves retry delay without provider text`,
      result.status !== "accepted" &&
        result.retryAfterMs === 600_000 &&
        !JSON.stringify(result).includes("PRIVATE"),
    );
  }
  for (const [label, transport] of [
    [
      "network",
      async () => {
        throw new Error("PRIVATE");
      },
    ],
    ["malformed success", async () => new Response("not json")],
    ["null success", async () => Response.json(null)],
    [
      "malformed rejection",
      async () => new Response("PRIVATE", { status: 403 }),
    ],
    [
      "unknown provider error",
      async () => Response.json({ name: "PRIVATE" }, { status: 500 }),
    ],
  ] as [string, Transport][]) {
    const result = await new ResendProvider(
      "fixture",
      "hello@hasaweb.site",
      transport,
    ).send(messages[0] as Email, "fixture");
    check(
      checks,
      `${label} never claims acceptance or leaks data`,
      result.status !== "accepted" &&
        !JSON.stringify(result).includes("PRIVATE"),
    );
  }
  const timeout: Transport = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    });
  const timed = await new ResendProvider(
    "fixture",
    "hello@hasaweb.site",
    timeout,
    5,
  ).send(messages[0] as Email, "fixture");
  check(
    checks,
    "bounded timeout remains ambiguous and retryable",
    timed.status === "retry" && timed.code === "timeout",
  );
  const dateDelay = await new ResendProvider(
    "fixture",
    "hello@hasaweb.site",
    async () =>
      Response.json(
        { name: "rate_limit_exceeded" },
        {
          status: 429,
          headers: { "Retry-After": "Fri, 16 Oct 2026 00:09:59 GMT" },
        },
      ),
    1000,
    () => NOW,
  ).send(messages[0] as Email, "fixture");
  check(
    checks,
    "HTTP-date Retry-After is respected",
    dateDelay.status === "retry" && dateDelay.retryAfterMs === 600_000,
  );
  let sends = 0;
  const seen = new Map<string, { body: string; id: string }>();
  const idempotent: Transport = async (_url, init) => {
    const key = new Headers(init?.headers).get("Idempotency-Key") as string;
    const body = String(init?.body);
    const previous = seen.get(key);
    if (previous && previous.body !== body)
      return Response.json(
        { name: "invalid_idempotent_request" },
        { status: 409 },
      );
    if (previous) return Response.json({ id: previous.id });
    const id = `fixture-${++sends}`;
    seen.set(key, { body, id });
    return Response.json({ id });
  };
  const provider = new ResendProvider(
    "fixture",
    "hello@hasaweb.site",
    idempotent,
  );
  const first = await provider.send(messages[0] as Email, "same-key");
  const replay = await provider.send(messages[0] as Email, "same-key");
  check(
    checks,
    "idempotent replay returns the same provider ID",
    JSON.stringify(first) === JSON.stringify(replay) && sends === 1,
  );
  const conflict = await provider.send(messages[2] as Email, "same-key");
  check(
    checks,
    "changed payload cannot reuse an idempotency key",
    conflict.status === "rejected" && sends === 1,
  );
  let lostResponse = true;
  const ambiguousProvider = new ResendProvider(
    "fixture",
    "hello@hasaweb.site",
    async (url, init) => {
      const response = await idempotent(url, init);
      if (lostResponse) {
        lostResponse = false;
        throw new Error("connection lost after provider acceptance");
      }
      return response;
    },
  );
  const ambiguous = await ambiguousProvider.send(
    messages[0] as Email,
    "lost-response",
  );
  const recovered = await ambiguousProvider.send(
    messages[0] as Email,
    "lost-response",
  );
  check(
    checks,
    "lost acceptance response retries without sending a second email",
    ambiguous.status === "retry" &&
      recovered.status === "accepted" &&
      sends === 2,
  );
  for (const invalid of [
    { ...messages[0], to: "owner@example.com,second@example.com" },
    { ...messages[0], subject: "Header\r\nBcc: hidden@example.com" },
    {
      ...messages[1],
      replyTo: "visitor@example.com\r\nBcc: hidden@example.com",
    },
  ] as Email[]) {
    let rejected = false;
    try {
      await provider.send(invalid, "bad");
    } catch {
      rejected = true;
    }
    check(
      checks,
      "invalid or multiple-recipient envelope fails locally",
      rejected,
    );
  }
  let count = 0;
  const consoleProvider = new ConsoleProvider(() => {
    count++;
  });
  for (const email of messages)
    await consoleProvider.send(email, `local/${email.kind}`);
  check(
    checks,
    "console provider sends all three types only to the chosen sink",
    count === 3,
  );
  return checks;
}

export async function runBudgetFixtures(db: D1Database): Promise<Check[]> {
  const checks: Check[] = [];
  for (const sql of SCHEMA) await db.prepare(sql).run();
  const input = (
    id: string,
    site = "site",
    kind: Email["kind"] = "contact",
    isTest = false,
    acceptedAt = NOW,
  ) => ({ id, site, kind, isTest, acceptedAt });
  const concurrent = await Promise.all(
    Array.from({ length: 25 }, (_, i) => reserve(db, input(`site-${i}`))),
  );
  check(
    checks,
    "25 concurrent requests accept exactly ten at one site",
    concurrent.filter((x) => x === "reserved").length === 10,
  );
  const retryId = (
    await db
      .prepare("SELECT id FROM email_reservation LIMIT 1")
      .first<{ id: string }>()
  )?.id as string;
  check(
    checks,
    "retry reuses the original reservation even at the site limit",
    (await reserve(db, input(retryId))) === "reserved",
  );
  let conflict = false;
  try {
    await reserve(db, input(retryId, "different-site"));
  } catch {
    conflict = true;
  }
  check(checks, "reservation cannot be reused for another site", conflict);
  const tests = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      reserve(db, input(`test-${i}`, "test-site", "contact", true)),
    ),
  );
  check(
    checks,
    "concurrent test messages consume exactly two test slots",
    tests.filter((x) => x === "reserved").length === 2,
  );
  const rest = await Promise.all(
    Array.from({ length: 120 }, (_, i) =>
      reserve(db, input(`global-${i}`, `site-${Math.floor(i / 10)}`)),
    ),
  );
  check(
    checks,
    "concurrent global acceptance stops at ninety including tests",
    rest.filter((x) => x === "reserved").length === 78,
  );
  const notices = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      reserve(
        db,
        input(`notice-${i}`, "site", i % 2 ? "verification" : "failure-notice"),
      ),
    ),
  );
  check(
    checks,
    "ten verification and notice slots survive exhausted contact capacity",
    notices.filter((x) => x === "reserved").length === 10,
  );
  check(
    checks,
    "exhausted owner-notice allowance defers instead of accepting",
    (await reserve(db, input("deferred", "site", "failure-notice"))) ===
      "deferred",
  );
  check(
    checks,
    "all email types together reserve at most one hundred",
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM email_reservation")
        .first<{ n: number }>()
    )?.n === 100,
  );
  check(
    checks,
    "UTC midnight starts a new acceptance day",
    (await reserve(
      db,
      input("next-day", "site", "contact", false, NOW + 1000),
    )) === "reserved" && utcDay(NOW) !== utcDay(NOW + 1000),
  );
  // A dispatch attempt has a separate ID from the stable provider idempotency key.
  const dispatched = await Promise.all(
    Array.from({ length: 130 }, (_, i) =>
      reserveDispatch(db, retryId, `attempt-${i}`, NOW),
    ),
  );
  check(
    checks,
    "contact retries cannot consume the ten reserved dispatch slots",
    dispatched.filter((x) => x === "reserved").length === 90,
  );
  const noticeId = (
    await db
      .prepare(
        "SELECT id FROM email_reservation WHERE kind != 'contact' LIMIT 1",
      )
      .first<{ id: string }>()
  )?.id as string;
  const noticeDispatch = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      reserveDispatch(db, noticeId, `notice-attempt-${i}`, NOW),
    ),
  );
  check(
    checks,
    "actual dispatch day preserves ten notices and one hundred total attempts",
    noticeDispatch.filter((x) => x === "reserved").length === 10 &&
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM email_dispatch")
          .first<{ n: number }>()
      )?.n === 100,
  );
  const dispatchId = (
    await db
      .prepare("SELECT attempt FROM email_dispatch LIMIT 1")
      .first<{ attempt: string }>()
  )?.attempt as string;
  check(
    checks,
    "same dispatch operation is idempotent at the limit",
    (await reserveDispatch(db, retryId, dispatchId, NOW)) === "reserved",
  );
  check(
    checks,
    "yesterday's retry counts against today's dispatch capacity",
    (await reserveDispatch(db, retryId, "tomorrow-retry", NOW + 1000)) ===
      "reserved",
  );
  // Seed a near-limit month without issuing 3,000 separate Worker requests.
  await db.prepare("DELETE FROM email_dispatch").run();
  const seed = `WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<2998)
    INSERT INTO email_dispatch SELECT 'month-' || x, CASE WHEN x % 100 >= 90 THEN ? ELSE ? END, '2026-10-' || printf('%02d', 1 + x / 100), '2026-10' FROM n`;
  await db.prepare(seed).bind(noticeId, retryId).run();
  const monthEnd = Date.parse("2026-10-31T23:59:59Z");
  check(
    checks,
    "monthly allowance accepts the three-thousandth attempt",
    (await reserveDispatch(db, retryId, "month-last", monthEnd)) === "reserved",
  );
  check(
    checks,
    "monthly allowance blocks the next attempt",
    (await reserveDispatch(db, retryId, "month-over", monthEnd)) ===
      "monthly-limited",
  );
  check(
    checks,
    "UTC month rollover restores dispatch capacity",
    (await reserveDispatch(db, retryId, "new-month", monthEnd + 1000)) ===
      "reserved",
  );
  return checks;
}
