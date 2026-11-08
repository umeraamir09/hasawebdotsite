import {
  type ComponentType,
  componentRegistry,
  createComponent,
  type DraftComponent,
  draftSchema,
} from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";

export function addEditorComponent(
  controller: DraftController,
  type: ComponentType,
): string | null {
  const draft = controller.store.getState().working;
  if (
    !draft ||
    (componentRegistry[type].singleton &&
      draft.components.some((item) => item.type === type))
  )
    return null;
  const id = crypto.randomUUID();
  const next = draftSchema.safeParse({
    ...draft,
    components: [...draft.components, createComponent(type, id)],
  });
  if (!next.success) return null;
  controller.update(next.data);
  return id;
}

export function moveById<T extends { id: string }>(
  items: T[],
  id: string,
  targetId: string,
): T[] {
  const from = items.findIndex((item) => item.id === id);
  const to = items.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (!item) return items;
  next.splice(to, 0, item);
  return next;
}

export type ComponentCollection = "entries" | "categories";
export function moveEditorItem(
  controller: DraftController,
  id: string,
  targetId: string,
  within?: { componentId: string; collection: ComponentCollection },
) {
  const draft = controller.store.getState().working;
  if (!draft) return;
  if (!within) {
    controller.update({
      ...draft,
      components: moveById(draft.components, id, targetId),
    });
    return;
  }
  const components = draft.components.map((component) => {
    if (component.id !== within.componentId) return component;
    switch (component.type) {
      case "projects":
        return within.collection === "entries"
          ? {
              ...component,
              data: {
                ...component.data,
                entries: moveById(component.data.entries, id, targetId),
              },
            }
          : component;
      case "work-experience":
        return within.collection === "entries"
          ? {
              ...component,
              data: {
                ...component.data,
                entries: moveById(component.data.entries, id, targetId),
              },
            }
          : component;
      case "skills":
        return {
          ...component,
          data: {
            ...component.data,
            [within.collection]: moveById(
              component.data[within.collection],
              id,
              targetId,
            ),
          },
        };
      default:
        return component;
    }
  });
  const samples = { ...draft.samples };
  delete samples[`components.${within.componentId}`];
  controller.update({ ...draft, components, samples });
}

// A GitHub graph is removed only after its private access was withdrawn on
// the server (Phase 41), even when the draft shows public activity only: an
// authorized grant can exist without being shown.
export function canRemoveEditorComponent(
  component: DraftComponent,
  accessWithdrawn = false,
): boolean {
  return component.type !== "github" || accessWithdrawn;
}

export function removeEditorComponent(
  controller: DraftController,
  id: string,
  options: { accessWithdrawn?: boolean } = {},
): boolean {
  const draft = controller.store.getState().working;
  const component = draft?.components.find((item) => item.id === id);
  if (
    !draft ||
    !component ||
    !canRemoveEditorComponent(component, options.accessWithdrawn)
  )
    return false;
  const removedIndex = draft.components.findIndex((item) => item.id === id);
  const samples = { ...draft.samples };
  delete samples[`components.${id}`];
  controller.update({
    ...draft,
    samples,
    components: draft.components.filter((item) => item.id !== id),
  });
  for (const input of Object.values(controller.store.getState().inputs)) {
    const [root, selector] = input.path;
    if (
      root === "components" &&
      ((typeof selector === "object" && selector.id === id) ||
        selector === removedIndex)
    )
      controller.clearInput(input.path);
  }
  return true;
}
