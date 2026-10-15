import { expect, it } from "vitest";
import { runFixtures } from "./fixtures";

it("S-6 permission and privacy fixture matrix", async () => {
  const checks = await runFixtures();
  expect(checks.length).toBeGreaterThanOrEqual(35);
  expect(checks.every((check) => check.passed)).toBe(true);
});
