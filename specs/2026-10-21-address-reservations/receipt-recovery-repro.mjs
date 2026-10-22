import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(root, "package.json"));
const esbuild = createRequire(require.resolve("wrangler"))("esbuild");
const temporary = await mkdtemp(join(tmpdir(), "address-receipt-repro-"));
try {
  const bundle = join(temporary, "controller.mjs");
  await esbuild.build({
    stdin: {
      contents: `
export { createDraftController } from './apps/web/lib/draft/controller.ts';
export { DraftFailure } from './apps/web/lib/draft/types.ts';
export { createEmptyDraft, initialSetupProgress } from './packages/schema/src/index.ts';`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
  });
  const {
    createDraftController,
    DraftFailure,
    createEmptyDraft,
    initialSetupProgress,
  } = await import(pathToFileURL(bundle));
  let canonical = {
    portfolioId: "portfolio",
    revision: 0,
    firstEditorEnteredAt: null,
    progress: initialSetupProgress(),
    draft: createEmptyDraft({
      themeId: "leaf",
      fontId: "dm-sans",
      colorMode: "system",
    }),
  };
  let receipt;
  let reads = 0;
  const records = new Map();
  const controller = createDraftController({
    ownerId: "owner",
    portfolioId: "portfolio",
    context: "content",
    storage: {
      list: async () => [...records.values()],
      put: async (record) => records.set(record.id, structuredClone(record)),
      remove: async (id) => records.delete(id),
    },
    coordinator: {
      run: async (task) => task(),
      publish() {},
      publishAttempt() {},
      close() {},
    },
    timers: { set() {}, clear() {} },
    transport: {
      read: async () => {
        reads++;
        return structuredClone(canonical);
      },
      readProgress: async () => canonical,
      download: async () => new Blob(),
      action: async (action, body) => {
        if (action === "pending") return null;
        assert.equal(action, "address");
        if (receipt) return { ...receipt, replayed: true };
        canonical = {
          ...canonical,
          revision: 1,
          draft: { ...canonical.draft, requestedSubdomain: body.name },
        };
        receipt = { revision: 1, name: body.name, state: "held" };
        throw new DraftFailure("network", true);
      },
    },
  });
  await controller.initialize();
  controller.setInput(["requestedSubdomain"], "first-device-name");
  await controller.confirmAddress("first-device-name").catch(() => {});
  canonical = {
    ...canonical,
    revision: 2,
    draft: { ...canonical.draft, requestedSubdomain: "second-device-name" },
  };
  await controller.retry().catch(() => {});
  const state = controller.store.getState();
  const observation = {
    canonicalRevision: canonical.revision,
    canonicalName: canonical.draft.requestedSubdomain,
    controllerRevision: state.confirmed.revision,
    controllerName: state.working.requestedSubdomain ?? null,
    status: state.status,
    error: state.error,
    reads,
    journalName: state.batch?.address.name ?? null,
    localName: state.inputs['["requestedSubdomain"]']?.value ?? null,
  };
  console.log(JSON.stringify(observation));
  assert.equal(observation.error, "revision_conflict");
  assert.notEqual(observation.status, "saved");
  assert.equal(observation.journalName, "first-device-name");
  assert.equal(observation.localName, "first-device-name");
  controller.dispose();
} finally {
  await rm(temporary, { recursive: true, force: true });
}
