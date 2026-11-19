import { checkDraftApi } from "./draft-api/checks.mjs";
import { step, test } from "./support/fixtures.mjs";
import { groupFilter } from "./support/groups.mjs";

// GROUP_FILTER=<regexp> runs only matching checks. Checks that call
// `setDraft` or use their own owner run alone; a few early checks continue
// from the previous check's draft and fail when selected without it.
test("draft and progress API contracts", async ({ ownerRuntime }) => {
  test.setTimeout(10 * 60_000);
  const included = groupFilter();
  await checkDraftApi(ownerRuntime, (name, body) =>
    included(name) ? step(name, body) : undefined,
  );
});
