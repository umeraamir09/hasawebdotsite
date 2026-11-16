import { evidenceDirectory, test } from "./support/fixtures.mjs";

test("private uploads and owner-only asset reads", async ({
  nodeSuite,
}, info) => {
  await nodeSuite("e2e/uploads/run.mjs", {
    env: { RUNTIME_EVIDENCE: evidenceDirectory(info, "uploads") },
  });
});
