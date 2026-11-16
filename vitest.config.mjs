import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright owns e2e/**/*.spec.mjs; Vitest runs *.test.* files.
    exclude: [...configDefaults.exclude, "**/.wrangler/**", "e2e/**/*.spec.*"],
  },
});
