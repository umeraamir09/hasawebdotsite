import type { PreviewSelection } from "@hasaweb/components/browser";
import {
  type ComponentType,
  componentRegistry,
  type DraftComponent,
  type DraftDoc,
} from "@hasaweb/schema";
import type { IconName } from "../../components/workbench/icon-shapes";

// One icon per section type, shared by the page outline, the Add section
// gallery and the canvas tags inside the preview.
export const sectionIcons = {
  profile: "user",
  projects: "grid",
  skills: "code",
  "work-experience": "briefcase",
  text: "type",
  github: "github",
  contact: "mail",
  "social-links": "link",
  resume: "file",
} as const satisfies Record<ComponentType | "profile", IconName>;

export function sectionTitle(type: ComponentType | "profile"): string {
  return type === "profile" ? "Profile" : componentRegistry[type].picker.title;
}

// Text sections are named by their own title so several can be told apart.
export function sectionLabel(component: DraftComponent): string {
  return component.type === "text" && component.data.title
    ? component.data.title
    : sectionTitle(component.type);
}

// The short detail at the end of an outline row.
export function sectionMeta(component: DraftComponent): string | undefined {
  switch (component.type) {
    case "projects":
    case "work-experience":
    case "skills":
      return String(component.data.entries.length);
    case "github":
      return component.data.username ? `@${component.data.username}` : "";
    default:
      return undefined;
  }
}

// A selection that still names something in the draft. A removed section
// falls back to the profile.
export function activeSelection(
  draft: DraftDoc | null | undefined,
  selection: PreviewSelection,
): PreviewSelection {
  return selection.kind === "component" &&
    !draft?.components.some((component) => component.id === selection.id)
    ? { kind: "profile" }
    : selection;
}

// The section a move swaps with, or undefined at either end.
export function moveTarget(
  ids: readonly string[],
  id: string,
  direction: "up" | "down",
): string | undefined {
  const index = ids.indexOf(id);
  if (index < 0) return undefined;
  return ids[direction === "up" ? index - 1 : index + 1];
}

// What a key does on an outline row: Alt with an arrow moves the section,
// an arrow alone moves the selection through the profile and the sections,
// and Delete asks to remove the section.
export type OutlineKey =
  | { kind: "select"; selection: PreviewSelection }
  | { kind: "move"; id: string; targetId: string }
  | { kind: "remove"; id: string }
  | null;
const profile: PreviewSelection = { kind: "profile" };
export function outlineKey(
  ids: readonly string[],
  current: PreviewSelection,
  key: { key: string; altKey: boolean },
): OutlineKey {
  const id = current.kind === "component" ? current.id : null;
  const up = key.key === "ArrowUp";
  if (!up && key.key !== "ArrowDown") {
    if ((key.key === "Delete" || key.key === "Backspace") && id && !key.altKey)
      return { kind: "remove", id };
    if (key.key === "Home") return { kind: "select", selection: profile };
    if (key.key === "End" && ids.length)
      return {
        kind: "select",
        selection: { kind: "component", id: ids[ids.length - 1] as string },
      };
    return null;
  }
  if (key.altKey) {
    if (!id) return null;
    const targetId = moveTarget(ids, id, up ? "up" : "down");
    return targetId ? { kind: "move", id, targetId } : null;
  }
  const order = [null, ...ids];
  const next = order[order.indexOf(id) + (up ? -1 : 1)];
  if (next === undefined) return null;
  return {
    kind: "select",
    selection: next === null ? profile : { kind: "component", id: next },
  };
}
