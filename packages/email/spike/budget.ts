import type { EmailKind } from "../src/index";

// Isolated S-7 schema. Production recipient/outbox wiring belongs to 43-45.
export const SCHEMA = [
  `CREATE TABLE email_reservation (
    id TEXT PRIMARY KEY, site TEXT NOT NULL, kind TEXT NOT NULL,
    is_test INTEGER NOT NULL, day TEXT NOT NULL,
    CHECK(kind IN ('contact','verification','failure-notice')),
    CHECK(is_test IN (0,1)), CHECK(kind = 'contact' OR is_test = 0)
  )`,
  "CREATE INDEX email_day ON email_reservation(day, kind, site)",
  `CREATE TRIGGER email_allowance BEFORE INSERT ON email_reservation
  WHEN NOT EXISTS (SELECT 1 FROM email_reservation WHERE id = NEW.id)
  BEGIN
    SELECT CASE WHEN NEW.kind = 'contact' AND (
      (SELECT COUNT(*) FROM email_reservation WHERE day = NEW.day AND kind = 'contact') >= 90 OR
      (SELECT COUNT(*) FROM email_reservation WHERE day = NEW.day AND kind = 'contact' AND site = NEW.site) >= 10 OR
      (NEW.is_test = 1 AND (SELECT COUNT(*) FROM email_reservation WHERE day = NEW.day AND site = NEW.site AND is_test = 1) >= 2)
    ) THEN RAISE(ABORT, 'contact_allowance') END;
    SELECT CASE WHEN NEW.kind != 'contact' AND
      (SELECT COUNT(*) FROM email_reservation WHERE day = NEW.day AND kind != 'contact') >= 10
      THEN RAISE(ABORT, 'notice_allowance') END;
  END`,
  `CREATE TABLE email_dispatch (
    attempt TEXT PRIMARY KEY, reservation TEXT NOT NULL,
    day TEXT NOT NULL, month TEXT NOT NULL,
    FOREIGN KEY(reservation) REFERENCES email_reservation(id)
  )`,
  "CREATE INDEX dispatch_day ON email_dispatch(day)",
  "CREATE INDEX dispatch_month ON email_dispatch(month)",
  `CREATE TRIGGER dispatch_allowance BEFORE INSERT ON email_dispatch
  WHEN NOT EXISTS (SELECT 1 FROM email_dispatch WHERE attempt = NEW.attempt)
  BEGIN
    SELECT CASE WHEN (SELECT COUNT(*) FROM email_dispatch WHERE day = NEW.day) >= 100
      THEN RAISE(ABORT, 'dispatch_daily_allowance') END;
    SELECT CASE WHEN (SELECT kind FROM email_reservation WHERE id = NEW.reservation) = 'contact'
      AND (SELECT COUNT(*) FROM email_dispatch d JOIN email_reservation r ON r.id = d.reservation WHERE d.day = NEW.day AND r.kind = 'contact') >= 90
      THEN RAISE(ABORT, 'dispatch_daily_allowance') END;
    SELECT CASE WHEN (SELECT kind FROM email_reservation WHERE id = NEW.reservation) != 'contact'
      AND (SELECT COUNT(*) FROM email_dispatch d JOIN email_reservation r ON r.id = d.reservation WHERE d.day = NEW.day AND r.kind != 'contact') >= 10
      THEN RAISE(ABORT, 'dispatch_daily_allowance') END;
    SELECT CASE WHEN (SELECT COUNT(*) FROM email_dispatch WHERE month = NEW.month) >= 3000
      THEN RAISE(ABORT, 'dispatch_monthly_allowance') END;
  END`,
];
export type Reservation = {
  id: string;
  site: string;
  kind: EmailKind;
  isTest: boolean;
  acceptedAt: number;
};
export function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}
export async function reserve(db: D1Database, input: Reservation) {
  if (!input.id || !input.site || (input.isTest && input.kind !== "contact"))
    throw new Error("Invalid reservation");
  const day = utcDay(input.acceptedAt);
  try {
    await db
      .prepare("INSERT OR IGNORE INTO email_reservation VALUES (?, ?, ?, ?, ?)")
      .bind(input.id, input.site, input.kind, Number(input.isTest), day)
      .run();
  } catch (error) {
    const message = String(error);
    if (message.includes("contact_allowance")) return "limited" as const;
    if (message.includes("notice_allowance")) return "deferred" as const;
    throw error;
  }
  const row = await db
    .prepare("SELECT * FROM email_reservation WHERE id = ?")
    .bind(input.id)
    .first<{ site: string; kind: string; is_test: number; day: string }>();
  // Retries must supply the original acceptance timestamp and envelope identity.
  if (
    row?.site !== input.site ||
    row.kind !== input.kind ||
    row.is_test !== Number(input.isTest) ||
    row.day !== day
  )
    throw new Error("Reservation identity conflict");
  return "reserved" as const;
}
export async function reserveDispatch(
  db: D1Database,
  reservation: string,
  attempt: string,
  now: number,
) {
  const day = utcDay(now);
  try {
    await db
      .prepare("INSERT OR IGNORE INTO email_dispatch VALUES (?, ?, ?, ?)")
      .bind(attempt, reservation, day, day.slice(0, 7))
      .run();
  } catch (error) {
    if (String(error).includes("dispatch_daily_allowance"))
      return "daily-limited" as const;
    if (String(error).includes("dispatch_monthly_allowance"))
      return "monthly-limited" as const;
    throw error;
  }
  const row = await db
    .prepare("SELECT reservation, day FROM email_dispatch WHERE attempt = ?")
    .bind(attempt)
    .first<{ reservation: string; day: string }>();
  if (row?.reservation !== reservation || row.day !== day)
    throw new Error("Dispatch identity conflict");
  return "reserved" as const;
}
