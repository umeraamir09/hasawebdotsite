import { checkAutosave } from "./autosave/harness.mjs";
import { step, test, workDirectory } from "./support/fixtures.mjs";

// The autosave groups share one page and run in order, so they stay in a
// single test. GROUP_FILTER=<regexp> runs a subset.
test("autosave, recovery and conflict review", async ({
  ownerRuntime,
}, info) => {
  test.setTimeout(15 * 60_000);
  await checkAutosave({
    ...ownerRuntime,
    workDirectory: workDirectory(info, "autosave"),
    step,
  });
});
