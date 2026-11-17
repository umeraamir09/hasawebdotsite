// Shared email budgets (Phase 43). The allowances live in the triggers of
// migration 0018, so concurrent Workers cannot exceed them. Every email first
// reserves acceptance (`reserveEmail`), then each provider attempt reserves a
// dispatch (`reserveDispatch`). Callers never send without both.

export type EmailBudgetKind = "contact" | "verification" | "failure-notice";
export type Reservation = {
  id: string;
  portfolioId: string;
  kind: EmailBudgetKind;
  isTest: boolean;
  // Retries must supply the original acceptance time.
  acceptedAt: number;
};
export type ReserveResult =
  | "reserved"
  // Contact allowance (per portfolio, tests or the global contact share).
  | "limited"
  // This portfolio's verification allowance for the day.
  | "verification-limited"
  // The shared owner-notice allowance. Notices wait for the next day.
  | "deferred";

export const utcDay = (time: number) =>
  new Date(time).toISOString().slice(0, 10);

const raised = (error: unknown, code: string) =>
  String(error instanceof Error ? error.message : error).includes(code);

export async function reserveEmail(
  db: D1Database,
  input: Reservation,
): Promise<ReserveResult> {
  if (input.isTest && input.kind !== "contact")
    throw new Error("Only contact messages can be tests");
  const day = utcDay(input.acceptedAt);
  try {
    await db
      .prepare(
        "INSERT OR IGNORE INTO email_reservation(id,portfolio_id,kind,is_test,day) VALUES(?,?,?,?,?)",
      )
      .bind(input.id, input.portfolioId, input.kind, Number(input.isTest), day)
      .run();
  } catch (error) {
    if (raised(error, "contact_allowance")) return "limited";
    if (raised(error, "verification_allowance")) return "verification-limited";
    if (raised(error, "notice_allowance")) return "deferred";
    throw error;
  }
  const row = await db
    .prepare(
      "SELECT portfolio_id,kind,is_test,day FROM email_reservation WHERE id=?",
    )
    .bind(input.id)
    .first<{
      portfolio_id: string;
      kind: string;
      is_test: number;
      day: string;
    }>();
  if (
    row?.portfolio_id !== input.portfolioId ||
    row.kind !== input.kind ||
    row.is_test !== Number(input.isTest) ||
    row.day !== day
  )
    throw new Error("Reservation identity conflict");
  return "reserved";
}

export type DispatchResult = "reserved" | "daily-limited" | "monthly-limited";

/**
 * Charges one provider attempt to the dispatch day. A replayed attempt ID is
 * not charged twice. An attempt is charged even if the provider then fails,
 * because the provider may have counted it.
 */
export async function reserveDispatch(
  db: D1Database,
  reservation: { id: string; kind: EmailBudgetKind },
  attempt: string,
  now: number,
): Promise<DispatchResult> {
  const day = utcDay(now);
  try {
    await db
      .prepare(
        "INSERT OR IGNORE INTO email_dispatch(attempt,reservation,notice,day,month) VALUES(?,?,?,?,?)",
      )
      .bind(
        attempt,
        reservation.id,
        Number(reservation.kind !== "contact"),
        day,
        day.slice(0, 7),
      )
      .run();
  } catch (error) {
    if (raised(error, "dispatch_daily_allowance")) return "daily-limited";
    if (raised(error, "dispatch_monthly_allowance")) return "monthly-limited";
    throw error;
  }
  const row = await db
    .prepare("SELECT reservation,day FROM email_dispatch WHERE attempt=?")
    .bind(attempt)
    .first<{ reservation: string; day: string }>();
  if (row?.reservation !== reservation.id || row.day !== day)
    throw new Error("Dispatch identity conflict");
  return "reserved";
}
