import { type ComponentOf, draftSchema } from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";

type Skills = ComponentOf<"skills">;
type SkillsData = Skills["data"];

function current(controller: DraftController, componentId: string) {
  const draft = controller.store.getState().working;
  const component = draft?.components.find((item) => item.id === componentId);
  if (!draft || component?.type !== "skills") return null;
  return { draft, component };
}

// Skills content changes always drop the untouched-sample marker and must pass
// the draft schema, so an over-budget change leaves owner work unchanged.
function commit(
  controller: DraftController,
  componentId: string,
  change: (data: SkillsData) => SkillsData,
): boolean {
  const found = current(controller, componentId);
  if (!found) return false;
  const next = draftSchema.safeParse({
    ...found.draft,
    components: found.draft.components.map((item) =>
      item.id === componentId && item.type === "skills"
        ? { ...item, data: change(item.data) }
        : item,
    ),
  });
  if (!next.success) return false;
  delete next.data.samples[`components.${componentId}`];
  controller.update(next.data);
  return true;
}

function clearRawInputs(
  controller: DraftController,
  componentId: string,
  collection: "entries" | "categories",
  itemId: string,
) {
  for (const input of Object.values(controller.store.getState().inputs)) {
    const [root, section, data, name, item] = input.path;
    if (
      root === "components" &&
      typeof section === "object" &&
      section.id === componentId &&
      data === "data" &&
      name === collection &&
      typeof item === "object" &&
      item.id === itemId
    )
      controller.clearInput(input.path);
  }
}

export function addSkill(
  controller: DraftController,
  componentId: string,
  categoryId?: string,
): string | null {
  const id = crypto.randomUUID();
  const added = commit(controller, componentId, (data) => ({
    ...data,
    entries: [
      ...data.entries,
      { id, name: "", ...(categoryId ? { categoryId } : {}) },
    ],
  }));
  return added ? id : null;
}

export function removeSkill(
  controller: DraftController,
  componentId: string,
  entryId: string,
) {
  const removed = commit(controller, componentId, (data) => ({
    ...data,
    entries: data.entries.filter((entry) => entry.id !== entryId),
  }));
  if (removed) clearRawInputs(controller, componentId, "entries", entryId);
}

export function addSkillCategory(
  controller: DraftController,
  componentId: string,
): string | null {
  const id = crypto.randomUUID();
  const added = commit(controller, componentId, (data) => ({
    ...data,
    categories: [...data.categories, { id, name: "" }],
  }));
  return added ? id : null;
}

/** Removes the category only. Its skills stay and become uncategorized. */
export function removeSkillCategory(
  controller: DraftController,
  componentId: string,
  categoryId: string,
) {
  const removed = commit(controller, componentId, (data) => ({
    categories: data.categories.filter(
      (category) => category.id !== categoryId,
    ),
    entries: data.entries.map((entry) => {
      if (entry.categoryId !== categoryId) return entry;
      const { categoryId: _removed, ...rest } = entry;
      return rest;
    }),
  }));
  if (removed)
    clearRawInputs(controller, componentId, "categories", categoryId);
}

/** Assigns a skill to a category, or clears the assignment when null. */
export function setSkillCategory(
  controller: DraftController,
  componentId: string,
  entryId: string,
  categoryId: string | null,
): boolean {
  return commit(controller, componentId, (data) => ({
    ...data,
    entries: data.entries.map((entry) => {
      if (entry.id !== entryId) return entry;
      const { categoryId: _old, ...rest } = entry;
      return categoryId ? { ...rest, categoryId } : rest;
    }),
  }));
}
