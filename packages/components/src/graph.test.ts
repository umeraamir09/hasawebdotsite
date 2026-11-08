import { describe, expect, it } from "vitest";
import {
  contributionLabel,
  graphLayout,
  graphLevel,
  graphUpdated,
  validGraphDays,
} from "./graph";

// 2026-11-01 is a Sunday; 2026-11-04 is a Wednesday.
const run = (start: string, counts: number[]) =>
  counts.map((count, index) => ({
    date: new Date(Date.parse(start) + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
    count,
  }));

describe("contribution graph layout", () => {
  it("lines columns up by weekday and never changes a count", () => {
    const days = run("2026-11-04", [0, 4, 0, 1, 0, 0, 0, 2]);
    const layout = graphLayout(days);
    expect(layout.weeks[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(layout.weeks.map((week) => week.length)).toEqual([7, 4]);
    const counts = layout.weeks
      .flat()
      .flatMap((cell) => (cell ? [cell.count] : []));
    expect(counts).toEqual(days.map((day) => day.count));
    expect(layout.total).toBe(7);
    expect(layout.label).toBe("7 contributions from 2026-11-04 to 2026-11-11");
  });
  it("shows zero contributions as an empty but valid graph", () => {
    const layout = graphLayout(run("2026-11-01", [0, 0, 0, 0, 0, 0, 0]));
    expect(layout.total).toBe(0);
    expect(layout.weeks.flat().every((cell) => cell?.level === 0)).toBe(true);
    expect(layout.label).toBe("0 contributions from 2026-11-01 to 2026-11-07");
  });
  it("scales levels to the busiest day", () => {
    expect([0, 1, 6, 11, 20].map((count) => graphLevel(count, 20))).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(graphLevel(3, 0)).toBe(0);
  });
  it("words singular and plural counts and the update date", () => {
    expect(contributionLabel(1, "2026-11-04")).toBe(
      "1 contribution on 2026-11-04",
    );
    expect(contributionLabel(0, "2026-11-04")).toBe(
      "0 contributions on 2026-11-04",
    );
    expect(graphUpdated("2026-11-07T12:30:00.000Z")).toBe("Updated 2026-11-07");
  });
});

describe("graph day validation", () => {
  it("accepts ordered real dates with whole non-negative counts", () => {
    expect(validGraphDays(run("2026-11-01", [0, 3]))).toBe(true);
  });
  it.each([
    [[]],
    [[{ date: "2026-02-30", count: 1 }]],
    [
      [
        { date: "2026-11-02", count: 1 },
        { date: "2026-11-01", count: 1 },
      ],
    ],
    [[{ date: "2026-11-01", count: -1 }]],
    [[{ date: "2026-11-01", count: 1.5 }]],
    [[{ date: "2026-11-01", count: "1" }]],
    [
      Array.from({ length: 367 }, (_, i) => ({
        date: `2025-01-${i}`,
        count: 0,
      })),
    ],
    ["days"],
  ])("rejects malformed input %#", (value) => {
    expect(validGraphDays(value)).toBe(false);
  });
});
