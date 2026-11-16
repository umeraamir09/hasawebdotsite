import { test } from "./support/fixtures.mjs";

test("D1 persistence, migrations and owner boundaries", async ({
  nodeSuite,
}) => {
  await nodeSuite("e2e/persistence/run.mjs");
});
