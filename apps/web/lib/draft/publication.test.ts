import { afterEach, expect, it, vi } from "vitest";
import { createDraftController, type DraftController } from "./controller";
import { checkPublication } from "./publication";
import { fixtureTransport, memoryStorage } from "./test-fixtures";

const controllers: DraftController[] = [];
async function setup() {
  const fixture = fixtureTransport();
  const controller = createDraftController({
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "content",
    transport: fixture.transport,
    storage: memoryStorage(),
    coordinator: {
      exclusive: true,
      run: (work) => work(),
      publish: () => {},
      publishAttempt: () => {},
      close: () => {},
    },
  });
  controllers.push(controller);
  await controller.initialize();
  return controller;
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});
it("checks every object page at one confirmed revision while editing stays paused", async () => {
  const controller = await setup();
  controller.edit(["profile", "name"], "My name");
  const send = vi.fn<typeof fetch>(async (_input, init) => {
    expect(controller.store.getState().suspended).toBe(true);
    const command = JSON.parse(String(init?.body));
    return Response.json({
      portfolioId: "portfolio-a",
      revision: command.revision,
      issues: [],
      hasMoreIssues: false,
      nextAssetOffset: command.assetOffset === 0 ? 8 : null,
    });
  });
  const result = await checkPublication(controller, send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(send.mock.calls[1]?.[1]?.body)).assetOffset).toBe(8);
  expect(result.issues).toEqual([]);
  expect(controller.store.getState().suspended).toBe(false);
});
it("keeps local unfinished input and never sends it as ready saved content", async () => {
  const controller = await setup();
  controller.setInput(["links", { id: "link" }, "value"], "https://");
  const send = vi.fn<typeof fetch>();
  await expect(checkPublication(controller, send)).rejects.toMatchObject({
    code: "recovery_required",
  });
  expect(send).not.toHaveBeenCalled();
  expect(Object.keys(controller.store.getState().inputs)).toHaveLength(1);
  expect(controller.store.getState().suspended).toBe(false);
});
it.each(["owner", "revision"])(
  "rejects a changed %s in the check response",
  async (kind) => {
    const controller = await setup();
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      const command = JSON.parse(String(init?.body));
      return Response.json({
        portfolioId: kind === "owner" ? "foreign" : command.portfolioId,
        revision: kind === "revision" ? command.revision + 1 : command.revision,
        issues: [],
        hasMoreIssues: false,
        nextAssetOffset: null,
      });
    });
    await expect(checkPublication(controller, send)).rejects.toMatchObject({
      code: kind === "owner" ? "owner_changed" : "revision_conflict",
    });
    expect(controller.store.getState().suspended).toBe(false);
    expect(controller.store.getState().status).toBe("blocked");
  },
);
