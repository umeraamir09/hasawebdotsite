import { expect, it } from "vitest";
import { runProviderFixtures } from "./fixtures";

it("handles email envelopes, provider failures, and idempotent requests", async () => {
  const checks = await runProviderFixtures();
  expect(checks.length).toBeGreaterThanOrEqual(40);
  expect(checks.every((check) => check.passed)).toBe(true);
});
