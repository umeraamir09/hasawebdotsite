import { afterEach, expect, it } from "vitest";
import { createDraftController } from "../draft/controller";
import { fixtureTransport, memoryStorage } from "../draft/test-fixtures";
import { acceptGraph } from "./github";
import { addFirstEntry } from "./optional";

const controllers: ReturnType<typeof createDraftController>[] = [];
async function setup() {
  const network = fixtureTransport();
  const controller = createDraftController({
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "setup",
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
  if (!draft) throw new Error("Missing fixture draft");
  controller.update({ ...draft, components: [], samples: {} });
  return controller;
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});
const types = (controller: Awaited<ReturnType<typeof setup>>) =>
  controller.store.getState().working?.components.map((item) => item.type);

it("keeps guide sections in Skills, Projects, GitHub order whatever the visit order", async () => {
  const controller = await setup();
  expect(acceptGraph(controller, "octo")).toBe(true);
  addFirstEntry(controller, "projects");
  expect(types(controller)).toEqual(["projects", "github"]);
  addFirstEntry(controller, "skills");
  expect(types(controller)).toEqual(["skills", "projects", "github"]);
  // Adding another entry to an existing section moves nothing.
  addFirstEntry(controller, "projects");
  expect(types(controller)).toEqual(["skills", "projects", "github"]);
});

it("appends in screen order when sections are created in order", async () => {
  const controller = await setup();
  addFirstEntry(controller, "skills");
  addFirstEntry(controller, "projects");
  expect(acceptGraph(controller, "octo")).toBe(true);
  expect(types(controller)).toEqual(["skills", "projects", "github"]);
});
