import { describe, expect, it } from "vitest";
import {
  allowanceReopens,
  DELIVERY_SCHEDULE_MS,
  deliveryDecision,
  retryDecision,
} from "./contact-delivery";

const MIN = 60_000;
const HOUR = 60 * MIN;
const accepted = Date.UTC(2026, 10, 19, 10);
const row = (attempts: number) => ({
  acceptedAt: accepted,
  deadlineAt: accepted + 24 * HOUR,
  attempts,
});
const retry = (retryAfterMs: number | null = null) =>
  ({ status: "retry", code: "http_503", retryAfterMs }) as const;

describe("contact delivery schedule", () => {
  it("attempts immediately, then at 5 min, 30 min, 4 h and 24 h", () => {
    expect(DELIVERY_SCHEDULE_MS).toEqual([
      0,
      5 * MIN,
      30 * MIN,
      4 * HOUR,
      24 * HOUR,
    ]);
    const slots = [1, 2, 3, 4].map((attempts) =>
      retryDecision(row(attempts), "http_503", accepted, null),
    );
    expect(slots).toEqual(
      [5 * MIN, 30 * MIN, 4 * HOUR, 24 * HOUR].map((offset) => ({
        status: "queued",
        nextAttemptAt: accepted + offset,
        code: "http_503",
      })),
    );
  });

  it("fails finally after the fifth attempt", () => {
    expect(deliveryDecision(row(5), retry(), accepted + 24 * HOUR)).toEqual({
      status: "failed",
      code: "http_503",
    });
  });

  it("fails permanent errors at once and records sends", () => {
    expect(
      deliveryDecision(
        row(1),
        { status: "rejected", code: "validation_error", retryAfterMs: null },
        accepted,
      ),
    ).toEqual({ status: "failed", code: "validation_error" });
    expect(
      deliveryDecision(row(1), { status: "accepted", id: "e1" }, accepted),
    ).toEqual({ status: "sent" });
  });

  it("honours a longer provider delay within the deadline", () => {
    const now = accepted + 1000;
    expect(deliveryDecision(row(1), retry(2 * HOUR), now)).toEqual({
      status: "queued",
      nextAttemptAt: now + 2 * HOUR,
      code: "http_503",
    });
    // A shorter delay keeps the schedule slot.
    expect(deliveryDecision(row(1), retry(1000), now)).toMatchObject({
      nextAttemptAt: accepted + 5 * MIN,
    });
    // Quota answers follow the same path.
    expect(
      deliveryDecision(
        row(2),
        { status: "quota", code: "daily_quota_exceeded", retryAfterMs: null },
        now,
      ),
    ).toMatchObject({ status: "queued", nextAttemptAt: accepted + 30 * MIN });
  });

  it("fails when the provider delay passes the deadline", () => {
    expect(
      deliveryDecision(row(4), retry(2 * HOUR), accepted + 23 * HOUR),
    ).toEqual({ status: "failed", code: "http_503" });
    // Exactly at the deadline is still allowed.
    expect(
      deliveryDecision(row(4), retry(HOUR), accepted + 23 * HOUR),
    ).toMatchObject({ status: "queued", nextAttemptAt: accepted + 24 * HOUR });
  });

  it("reopens dispatch allowances at the next UTC day or month", () => {
    const now = Date.UTC(2026, 10, 30, 23, 59);
    expect(allowanceReopens("daily-limited", now)).toBe(Date.UTC(2026, 11, 1));
    expect(allowanceReopens("monthly-limited", now)).toBe(
      Date.UTC(2026, 11, 1),
    );
    expect(
      allowanceReopens("monthly-limited", Date.UTC(2026, 11, 31, 12)),
    ).toBe(Date.UTC(2027, 0, 1));
  });
});
