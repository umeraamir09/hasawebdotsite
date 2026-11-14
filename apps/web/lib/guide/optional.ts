import type { ComponentOf, DraftDoc } from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";
import { removeEditorComponent } from "../editor/components";
import { addProject, removeProject } from "../editor/projects";
import { addSkill, removeSkill } from "../editor/skills";
import { addGuideComponent } from "./order";

export type OptionalType = "skills" | "projects";

export function findOptional<T extends OptionalType>(
  draft: DraftDoc | null | undefined,
  type: T,
): ComponentOf<T> | undefined {
  return draft?.components.find((item) => item.type === type) as
    | ComponentOf<T>
    | undefined;
}

type Project = ComponentOf<"projects">["data"]["entries"][number];

// A project is untouched when nothing the owner could have typed or uploaded
// remains. Such entries are not owner content and are never kept.
export function projectUntouched(entry: Project) {
  const {
    id: _id,
    title,
    summary,
    technologies,
    contribution,
    ...rest
  } = entry;
  return (
    !title.trim() &&
    !summary.trim() &&
    !contribution?.trim() &&
    technologies.length === 0 &&
    Object.values(rest).every((value) => value === undefined)
  );
}

export function projectIncomplete(entry: Project) {
  return !entry.title.trim() || !entry.summary.trim();
}

/** The section is created with its first entry, never by visiting a step. */
export function addFirstEntry(
  controller: DraftController,
  type: OptionalType,
): string | null {
  const existing = findOptional(controller.store.getState().working, type);
  const componentId = existing?.id ?? addGuideComponent(controller, type);
  if (!componentId) return null;
  const id =
    type === "skills"
      ? addSkill(controller, componentId)
      : addProject(controller, componentId);
  // A section created for an entry that could not fit is not kept.
  if (!id && !existing) removeEditorComponent(controller, componentId);
  return id;
}

/**
 * Drops entries the owner never filled in, and the section when nothing is
 * left, so skipping or leaving an untouched step creates no component.
 * Partially entered content is always kept.
 */
export function settleOptional(
  controller: DraftController,
  type: OptionalType,
) {
  const component = findOptional(controller.store.getState().working, type);
  if (!component) return;
  if (component.type === "skills") {
    for (const entry of component.data.entries)
      if (!entry.name.trim()) removeSkill(controller, component.id, entry.id);
  } else if (component.type === "projects") {
    for (const entry of component.data.entries)
      if (projectUntouched(entry))
        removeProject(controller, component.id, entry.id);
  }
  const after = findOptional(controller.store.getState().working, type);
  if (!after) return;
  const empty =
    after.type === "skills"
      ? after.data.entries.length === 0 && after.data.categories.length === 0
      : after.data.entries.length === 0;
  if (empty) removeEditorComponent(controller, after.id);
}
