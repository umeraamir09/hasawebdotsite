import { afterEach, expect, it, vi } from "vitest";
import { createDraftController, type DraftController } from "./controller";
import { checkPublication, preparePublication } from "./publication";
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

it.each(["avatar", "banner"] as const)(
  "preserves an unfinished %s replacement without suspending the editor",
  async (purpose) => {
    const controller = await setup();
    controller.store.setState({ pendingImages: { [purpose]: true } });
    const suspended: boolean[] = [];
    const unsubscribe = controller.store.subscribe((state) => {
      suspended.push(state.suspended);
    });
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      const command = JSON.parse(String(init?.body));
      return Response.json({
        portfolioId: command.portfolioId,
        revision: command.revision,
        issues: [],
        hasMoreIssues: false,
        nextAssetOffset: null,
      });
    });
    await expect(checkPublication(controller, send)).rejects.toMatchObject({
      code: "recovery_required",
    });
    expect(send).not.toHaveBeenCalled();
    expect(suspended).not.toContain(true);
    expect(controller.store.getState().pendingImages[purpose]).toBe(true);
    unsubscribe();

    controller.store.setState({ pendingImages: {} });
    await expect(checkPublication(controller, send)).resolves.toMatchObject({
      issues: [],
    });
    expect(send).toHaveBeenCalledOnce();
  },
);
it("blocks an image operation started while valid changes are flushing", async () => {
  const controller = await setup();
  const flush = controller.flushValid.bind(controller);
  vi.spyOn(controller, "flushValid").mockImplementation(async () => {
    const result = await flush();
    controller.store.setState({ pendingImages: { avatar: true } });
    return result;
  });
  const quiesce = vi.spyOn(controller, "quiesce");
  const send = vi.fn<typeof fetch>(async (_input, init) => {
    const command = JSON.parse(String(init?.body));
    return Response.json({
      portfolioId: command.portfolioId,
      revision: command.revision,
      issues: [],
      hasMoreIssues: false,
      nextAssetOffset: null,
    });
  });
  await expect(checkPublication(controller, send)).rejects.toMatchObject({
    code: "recovery_required",
  });
  expect(quiesce).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(controller.store.getState().suspended).toBe(false);
});

it("submits only the controller-confirmed revision and keeps edits paused until candidate admission", async () => {
  const controller = await setup();
  controller.edit(["profile", "name"], "Saved before preparation");
  const send = vi.fn<typeof fetch>(async (_input, init) => {
    const command = JSON.parse(String(init?.body));
    return Response.json({
      ...command,
      issues: [],
      hasMoreIssues: false,
      nextAssetOffset: null,
      assetOffset: undefined,
    });
  });
  const submit = vi.fn(
    async (command: {
      ownerId: string;
      portfolioId: string;
      revision: number;
    }) => {
      expect(controller.store.getState().suspended).toBe(true);
      expect(command.revision).toBe(
        controller.store.getState().confirmed?.revision,
      );
      return {
        candidateId: "00000000-0000-4000-8000-000000000001",
        portfolioId: command.portfolioId,
        revision: command.revision,
      };
    },
  );
  expect((await preparePublication(controller, submit, send)).kind).toBe(
    "preparing",
  );
  expect(submit).toHaveBeenCalledTimes(1);
  expect(controller.store.getState().suspended).toBe(false);
});
it("never admits a candidate with unfinished uploads, raw input or checklist issues", async () => {
  const controller = await setup();
  const submit = vi.fn();
  controller.store.setState({ pendingImages: { avatar: true } });
  await expect(preparePublication(controller, submit)).rejects.toMatchObject({
    code: "recovery_required",
  });
  controller.store.setState({ pendingImages: {} });
  const send = vi.fn<typeof fetch>(async (_input, init) => {
    const command = JSON.parse(String(init?.body));
    return Response.json({
      portfolioId: command.portfolioId,
      revision: command.revision,
      issues: [{ code: "required", path: ["profile", "bio"] }],
      hasMoreIssues: false,
      nextAssetOffset: null,
    });
  });
  expect((await preparePublication(controller, submit, send)).kind).toBe(
    "blocked",
  );
  expect(submit).not.toHaveBeenCalled();
  expect(controller.store.getState().suspended).toBe(false);
});

it("publishes one confirmed revision and verifies the persisted commit response", async () => {
  const { publishSavedDraft } = await import("./publish");
  const controller = await setup();
  const stages: string[] = [];
  const calls: string[] = [];
  let operationId = "";
  const send = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    calls.push(path);
    const body = JSON.parse(String(init?.body));
    expect(controller.store.getState().suspended).toBe(true);
    if (path.endsWith("/check"))
      return Response.json({
        portfolioId: body.portfolioId,
        revision: body.revision,
        issues: [],
        hasMoreIssues: false,
        nextAssetOffset: null,
      });
    if (path.endsWith("/status")) return Response.json(null);
    if (path.endsWith("/start")) {
      operationId = body.operationId;
      return Response.json({
        operationId,
        portfolioId: body.portfolioId,
        revision: body.revision,
        stage: "ready",
      });
    }
    return Response.json({
      operationId,
      portfolioId: body.portfolioId,
      revision: controller.store.getState().confirmed?.revision,
      stage: "published",
      url: "https://owner.hasaweb.site",
    });
  });
  const result = await publishSavedDraft(
    controller,
    (operation) => stages.push(operation.stage),
    new AbortController().signal,
    send,
  );
  expect(result.kind).toBe("published");
  expect(stages).toEqual(["ready", "published"]);
  expect(calls.filter((path) => path.endsWith("/commit"))).toHaveLength(1);
  expect(controller.store.getState().suspended).toBe(false);
});

it("never reports success when a commit acknowledgement is lost", async () => {
  const { publishSavedDraft } = await import("./publish");
  const controller = await setup();
  const progress = vi.fn();
  const send = vi.fn<typeof fetch>(async (input, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(input).endsWith("/check"))
      return Response.json({
        portfolioId: body.portfolioId,
        revision: body.revision,
        issues: [],
        hasMoreIssues: false,
        nextAssetOffset: null,
      });
    if (String(input).endsWith("/status")) return Response.json(null);
    if (String(input).endsWith("/start"))
      return Response.json({
        operationId: body.operationId,
        portfolioId: body.portfolioId,
        revision: body.revision,
        stage: "ready",
      });
    throw new Error("lost acknowledgement");
  });
  await expect(
    publishSavedDraft(controller, progress, new AbortController().signal, send),
  ).rejects.toThrow("lost acknowledgement");
  expect(progress.mock.calls.map(([operation]) => operation.stage)).toEqual([
    "ready",
  ]);
  expect(controller.store.getState().suspended).toBe(false);
});
