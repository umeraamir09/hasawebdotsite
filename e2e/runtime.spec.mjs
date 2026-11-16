import { test } from "./support/fixtures.mjs";

// Uses the committed Wrangler configs and the development state in
// .wrangler/state, like `pnpm dev`.
test("three Workers, bindings, queue and restart persistence", async ({
  nodeSuite,
}) => {
  await nodeSuite("e2e/runtime/run.mjs");
});
