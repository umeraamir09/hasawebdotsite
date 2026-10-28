import { type ComponentOf, draftSchema } from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";

type Project = ComponentOf<"projects">["data"]["entries"][number];

export function addProject(
  controller: DraftController,
  componentId: string,
): string | null {
  const draft = controller.store.getState().working;
  const component = draft?.components.find((item) => item.id === componentId);
  if (!draft || component?.type !== "projects") return null;
  const entry: Project = {
    id: crypto.randomUUID(),
    title: "",
    summary: "",
    technologies: [],
    contribution: "",
  };
  const next = draftSchema.safeParse({
    ...draft,
    components: draft.components.map((item) =>
      item.id === componentId
        ? {
            ...component,
            data: { entries: [...component.data.entries, entry] },
          }
        : item,
    ),
  });
  if (!next.success) return null;
  delete next.data.samples[`components.${componentId}`];
  controller.update(next.data);
  return entry.id;
}

export function removeProject(
  controller: DraftController,
  componentId: string,
  entryId: string,
) {
  const draft = controller.store.getState().working;
  const component = draft?.components.find((item) => item.id === componentId);
  if (!draft || component?.type !== "projects") return;
  const index = component.data.entries.findIndex(
    (entry) => entry.id === entryId,
  );
  if (index < 0) return;
  const samples = { ...draft.samples };
  delete samples[`components.${componentId}`];
  controller.update({
    ...draft,
    samples,
    components: draft.components.map((item) =>
      item.id === componentId
        ? {
            ...component,
            data: {
              entries: component.data.entries.filter(
                (entry) => entry.id !== entryId,
              ),
            },
          }
        : item,
    ),
  });
  for (const input of Object.values(controller.store.getState().inputs)) {
    const [root, section, data, entries, entry] = input.path;
    if (
      root === "components" &&
      typeof section === "object" &&
      section.id === componentId &&
      data === "data" &&
      entries === "entries" &&
      (typeof entry === "object" ? entry.id === entryId : entry === index)
    )
      controller.clearInput(input.path);
  }
}
