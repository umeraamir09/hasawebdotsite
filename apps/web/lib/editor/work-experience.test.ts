import { DRAFT_MAX_BYTES } from "@hasaweb/schema";
import { afterEach, expect, it } from "vitest";
import { createDraftController } from "../draft/controller";
import { fixtureTransport, memoryStorage } from "../draft/test-fixtures";
import { addEditorComponent, moveEditorItem } from "./components";
import { editEditorField } from "./fields";
import {
  addWorkEntry,
  removeWorkEntry,
  setCurrentRole,
} from "./work-experience";

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
  const componentId = addEditorComponent(controller, "work-experience");
  if (!componentId) throw new Error("Missing work component");
  return { controller, storage, componentId };
}
const base = (componentId: string, id: string): (string | { id: string })[] => [
  "components",
  { id: componentId },
  "data",
  "entries",
  { id },
];
function entries(controller: ReturnType<typeof createDraftController>) {
  const component = controller.store
    .getState()
    .working?.components.find((item) => item.type === "work-experience");
  return component?.data.entries ?? [];
}

it("starts empty, keeps partial entries durable and attaches raw input by ID through ordering and removal", async () => {
  const { controller, storage, componentId } = await setup();
  expect(entries(controller)).toEqual([]);
  const a = addWorkEntry(controller, componentId);
  const b = addWorkEntry(controller, componentId);
  if (!a || !b) throw new Error("Missing entry");
  expect(
    editEditorField(controller, [...base(componentId, a), "role"], "Engineer"),
  ).toBe(true);
  expect(
    editEditorField(
      controller,
      [...base(componentId, a), "organizationUrl"],
      "javascript:alert(1)",
    ),
  ).toBe(false);
  expect(
    editEditorField(
      controller,
      [...base(componentId, b), "organizationUrl"],
      "https://",
    ),
  ).toBe(false);
  moveEditorItem(controller, a, b, { componentId, collection: "entries" });
  removeWorkEntry(controller, componentId, b);
  const record = await controller.quiesce();
  expect(
    record.working?.components.find((item) => item.type === "work-experience")
      ?.data.entries,
  ).toEqual([
    {
      id: a,
      role: "Engineer",
      organization: "",
      startDate: "",
      current: false,
      description: "",
    },
  ]);
  expect(
    Object.values(record.inputs ?? {}).map((input) => input.value),
  ).toEqual(["javascript:alert(1)"]);
  expect((await storage.list("owner-a", "portfolio-a"))[0]?.working).toEqual(
    record.working,
  );
});

it("rejects reversed dates on the end date and keeps the raw input", async () => {
  const { controller, componentId } = await setup();
  const id = addWorkEntry(controller, componentId);
  if (!id) throw new Error("Missing entry");
  const path = base(componentId, id);
  expect(editEditorField(controller, [...path, "startDate"], "2024-05")).toBe(
    true,
  );
  expect(editEditorField(controller, [...path, "endDate"], "2024-04")).toBe(
    false,
  );
  expect(entries(controller)[0]?.endDate).toBeUndefined();
  expect(
    controller.store.getState().inputs[JSON.stringify([...path, "endDate"])]
      ?.value,
  ).toBe("2024-04");
  expect(editEditorField(controller, [...path, "endDate"], "2024-05")).toBe(
    true,
  );
});

it("clears the end date and its raw input when the role becomes current", async () => {
  const { controller, componentId } = await setup();
  const id = addWorkEntry(controller, componentId);
  if (!id) throw new Error("Missing entry");
  const path = base(componentId, id);
  editEditorField(controller, [...path, "startDate"], "2024-05");
  editEditorField(controller, [...path, "endDate"], "2024-01");
  expect(setCurrentRole(controller, componentId, id, true)).toBe(true);
  expect(entries(controller)[0]).toMatchObject({ current: true });
  expect(entries(controller)[0]).not.toHaveProperty("endDate");
  expect(controller.store.getState().inputs).toEqual({});
  editEditorField(controller, [...path, "endDate"], "2024-06");
  setCurrentRole(controller, componentId, id, true);
  expect(entries(controller)[0]).not.toHaveProperty("endDate");
  setCurrentRole(controller, componentId, id, false);
  expect(entries(controller)[0]).toMatchObject({ current: false });
});

it("refuses over-budget insertion without changing owner work", async () => {
  const { controller, componentId } = await setup();
  const draft = structuredClone(controller.store.getState().working);
  if (!draft) throw new Error("Missing draft");
  const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
  draft.profile.bio += "x".repeat(DRAFT_MAX_BYTES - bytes);
  controller.update(draft);
  expect(addWorkEntry(controller, componentId)).toBeNull();
  expect(controller.store.getState().working).toEqual(draft);
});
