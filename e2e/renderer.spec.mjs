import { evidenceDirectory, test } from "./support/fixtures.mjs";

test("shared renderer: preview and static output parity", async ({
  nodeSuite,
}, info) => {
  await nodeSuite("e2e/renderer/run.mjs", {
    env: { RENDERER_EVIDENCE: evidenceDirectory(info, "renderer") },
  });
});
