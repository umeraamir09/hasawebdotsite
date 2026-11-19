import { utcDay } from "./email-budget";

// Visitor contact submissions (Phase 44). A submission is accepted only when
// one D1 batch both reserves the shared contact allowance (the migration 0018
// trigger) and inserts its `contact_outbox` row. Either both happen or
// neither does, so concurrent visitors cannot exceed the allowance and an
// accepted message always has a durable row for delivery (Phase 45).

export const VISITOR_HOURLY_LIMIT = 5;
const HOUR_MS = 60 * 60 * 1000;
// Delivery retries run for 24 hours after acceptance (Phase 45).
export const DELIVERY_DEADLINE_MS = 24 * HOUR_MS;

// The portfolio behind a claimed host whose active version publishes a form.
const PUBLISHED = `FROM portfolio p
  JOIN subdomain_claim claim ON claim.portfolio_id=p.id AND claim.state='claimed' AND claim.name=p.subdomain
  JOIN publish_version current ON current.portfolio_id=p.id AND current.n=p.published_version AND current.status='live'
  JOIN publication_candidate c ON c.id=current.candidate_id AND c.status='ready'
  JOIN publication_candidate_index x ON x.candidate_id=c.id
  WHERE p.status='published' AND json_extract(x.value,'$.contact')=1
    AND NOT EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=claim.name)`;

/** The portfolio ID when this host's active version accepts messages. */
export async function contactPortfolio(
  db: D1Database,
  name: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT p.id ${PUBLISHED} AND claim.name=?`)
    .bind(name)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Counts one attempt in the visitor's fixed hourly window for this portfolio
 * and reports whether it is within the limit. `visitor` is an opaque key that
 * the caller derives; raw addresses are never stored.
 */
export async function countVisitorAttempt(
  db: D1Database,
  portfolioId: string,
  visitor: string,
  now: number,
): Promise<boolean> {
  const key = `contact:${portfolioId}:${visitor}`;
  const window = Math.floor(now / HOUR_MS) * HOUR_MS;
  const [, counted] = await db.batch<{ count: number }>([
    // Earlier windows of this key are finished; drop them as we go.
    db
      .prepare("DELETE FROM counter WHERE key=? AND window_start<?")
      .bind(key, window),
    db
      .prepare(
        `INSERT INTO counter(key,window_start,count) VALUES(?,?,1)
        ON CONFLICT(key,window_start) DO UPDATE SET count=count+1 RETURNING count`,
      )
      .bind(key, window),
  ]);
  return (counted?.results[0]?.count ?? Infinity) <= VISITOR_HOURLY_LIMIT;
}

export type Submission = {
  portfolioId: string;
  name: string;
  email: string;
  message: string;
  now: number;
};
export type SubmissionResult =
  | { status: "accepted"; id: string }
  // The portfolio's or the platform's contact allowance for the UTC day.
  | { status: "limited" }
  // Not published with a form, or the recipient is not verified now.
  | { status: "unavailable" };

export async function acceptSubmission(
  db: D1Database,
  submission: Submission,
): Promise<SubmissionResult> {
  const { portfolioId, now } = submission;
  const id = crypto.randomUUID();
  const day = utcDay(now);
  // Checked again inside the batch, so an unpublish or a recipient change
  // that lands after the caller's lookup still rejects the submission.
  const eligible = `EXISTS(SELECT 1 ${PUBLISHED} AND p.id=?1)
    AND EXISTS(SELECT 1 FROM contact_recipient r WHERE r.portfolio_id=?1 AND r.verified_at IS NOT NULL)`;
  try {
    const [, outbox] = await db.batch([
      db
        .prepare(
          `INSERT INTO email_reservation(id,portfolio_id,kind,is_test,day)
          SELECT ?2,?1,'contact',0,?3 WHERE ${eligible}`,
        )
        .bind(portfolioId, id, day),
      db
        .prepare(
          `INSERT INTO contact_outbox(id,portfolio_id,payload,status,attempts,next_attempt_at,is_test,accepted_at,deadline_at,budget_window_start)
          SELECT ?2,?1,json_object('name',?3,'email',?4,'message',?5,'recipientVerifiedAt',
            (SELECT verified_at FROM contact_recipient WHERE portfolio_id=?1)),
            'queued',0,?6,0,?6,?7,?8
          WHERE EXISTS(SELECT 1 FROM email_reservation WHERE id=?2 AND portfolio_id=?1)`,
        )
        .bind(
          portfolioId,
          id,
          submission.name,
          submission.email,
          submission.message,
          now,
          now + DELIVERY_DEADLINE_MS,
          Date.parse(`${day}T00:00:00.000Z`),
        ),
    ]);
    return outbox?.meta.changes === 1
      ? { status: "accepted", id }
      : { status: "unavailable" };
  } catch (error) {
    if (
      String(error instanceof Error ? error.message : error).includes(
        "contact_allowance",
      )
    )
      return { status: "limited" };
    throw error;
  }
}
