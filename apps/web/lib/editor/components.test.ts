import { createComponent, DRAFT_MAX_BYTES } from "@hasaweb/schema";
import { afterEach, expect, it } from "vitest";
import { createDraftController } from "../draft/controller";
import { fixtureTransport, memoryStorage } from "../draft/test-fixtures";
import {
  addEditorComponent,
  moveEditorItem,
  removeEditorComponent,
} from "./components";

const controllers: ReturnType<typeof createDraftController>[] = [];
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
  if (!draft) throw new Error("Missing fixture draft");
  controller.update({ ...draft, components: [], samples: {} });
  return { controller, storage };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});
it("rejects singleton duplicates while keeping multiple blank text sections and byte-limit failures recoverable", async () => {
  const { controller } = await setup();
  expect(addEditorComponent(controller, "skills")).toBeTypeOf("string");
  expect(addEditorComponent(controller, "skills")).toBeNull();
  expect(addEditorComponent(controller, "text")).toBeTypeOf("string");
  expect(addEditorComponent(controller, "text")).toBeTypeOf("string");
  const draft = structuredClone(controller.store.getState().working);
  if (!draft) throw new Error("Missing draft");
  const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
  draft.profile.bio += "x".repeat(DRAFT_MAX_BYTES - bytes);
  controller.update(draft);
  expect(addEditorComponent(controller, "text")).toBeNull();
  expect(controller.store.getState().working).toEqual(draft);
});
it("removes sample markers and component-local raw fields while preserving shared links and unrelated raw inputs", async () => {
  const { controller, storage } = await setup();
  const draft = controller.store.getState().working;
  if (!draft) throw new Error("Missing draft");
  controller.update({
    ...draft,
    components: [createComponent("text", "story")],
    samples: { "components.story": true },
  });
  controller.setInput(
    ["components", { id: "story" }, "data", "title"],
    "unfinished",
  );
  controller.setInput(["profile", "name"], "unsaved name");
  controller.setInput(["components", 0, "data", "title"], "indexed correction");
  expect(removeEditorComponent(controller, "story")).toBe(true);
  expect(controller.store.getState().inputs).toHaveProperty(
    '["profile","name"]',
  );
  expect(Object.keys(controller.store.getState().inputs)).toHaveLength(1);
  expect(controller.store.getState().working?.samples).toEqual({});
  expect(controller.store.getState().working?.links).toEqual(draft.links);
  await controller.quiesce();
  const records = await storage.list("owner-a", "portfolio-a");
  expect(records[0]?.working?.components).toEqual([]);
});
it("keeps identities and raw edits attached during reorder and refuses private GitHub removal", async () => {
  const { controller } = await setup();
  const draft = controller.store.getState().working;
  if (!draft) throw new Error("Missing draft");
  const graph = createComponent("github", "graph");
  graph.data.includePrivate = true;
  const projects = createComponent("projects", "projects");
  projects.data.entries = [
    { id: "a", title: "A", summary: "", technologies: [], contribution: "" },
    { id: "b", title: "B", summary: "", technologies: [], contribution: "" },
  ];
  controller.update({
    ...draft,
    components: [projects, graph],
    samples: { "components.projects": true },
  });
  controller.setInput(
    ["components", { id: "projects" }, "data", "entries", { id: "a" }, "title"],
    "raw",
  );
  moveEditorItem(controller, "a", "b", {
    componentId: "projects",
    collection: "entries",
  });
  moveEditorItem(controller, "graph", "projects");
  expect(
    controller.store.getState().working?.components.map((item) => item.id),
  ).toEqual(["graph", "projects"]);
  expect(
    Object.values(controller.store.getState().inputs)[0]?.path,
  ).toContainEqual({ id: "a" });
  expect(controller.store.getState().working?.samples).toEqual({});
  const reordered = controller.store
    .getState()
    .working?.components.find((item) => item.type === "projects");
  expect(reordered?.data.entries.map((item) => item.id)).toEqual(["b", "a"]);
  expect(removeEditorComponent(controller, "graph")).toBe(false);
  expect(controller.store.getState().working?.components).toHaveLength(2);
  moveEditorItem(controller, "missing", "projects");
  expect(controller.store.getState().working?.components).toHaveLength(2);
});
