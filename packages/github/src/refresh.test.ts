import { describe, expect, it } from "vitest";
import {
  calendarDue,
  PRIVATE_SWEEP_BATCH,
  PRIVATE_SWEEP_INTERVAL_MS,
  parseRefreshMessage,
  REFRESH_REQUEST_WINDOW_MS,
  REFRESH_TTL_MS,
} from "./refresh";

describe("GitHub refresh policy", () => {
  it("uses the owner-approved intervals", () => {
    expect(REFRESH_TTL_MS).toBe(6 * 60 * 60_000);
    expect(REFRESH_REQUEST_WINDOW_MS).toBe(15 * 60_000);
    expect(PRIVATE_SWEEP_INTERVAL_MS).toBe(24 * 60 * 60_000);
    expect(PRIVATE_SWEEP_BATCH).toBe(10);
  });
  it("is due only once the TTL passed since the last successful fetch", () => {
    const fetchedAt = "2026-11-08T00:00:00.000Z";
    const at = Date.parse(fetchedAt);
    expect(calendarDue({ fetchedAt, days: [] }, at + REFRESH_TTL_MS - 1)).toBe(
      false,
    );
    expect(calendarDue({ fetchedAt, days: [] }, at + REFRESH_TTL_MS)).toBe(
      true,
    );
    expect(
      calendarDue(
        { fetchedAt, days: [] },
        at + PRIVATE_SWEEP_INTERVAL_MS - 1,
        PRIVATE_SWEEP_INTERVAL_MS,
      ),
    ).toBe(false);
  });
  it("treats a missing, unreadable or future-dated calendar as due", () => {
    const now = Date.parse("2026-11-08T00:00:00.000Z");
    for (const calendar of [
      null,
      undefined,
      "x",
      {},
      { fetchedAt: "not a date" },
      { fetchedAt: "2026-11-08T01:00:00.000Z" },
    ])
      expect(calendarDue(calendar, now)).toBe(true);
  });
  it("accepts only well-formed refresh messages", () => {
    const message = {
      kind: "github-refresh",
      portfolioId: "portfolio-1",
      requestedAt: 1_794_000_000_000,
    };
    expect(parseRefreshMessage(message)).toEqual(message);
    expect(parseRefreshMessage({ ...message, extra: "dropped" })).toEqual(
      message,
    );
    for (const value of [
      null,
      { id: "probe" },
      { ...message, kind: "other" },
      { ...message, portfolioId: "" },
      { ...message, portfolioId: "x".repeat(129) },
      { ...message, requestedAt: 0 },
      { ...message, requestedAt: 1.5 },
      { ...message, requestedAt: "1" },
    ])
      expect(parseRefreshMessage(value)).toBeNull();
  });
});
