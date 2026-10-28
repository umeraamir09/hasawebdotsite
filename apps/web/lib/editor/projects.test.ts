import { DRAFT_MAX_BYTES } from "@hasaweb/schema";
import { afterEach, expect, it } from "vitest";
import { createDraftController } from "../draft/controller";
import { fixtureTransport, memoryStorage } from "../draft/test-fixtures";
import { addEditorComponent, moveEditorItem } from "./components";
import { editEditorField } from "./fields";
import { addProject, removeProject } from "./projects";

const controllers: ReturnType<typeof createDraftController>[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});
async function setup() {
  const network = fixtureTransport();
  const storage = memoryStorage();
  const controller = createDraftController({
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "content",
    transport: network.transport,
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
  const draft = controller.store.getState().working;
  if (!draft) throw new Error("Missing draft");
  controller.update({ ...draft, components: [], samples: {} });
  const componentId = addEditorComponent(controller, "projects");
  if (!componentId) throw new Error("Missing projects component");
  return { controller, storage, componentId };
}
it("keeps partial project entries durable and raw edits attached by ID across ordering and removal", async () => {
  const { controller, storage, componentId } = await setup();
  const a = addProject(controller, componentId);
  const b = addProject(controller, componentId);
  if (!a || !b) throw new Error("Missing project");
  const base = ["components", { id: componentId }, "data", "entries"];
  expect(
    editEditorField(
      controller,
      [...base, { id: a }, "title"],
      "Partial owner project",
    ),
  ).toBe(true);
  expect(
    editEditorField(
      controller,
      [...base, { id: a }, "codeUrl"],
      "javascript:alert(1)",
    ),
  ).toBe(false);
  controller.setInput([...base, { id: b }, "demoUrl"], "https://");
  moveEditorItem(controller, a, b, { componentId, collection: "entries" });
  removeProject(controller, componentId, b);
  const record = await controller.quiesce();
  const project = record.working?.components.find(
    (item) => item.type === "projects",
  )?.data.entries[0];
  expect(project).toEqual({
    id: a,
    title: "Partial owner project",
    summary: "",
    technologies: [],
    contribution: "",
  });
  expect(
    Object.values(record.inputs ?? {}).map((input) => input.value),
  ).toEqual(["javascript:alert(1)"]);
  expect((await storage.list("owner-a", "portfolio-a"))[0]?.working).toEqual(
    record.working,
  );
});
it("refuses over-budget project insertion without changing owner work", async () => {
  const { controller, componentId } = await setup();
  const draft = structuredClone(controller.store.getState().working);
  if (!draft) throw new Error("Missing draft");
  const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
  draft.profile.bio += "x".repeat(DRAFT_MAX_BYTES - bytes);
  controller.update(draft);
  expect(addProject(controller, componentId)).toBeNull();
  expect(controller.store.getState().working).toEqual(draft);
});
