import { evidenceDirectory, test } from "./support/fixtures.mjs";

test.describe.configure({ timeout: 15 * 60_000 });

test("publication dispatch with maximum assets", async ({
  nodeSuite,
}, info) => {
  await nodeSuite("e2e/publication/run.mjs", {
    env: {
      S8_MAX_ASSETS: "true",
      S8_EVIDENCE: evidenceDirectory(info, "dispatch"),
    },
  });
});

test("commit and public serving", async ({ nodeSuite }, info) => {
  await nodeSuite("e2e/publication/run.mjs", {
    args: ["--commit-serving"],
    env: {
      S8_CASES: "small,mixed,cat",
      S8_EVIDENCE: evidenceDirectory(info, "serving"),
    },
  });
});
