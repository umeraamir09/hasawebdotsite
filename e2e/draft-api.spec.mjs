import { checkDraftApi } from "./draft-api/checks.mjs";
import { step, test } from "./support/fixtures.mjs";

test("draft and progress API contracts", async ({ ownerRuntime }) => {
  test.setTimeout(10 * 60_000);
  await checkDraftApi(ownerRuntime, step);
});
