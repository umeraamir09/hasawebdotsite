import { DRAFT_MAX_BYTES } from "@hasaweb/schema";
import { afterEach, expect, it } from "vitest";
import { createDraftController } from "../draft/controller";
import { fixtureTransport, memoryStorage } from "../draft/test-fixtures";
import { addEditorComponent, moveEditorItem } from "./components";
import { editEditorField } from "./fields";
import {
  addSkill,
  addSkillCategory,
  removeSkill,
  removeSkillCategory,
  setSkillCategory,
} from "./skills";

const controllers: ReturnType<typeof createDraftController>[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});
async function setup() {
  const network = fixtureTransport();
  const controller = createDraftController({
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "content",
    transport: network.transport,
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
  const draft = controller.store.getState().working;
  if (!draft) throw new Error("Missing draft");
  controller.update({ ...draft, components: [], samples: {} });
  const componentId = addEditorComponent(controller, "skills");
  if (!componentId) throw new Error("Missing skills component");
  return { controller, componentId };
}
function skills(controller: ReturnType<typeof createDraftController>) {
  const component = controller.store
    .getState()
    .working?.components.find((item) => item.type === "skills");
  if (component?.type !== "skills") throw new Error("Missing skills");
  return component.data;
}
it("assigns, clears, reorders and removes with stable IDs; category removal keeps skills uncategorized", async () => {
  const { controller, componentId } = await setup();
  const a = addSkill(controller, componentId);
  const b = addSkill(controller, componentId);
  const category = addSkillCategory(controller, componentId);
  if (!a || !b || !category) throw new Error("Missing item");
  const base = ["components", { id: componentId }, "data"];
  expect(
    editEditorField(controller, [...base, "entries", { id: a }, "name"], "Go"),
  ).toBe(true);
  expect(setSkillCategory(controller, componentId, a, category)).toBe(true);
  expect(setSkillCategory(controller, componentId, b, "missing")).toBe(false);
  expect(skills(controller).entries[0]?.categoryId).toBe(category);
  expect(setSkillCategory(controller, componentId, a, null)).toBe(true);
  expect(skills(controller).entries[0]).toEqual({ id: a, name: "Go" });
  setSkillCategory(controller, componentId, a, category);
  moveEditorItem(controller, b, a, { componentId, collection: "entries" });
  expect(skills(controller).entries.map((entry) => entry.id)).toEqual([b, a]);
  removeSkillCategory(controller, componentId, category);
  expect(skills(controller)).toEqual({
    categories: [],
    entries: [
      { id: b, name: "" },
      { id: a, name: "Go" },
    ],
  });
  controller.setInput([...base, "entries", { id: b }, "name"], "x".repeat(1));
  removeSkill(controller, componentId, b);
  expect(skills(controller).entries.map((entry) => entry.id)).toEqual([a]);
  expect(Object.keys(controller.store.getState().inputs)).toEqual([]);
});
it("refuses over-budget insertion without changing owner work", async () => {
  const { controller, componentId } = await setup();
  const draft = structuredClone(controller.store.getState().working);
  if (!draft) throw new Error("Missing draft");
  const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
  draft.profile.bio += "x".repeat(DRAFT_MAX_BYTES - bytes);
  controller.update(draft);
  expect(addSkill(controller, componentId)).toBeNull();
  expect(addSkillCategory(controller, componentId)).toBeNull();
  expect(controller.store.getState().working).toEqual(draft);
});
