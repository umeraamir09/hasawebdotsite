import { availableParallelism } from "node:os";
import { defineConfig } from "playwright/test";

// End-to-end suites against the built Workers in workerd. Build first
// (`pnpm build`); `pnpm verify` does this for you.
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.mjs",
  outputDir: "test-results",
  // Journeys drive a real browser through several Workers.
  timeout: 5 * 60_000,
  fullyParallel: true,
  // Each worker runs its own workerd runtime and Chromium, which needs about
  // four cores to stay reliable. Override with E2E_WORKERS.
  workers: Number(
    process.env.E2E_WORKERS ?? Math.max(1, Math.floor(availableParallelism() / 4)),
  ),
  // A pass on retry is reported as flaky, so flakes stay visible.
  retries: 1,
  forbidOnly: ci,
  reporter: ci
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"]],
  projects: [
    { name: "editor", testMatch: "editor.spec.mjs" },
    { name: "autosave", testMatch: "autosave.spec.mjs" },
    { name: "api", testMatch: /\/(draft-api|persistence|uploads)\.spec\.mjs$/ },
    { name: "auth", testMatch: "auth.spec.mjs" },
    { name: "renderer", testMatch: "renderer.spec.mjs" },
    { name: "publication", testMatch: "publication.spec.mjs" },
    { name: "runtime", testMatch: "runtime.spec.mjs" },
  ],
});
