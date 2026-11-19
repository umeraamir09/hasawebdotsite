import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright owns e2e/**/*.spec.mjs; Vitest runs *.test.* files. Agent
    // worktrees under .claude/ are separate checkouts with their own runs.
    exclude: [
      ...configDefaults.exclude,
      "**/.wrangler/**",
      "**/.claude/**",
      "e2e/**/*.spec.*",
    ],
  },
});
