import { afterEach, expect, it, vi } from "vitest";
import { createDraftController, type DraftController } from "./controller";
import { createRecoveryCoordinator } from "./recovery-coordinator";
import { handoffSetup } from "./setup-handoff";
import { fixtureTransport, memoryStorage } from "./test-fixtures";
import { DraftFailure } from "./types";

const controllers: DraftController[] = [];
async function setup() {
  const transport = fixtureTransport(),
    storage = memoryStorage();
  const controller = createDraftController({
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "setup",
    transport: transport.transport,
    storage,
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
  return { controller, transport, storage };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

it("flushes valid edits and preserves optional raw input while editing stays paused", async () => {
  const { controller, storage } = await setup();
  controller.edit(["profile", "name"], "Confirmed name");
  controller.setInput(
    ["components", { id: "unfinished" }, "data", "url"],
    "https://",
  );
  const send = vi.fn<typeof fetch>(async (_input, init) => {
    expect(controller.store.getState().suspended).toBe(true);
    expect(() => controller.edit(["profile", "bio"], "Racing edit")).toThrow();
    expect(JSON.parse(String(init?.body))).toEqual({
      portfolioId: "portfolio-a",
      revision: 1,
    });
    return Response.json({
      kind: "editor",
      portfolioId: "portfolio-a",
      revision: 2,
      firstEditorEnteredAt: 1,
    });
  });
  const result = await handoffSetup(controller, send);
  expect(result.hasLocalOnlyInput).toBe(true);
  expect(controller.store.getState().working?.profile.name).toBe(
    "Confirmed name",
  );
  expect(controller.store.getState().suspended).toBe(true);
  expect(
    [...storage.records.values()].some((v) => Object.keys(v.inputs).length > 0),
  ).toBe(true);
});
it("does not hand off unconfirmed valid edits after a save failure", async () => {
  const { controller, transport } = await setup();
  controller.edit(["profile", "name"], "Unsaved name");
  vi.spyOn(transport.transport, "action").mockRejectedValue(
    new DraftFailure("network"),
  );
  const send = vi.fn<typeof fetch>();
  await expect(handoffSetup(controller, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  expect(controller.store.getState().working?.profile.name).toBe(
    "Unsaved name",
  );
});
it("keeps invalid required input recoverable and does not submit old saved requirements", async () => {
  const { controller } = await setup();
  controller.setInput(["links", { id: "required" }, "value"], "https://");
  const send = vi.fn<typeof fetch>();
  await expect(handoffSetup(controller, send)).rejects.toMatchObject({
    code: "recovery_required",
  });
  expect(send).not.toHaveBeenCalled();
  expect(controller.store.getState().suspended).toBe(false);
  expect(Object.keys(controller.store.getState().inputs)).toHaveLength(1);
});
it("releases failed handoff pauses and retries a lost successful reply without rewriting setup", async () => {
  const { controller, transport } = await setup();
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("lost reply"))
    .mockResolvedValueOnce(
      Response.json({
        kind: "editor",
        portfolioId: "portfolio-a",
        revision: 1,
        firstEditorEnteredAt: 1,
      }),
    );
  await expect(handoffSetup(controller, send)).rejects.toThrow("lost reply");
  expect(controller.store.getState().suspended).toBe(false);
  expect((await handoffSetup(controller, send)).result.kind).toBe("editor");
  expect(
    transport.calls.filter(
      (v) => v.action !== "read" && v.action !== "pending",
    ),
  ).toEqual([]);
});
it("returns missing requirements and leaves the draft editable", async () => {
  const { controller } = await setup();
  const send = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      kind: "required",
      portfolioId: "portfolio-a",
      revision: 0,
      issues: ["avatar"],
    }),
  );
  expect((await handoffSetup(controller, send)).result.kind).toBe("required");
  expect(controller.store.getState().suspended).toBe(false);
  controller.edit(["profile", "name"], "Still editable");
});
it("persists revision conflicts for the shared review controls", async () => {
  const { controller, storage } = await setup();
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ error: "revision_conflict" }, { status: 409 }),
    );
  await expect(handoffSetup(controller, send)).rejects.toMatchObject({
    code: "revision_conflict",
  });
  expect(
    [...storage.records.values()].some(
      (v) => v.blocked === "revision_conflict",
    ),
  ).toBe(true);
  expect(controller.store.getState().suspended).toBe(false);
});
it("exposes a concurrent save rejection as an actionable attempt conflict", async () => {
  const { controller, storage } = await setup();
  controller.setInput(["profile", "location"], "unfinished local value");
  const send = vi.fn<typeof fetch>(async () => {
    expect(controller.store.getState().pending).toBeNull();
    return Response.json({ error: "save_rejected" }, { status: 409 });
  });
  await expect(handoffSetup(controller, send)).rejects.toMatchObject({
    code: "attempt_conflict",
  });
  expect(controller.store.getState()).toMatchObject({
    status: "blocked",
    error: "attempt_conflict",
    suspended: false,
  });
  expect(
    [...storage.records.values()].some((record) =>
      Object.values(record.inputs).some(
        (input) => input.value === "unfinished local value",
      ),
    ),
  ).toBe(true);
});
it("keeps the current tab editable when optional recovery cannot be persisted", async () => {
  const { controller, storage } = await setup();
  controller.setInput(["profile", "location"], "unfinished local value");
  vi.spyOn(storage, "put").mockRejectedValue(new Error("Storage unavailable"));
  const send = vi.fn<typeof fetch>();
  await expect(handoffSetup(controller, send)).rejects.toMatchObject({
    code: "recovery_required",
  });
  expect(send).not.toHaveBeenCalled();
  expect(controller.store.getState().suspended).toBe(false);
  expect(Object.values(controller.store.getState().inputs)[0]?.value).toBe(
    "unfinished local value",
  );
});
it("serializes handoff with recovery review through the existing coordinator", async () => {
  const { controller, transport, storage } = await setup();
  const recovery = createRecoveryCoordinator({
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "setup",
    controller,
    transport: transport.transport,
    storage,
  });
  let started = () => {},
    finish = (_response: Response) => {};
  const sent = new Promise<void>((resolve) => {
    started = resolve;
  });
  const reply = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const send = vi.fn<typeof fetch>(() => {
    started();
    return reply;
  });
  const handoff = recovery.handoff(send);
  await sent;
  expect(recovery.store.getState().busy).toBe(true);
  await expect(recovery.start()).rejects.toMatchObject({
    code: "recovery_required",
  });
  finish(
    Response.json({
      kind: "required",
      portfolioId: "portfolio-a",
      revision: 0,
      issues: ["avatar"],
    }),
  );
  await handoff;
  expect(recovery.store.getState().busy).toBe(false);
  expect(controller.store.getState().suspended).toBe(false);
  recovery.dispose();
});
it("keeps a successfully handed-off setup controller paused until unmount", async () => {
  const { controller, transport, storage } = await setup();
  const recovery = createRecoveryCoordinator({
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "setup",
    controller,
    transport: transport.transport,
    storage,
  });
  const send = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      kind: "editor",
      portfolioId: "portfolio-a",
      revision: 1,
      firstEditorEnteredAt: 1,
    }),
  );
  expect((await recovery.handoff(send)).result.kind).toBe("editor");
  expect(controller.store.getState().suspended).toBe(true);
  expect(() =>
    controller.edit(["profile", "name"], "Late setup edit"),
  ).toThrow();
  recovery.dispose();
});
