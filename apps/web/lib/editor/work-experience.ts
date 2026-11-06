import { type ComponentOf, clearSample, draftSchema } from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";
import type { FieldPath } from "../draft/types";

type WorkEntry = ComponentOf<"work-experience">["data"]["entries"][number];

function entryPath(componentId: string, entryId: string): FieldPath {
  return [
    "components",
    { id: componentId },
    "data",
    "entries",
    { id: entryId },
  ];
}

/** Adds an empty entry. Returns its stable ID, or null when it cannot fit. */
export function addWorkEntry(
  controller: DraftController,
  componentId: string,
): string | null {
  const draft = controller.store.getState().working;
  const component = draft?.components.find((item) => item.id === componentId);
  if (!draft || component?.type !== "work-experience") return null;
  const entry: WorkEntry = {
    id: crypto.randomUUID(),
    role: "",
    organization: "",
    startDate: "",
    current: false,
    description: "",
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
  controller.update(clearSample(next.data, `components.${componentId}`));
  return entry.id;
}

/** Removes one entry and only that entry's raw local inputs. */
export function removeWorkEntry(
  controller: DraftController,
  componentId: string,
  entryId: string,
) {
  const draft = controller.store.getState().working;
  const component = draft?.components.find((item) => item.id === componentId);
  if (!draft || component?.type !== "work-experience") return;
  if (!component.data.entries.some((entry) => entry.id === entryId)) return;
  const index = component.data.entries.findIndex(
    (entry) => entry.id === entryId,
  );
  controller.update(
    clearSample(
      {
        ...draft,
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
      },
      `components.${componentId}`,
    ),
  );
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

/**
 * Sets or clears the current-role flag. An ongoing role has no end date, so
 * enabling it removes the stored end date and any unfinished end-date input.
 * A start date held back only because it followed the old end date is retried.
 */
export function setCurrentRole(
  controller: DraftController,
  componentId: string,
  entryId: string,
  current: boolean,
): boolean {
  const draft = controller.store.getState().working;
  const component = draft?.components.find((item) => item.id === componentId);
  if (!draft || component?.type !== "work-experience") return false;
  const next = draftSchema.safeParse({
    ...draft,
    components: draft.components.map((item) =>
      item.id === componentId && item.type === "work-experience"
        ? {
            ...item,
            data: {
              entries: item.data.entries.map((entry) => {
                if (entry.id !== entryId) return entry;
                const { endDate: _endDate, ...rest } = entry;
                return current ? { ...rest, current } : { ...entry, current };
              }),
            },
          }
        : item,
    ),
  });
  if (!next.success) return false;
  controller.update(clearSample(next.data, `components.${componentId}`));
  if (current) {
    const base = entryPath(componentId, entryId);
    controller.clearInput([...base, "endDate"]);
    const start =
      controller.store.getState().inputs[
        JSON.stringify([...base, "startDate"])
      ];
    if (typeof start?.value === "string")
      controller.edit([...base, "startDate"], start.value);
  }
  return true;
}
