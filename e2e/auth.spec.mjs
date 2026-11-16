import { evidenceDirectory, test } from "./support/fixtures.mjs";

test("sign-in, sessions, provisioning and the rendered auth UI", async ({
  nodeSuite,
}, info) => {
  await nodeSuite("e2e/auth/run.mjs", {
    args: ["--browser"],
    env: { AUTH_EVIDENCE: evidenceDirectory(info, "auth") },
  });
});
