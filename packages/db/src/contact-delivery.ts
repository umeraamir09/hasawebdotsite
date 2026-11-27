import {
  contactEmail,
  type Email,
  type EmailProvider,
  failureNotice,
  type SendResult,
  testEmail,
  validAddress,
} from "@hasaweb/email";
import { z } from "zod";
import { DELIVERY_DEADLINE_MS } from "./contact-submission";
import { reserveDispatch, reserveEmail, utcDay } from "./email-budget";
import { OwnerAccessError, type SessionIdentity } from "./repositories";

// Contact message delivery (Phase 45). Every accepted message has one
// `contact_outbox` row. A worker claims an attempt by moving the row to
// `sending` under a lease, charges the attempt to the dispatch budget, then
// calls the provider with one idempotency key per message, so a repeated
// attempt after an interruption cannot deliver twice while the provider
// remembers the key. Sent and finally failed rows lose their payload. A final
// failure owes the owner a notice, which waits for the shared notice
// allowance and stays visible in the editor until it is sent.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Attempt n (1-based) is due this long after acceptance. */
export const DELIVERY_SCHEDULE_MS = [
  0,
  5 * MINUTE,
  30 * MINUTE,
  4 * HOUR,
  DELIVERY_DEADLINE_MS,
] as const;
export const MAX_DELIVERY_ATTEMPTS = DELIVERY_SCHEDULE_MS.length;
// Longer than the provider timeout (10 s), so only an interrupted attempt is
// ever claimed again.
export const DELIVERY_LEASE_MS = 2 * MINUTE;
// A queued row this far past its deadline is abandoned (no provider, or the
// sweep was down) rather than kept forever.
const ABANDON_AFTER_MS = HOUR;
// How often a message waiting for the owner to confirm a new recipient
// checks again.
const UNCONFIRMED_RECHECK_MS = 5 * MINUTE;
const NOTICE_ATTEMPTS = 3;
const NOTICE_RETRY_MS = 5 * MINUTE;
const SWEEP_MESSAGES = 3;
// Three notices, with the three messages above, stay within 50 D1 queries.
const SWEEP_NOTICES = 3;

/** The queue hand-off for one accepted message: only its outbox ID. */
export const outboxMessageSchema = z.strictObject({
  outboxId: z.string().min(1).max(64),
});
export type OutboxMessage = z.infer<typeof outboxMessageSchema>;

export type Decision =
  | { status: "sent" }
  | { status: "queued"; nextAttemptAt: number; code: string }
  | { status: "failed"; code: string };
type Attempted = { acceptedAt: number; deadlineAt: number; attempts: number };

/**
 * When the next attempt after `row.attempts` attempts runs: the later of the
 * schedule slot and the provider's requested delay. Past the deadline, or
 * after the last attempt, the message has finally failed.
 */
export function retryDecision(
  row: Attempted,
  code: string,
  now: number,
  delayMs: number | null,
): Decision {
  const slot = DELIVERY_SCHEDULE_MS[row.attempts];
  if (slot === undefined) return { status: "failed", code };
  const next = Math.max(row.acceptedAt + slot, now + (delayMs ?? 0));
  return next > row.deadlineAt
    ? { status: "failed", code }
    : { status: "queued", nextAttemptAt: next, code };
}

/** The outcome of the attempt just made (`row.attempts` includes it). */
export function deliveryDecision(
  row: Attempted,
  result: SendResult,
  now: number,
): Decision {
  if (result.status === "accepted") return { status: "sent" };
  if (result.status === "rejected")
    return { status: "failed", code: result.code };
  return retryDecision(row, result.code, now, result.retryAfterMs);
}

/** When a dispatch allowance that refused an attempt opens again. */
export function allowanceReopens(
  limit: "daily-limited" | "monthly-limited",
  now: number,
): number {
  const date = new Date(now);
  return limit === "daily-limited"
    ? Math.floor(now / DAY) * DAY + DAY
    : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

const payloadSchema = z.union([
  z.object({
    name: z.string(),
    email: z.string(),
    message: z.string(),
  }),
  z.object({ test: z.literal(1) }),
]);

async function send(
  provider: EmailProvider,
  email: Email,
  key: string,
): Promise<SendResult> {
  try {
    return await provider.send(email, key);
  } catch {
    // The adapters throw only for an envelope they refuse to send.
    return { status: "rejected", code: "invalid_envelope", retryAfterMs: null };
  }
}

export type DeliveryOutcome = "sent" | "retrying" | "failed" | "skipped";

/**
 * Makes the due attempt for one outbox row, if it is due and not held by
 * another worker. Safe to call from the queue, the sweep and the test route
 * at once: only one claim wins.
 */
export async function deliverMessage(
  db: D1Database,
  provider: EmailProvider,
  id: string,
  now: number,
): Promise<DeliveryOutcome> {
  const row = await db
    .prepare(
      `UPDATE contact_outbox SET status='sending',attempts=attempts+1,next_attempt_at=?2
      WHERE id=?1 AND status IN ('queued','sending') AND attempts<?4 AND next_attempt_at<=?3 AND payload IS NOT NULL
      RETURNING portfolio_id,payload,attempts,accepted_at,deadline_at`,
    )
    .bind(id, now + DELIVERY_LEASE_MS, now, MAX_DELIVERY_ATTEMPTS)
    .first<{
      portfolio_id: string;
      payload: string;
      attempts: number;
      accepted_at: number;
      deadline_at: number;
    }>();
  if (!row) return "skipped";
  const attempt: Attempted = {
    acceptedAt: row.accepted_at,
    deadlineAt: row.deadline_at,
    attempts: row.attempts,
  };
  const { attempts } = row;
  // Every update below applies only while this worker's claim still holds.
  const guard = "WHERE id=? AND status='sending' AND attempts=?";
  async function finish(decision: Decision): Promise<DeliveryOutcome> {
    if (decision.status === "sent") {
      await db
        .prepare(
          `UPDATE contact_outbox SET status='sent',payload=NULL,last_error=NULL,finished_at=? ${guard}`,
        )
        .bind(now, id, attempts)
        .run();
      return "sent";
    }
    if (decision.status === "queued") {
      await db
        .prepare(
          `UPDATE contact_outbox SET status='queued',next_attempt_at=?,last_error=? ${guard}`,
        )
        .bind(decision.nextAttemptAt, decision.code, id, attempts)
        .run();
      return "retrying";
    }
    const failed = await db
      .prepare(
        `UPDATE contact_outbox SET status='failed',payload=NULL,last_error=?,finished_at=?,
          notice=CASE WHEN is_test=1 THEN NULL ELSE 'pending' END,notice_next_at=? ${guard}`,
      )
      .bind(decision.code, now, now, id, attempts)
      .run();
    if (failed.meta.changes === 1)
      await sendNotice(db, provider, id, now).catch(() => "retrying");
    return "failed";
  }

  const parsed = payloadSchema.safeParse(JSON.parse(row.payload));
  if (!parsed.success) return finish({ status: "failed", code: "invalid" });
  const payload = parsed.data;
  // Messages go to whichever recipient is confirmed at attempt time. While
  // the owner is confirming a new address the message waits, without
  // spending an attempt, until the deadline. A suspended portfolio or an
  // account being deleted ends it.
  const recipient = await db
    .prepare(
      `SELECT r.email,r.verified_at,(u.deleting_at IS NULL AND p.status NOT IN ('suspended','deleting')) AS active
      FROM portfolio p JOIN user u ON u.id=p.user_id LEFT JOIN contact_recipient r ON r.portfolio_id=p.id
      WHERE p.id=?`,
    )
    .bind(row.portfolio_id)
    .first<{
      email: string | null;
      verified_at: number | null;
      active: number;
    }>();
  if (!recipient?.active)
    return finish({ status: "failed", code: "unavailable" });
  if (recipient.email === null || recipient.verified_at === null) {
    if (now >= row.deadline_at)
      return finish({ status: "failed", code: "recipient_unconfirmed" });
    await db
      .prepare(
        `UPDATE contact_outbox SET status='queued',attempts=attempts-1,next_attempt_at=?,last_error='recipient_unconfirmed' ${guard}`,
      )
      .bind(
        Math.min(now + UNCONFIRMED_RECHECK_MS, row.deadline_at),
        id,
        attempts,
      )
      .run();
    return "retrying";
  }
  const to = recipient.email;

  const reservation = { id, kind: "contact" as const };
  const dispatch = await reserveDispatch(
    db,
    reservation,
    `${id}/${row.attempts}`,
    now,
  );
  if (dispatch !== "reserved") {
    // Nothing reached the provider, so the attempt is not spent.
    const reopens = allowanceReopens(dispatch, now);
    if (reopens > row.deadline_at)
      return finish({ status: "failed", code: dispatch });
    await db
      .prepare(
        `UPDATE contact_outbox SET status='queued',attempts=attempts-1,next_attempt_at=?,last_error=? ${guard}`,
      )
      .bind(reopens, dispatch, id, attempts)
      .run();
    return "retrying";
  }
  const email = "test" in payload ? testEmail(to) : contactEmail(to, payload);
  return finish(
    deliveryDecision(
      attempt,
      await send(provider, email, `contact/${id}`),
      now,
    ),
  );
}

export type NoticeOutcome = "sent" | "deferred" | "retrying" | "failed";

/**
 * Sends the owner's final-failure notice for one failed row, to the
 * provider-verified account email or else the verified recipient. Over the
 * shared notice allowance it is deferred to the next UTC day, never sent.
 */
export async function sendNotice(
  db: D1Database,
  provider: EmailProvider,
  id: string,
  now: number,
): Promise<NoticeOutcome | "skipped"> {
  const row = await db
    .prepare(
      `UPDATE contact_outbox SET notice_attempts=notice_attempts+1,notice_next_at=?2
      WHERE id=?1 AND status='failed' AND notice IN ('pending','deferred') AND notice_next_at<=?3 AND notice_attempts<?4
      RETURNING portfolio_id,notice_attempts,notice_reserved_at`,
    )
    .bind(id, now + DELIVERY_LEASE_MS, now, NOTICE_ATTEMPTS)
    .first<{
      portfolio_id: string;
      notice_attempts: number;
      notice_reserved_at: number | null;
    }>();
  if (!row) return "skipped";
  const guard = "WHERE id=? AND notice_attempts=?";
  const settle = async (
    notice: "pending" | "deferred" | "sent" | "failed",
    nextAt: number | null,
    attempts = row.notice_attempts,
  ) => {
    await db
      .prepare(
        `UPDATE contact_outbox SET notice=?,notice_next_at=?,notice_attempts=? ${guard}`,
      )
      .bind(notice, nextAt, attempts, id, row.notice_attempts)
      .run();
  };
  const owner = await db
    .prepare(
      `SELECT u.email AS account,u.email_verified AS account_verified,r.email AS recipient,r.verified_at
      FROM portfolio p JOIN user u ON u.id=p.user_id LEFT JOIN contact_recipient r ON r.portfolio_id=p.id
      WHERE p.id=? AND u.deleting_at IS NULL`,
    )
    .bind(row.portfolio_id)
    .first<{
      account: string;
      account_verified: number;
      recipient: string | null;
      verified_at: number | null;
    }>();
  const to =
    owner?.account_verified === 1 && validAddress(owner.account)
      ? owner.account
      : owner?.recipient && owner.verified_at !== null
        ? owner.recipient
        : null;
  if (!to) {
    await settle("failed", null);
    return "failed";
  }
  // Deferral does not spend one of the notice's attempts.
  const defer = async () => {
    await settle(
      "deferred",
      allowanceReopens("daily-limited", now),
      row.notice_attempts - 1,
    );
    return "deferred" as const;
  };
  const reservation = { id: `notice-${id}`, kind: "failure-notice" as const };
  const acceptedAt = row.notice_reserved_at ?? now;
  const reserved = await reserveEmail(db, {
    ...reservation,
    portfolioId: row.portfolio_id,
    isTest: false,
    acceptedAt,
  });
  if (reserved !== "reserved") return defer();
  if (row.notice_reserved_at === null)
    await db
      .prepare(
        "UPDATE contact_outbox SET notice_reserved_at=COALESCE(notice_reserved_at,?) WHERE id=?",
      )
      .bind(acceptedAt, id)
      .run();
  if (
    (await reserveDispatch(
      db,
      reservation,
      `${reservation.id}/${row.notice_attempts}`,
      now,
    )) !== "reserved"
  )
    return defer();
  const result = await send(
    provider,
    failureNotice(to),
    `failure-notice/${id}`,
  );
  if (result.status === "accepted") {
    await settle("sent", null);
    return "sent";
  }
  if (result.status === "rejected" || row.notice_attempts >= NOTICE_ATTEMPTS) {
    await settle("failed", null);
    return "failed";
  }
  await settle(
    "pending",
    now + Math.max(NOTICE_RETRY_MS, result.retryAfterMs ?? 0),
  );
  return "retrying";
}

/**
 * The cron sweep: ends rows that can no longer be attempted, then makes a
 * bounded batch of due attempts (retries and interrupted claims) and notices.
 * The queue only speeds up first attempts; this sweep alone keeps delivery
 * going if a message or a worker is lost.
 */
export async function sweepContactOutbox(
  db: D1Database,
  provider: EmailProvider | null,
  now: number,
) {
  await db
    .prepare(
      `UPDATE contact_outbox SET status='failed',payload=NULL,last_error=COALESCE(last_error,'interrupted'),finished_at=?1,
        notice=CASE WHEN is_test=1 THEN NULL ELSE 'pending' END,notice_next_at=?1
      WHERE status IN ('queued','sending') AND next_attempt_at<=?1 AND (attempts>=?2 OR deadline_at<?3)`,
    )
    .bind(now, MAX_DELIVERY_ATTEMPTS, now - ABANDON_AFTER_MS)
    .run();
  if (!provider) return;
  const due = await db
    .prepare(
      `SELECT id FROM contact_outbox WHERE status IN ('queued','sending') AND next_attempt_at<=? AND attempts<?
      ORDER BY next_attempt_at LIMIT ?`,
    )
    .bind(now, MAX_DELIVERY_ATTEMPTS, SWEEP_MESSAGES)
    .all<{ id: string }>();
  for (const { id } of due.results) await deliverMessage(db, provider, id, now);
  const notices = await db
    .prepare(
      `SELECT id FROM contact_outbox WHERE notice IN ('pending','deferred') AND notice_next_at<=?
      ORDER BY notice_next_at LIMIT ?`,
    )
    .bind(now, SWEEP_NOTICES)
    .all<{ id: string }>();
  for (const { id } of notices.results) await sendNotice(db, provider, id, now);
}

export type DeliveryStatus = {
  // Visitor messages still being delivered.
  delivering: number;
  // The latest test message.
  test: null | { state: "delivering" | "sent" | "failed"; acceptedAt: number };
  // Visitor messages that finally failed in the last 30 days, newest first.
  failures: {
    acceptedAt: number;
    failedAt: number;
    notice: "pending" | "deferred" | "sent" | "failed";
  }[];
};
export type DeliveryFailure = "no_recipient" | "limited" | "unavailable";
export type TestResult =
  | {
      ok: true;
      outcome: Exclude<DeliveryOutcome, "skipped">;
      status: DeliveryStatus;
    }
  | { ok: false; error: DeliveryFailure; status: DeliveryStatus };
const FAILURE_WINDOW_MS = 30 * DAY;
const state = (status: string) =>
  status === "sent" ? "sent" : status === "failed" ? "failed" : "delivering";

/** The owner's delivery status and Send test message. No message content. */
export function ownerContactDelivery(
  db: D1Database,
  identity: SessionIdentity,
  env: { provider: EmailProvider | null; now?: () => number },
) {
  const now = env.now ?? Date.now;
  const owned = `SELECT p.id FROM portfolio p JOIN user u ON u.id=p.user_id JOIN session s ON s.user_id=u.id
    WHERE u.id=? AND s.id=? AND s.expires_at>? AND u.deleting_at IS NULL`;
  async function portfolio(): Promise<string> {
    const row = await db
      .prepare(owned)
      .bind(identity.user.id, identity.session.id, now())
      .first<{ id: string }>();
    if (!row) throw new OwnerAccessError();
    return row.id;
  }
  async function status(): Promise<DeliveryStatus> {
    const id = await portfolio();
    const [delivering, test, failures] = await db.batch([
      db
        .prepare(
          "SELECT count(*) AS n FROM contact_outbox WHERE portfolio_id=? AND is_test=0 AND status IN ('queued','sending')",
        )
        .bind(id),
      db
        .prepare(
          "SELECT status,accepted_at FROM contact_outbox WHERE portfolio_id=? AND is_test=1 ORDER BY accepted_at DESC LIMIT 1",
        )
        .bind(id),
      db
        .prepare(
          `SELECT accepted_at,finished_at,notice FROM contact_outbox
          WHERE portfolio_id=? AND is_test=0 AND status='failed' AND finished_at>?
          ORDER BY finished_at DESC LIMIT 10`,
        )
        .bind(id, now() - FAILURE_WINDOW_MS),
    ]);
    const latest = test?.results[0] as
      | { status: string; accepted_at: number }
      | undefined;
    return {
      delivering: (delivering?.results[0] as { n: number } | undefined)?.n ?? 0,
      test: latest
        ? { state: state(latest.status), acceptedAt: latest.accepted_at }
        : null,
      failures: (
        (failures?.results ?? []) as {
          accepted_at: number;
          finished_at: number;
          notice: DeliveryStatus["failures"][number]["notice"] | null;
        }[]
      ).map((row) => ({
        acceptedAt: row.accepted_at,
        failedAt: row.finished_at,
        notice: row.notice ?? "failed",
      })),
    };
  }

  return {
    status,

    /** Sends a test to the verified recipient through the visitor path. */
    async sendTest(): Promise<TestResult> {
      const portfolioId = await portfolio();
      const fail = async (error: DeliveryFailure): Promise<TestResult> => ({
        ok: false,
        error,
        status: await status(),
      });
      if (!env.provider) return fail("unavailable");
      const at = now();
      const id = crypto.randomUUID();
      const verified =
        "EXISTS(SELECT 1 FROM contact_recipient r WHERE r.portfolio_id=?1 AND r.verified_at IS NOT NULL)";
      let inserted: boolean;
      try {
        const [reservation] = await db.batch([
          db
            .prepare(
              `INSERT INTO email_reservation(id,portfolio_id,kind,is_test,day)
              SELECT ?2,?1,'contact',1,?3 WHERE ${verified}`,
            )
            .bind(portfolioId, id, utcDay(at)),
          db
            .prepare(
              `INSERT INTO contact_outbox(id,portfolio_id,payload,status,attempts,next_attempt_at,is_test,accepted_at,deadline_at,budget_window_start)
              SELECT ?2,?1,json_object('test',1),
                'queued',0,?3,1,?3,?4,?5
              WHERE EXISTS(SELECT 1 FROM email_reservation WHERE id=?2 AND portfolio_id=?1)`,
            )
            .bind(
              portfolioId,
              id,
              at,
              at + DELIVERY_DEADLINE_MS,
              Math.floor(at / DAY) * DAY,
            ),
        ]);
        inserted = reservation?.meta.changes === 1;
      } catch (error) {
        if (String(error).includes("contact_allowance")) return fail("limited");
        throw error;
      }
      if (!inserted) return fail("no_recipient");
      const outcome = await deliverMessage(db, env.provider, id, at);
      return {
        ok: true,
        // Only a concurrent sweep could claim it first; it is on its way.
        outcome: outcome === "skipped" ? "retrying" : outcome,
        status: await status(),
      };
    },
  };
}
