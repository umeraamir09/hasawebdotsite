import { clearSample } from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";
import { getAt, resolveField } from "../draft/planner";
import type { DraftState, FieldPath } from "../draft/types";

export function readEditorField(state: DraftState, path: FieldPath): string {
  const input = state.inputs[JSON.stringify(path)];
  if (input) return typeof input.value === "string" ? input.value : "";
  if (!state.working) return "";
  const value = getAt(state.working, resolveField(state.working, path));
  return typeof value === "string" ? value : "";
}

export function editEditorField(
  controller: DraftController,
  path: FieldPath,
  value: string,
): boolean {
  if (!controller.edit(path, value)) return false;
  const draft = controller.store.getState().working;
  if (!draft) return true;
  const [root, entry] = path;
  const marker =
    root === "profile" && typeof entry === "string"
      ? `profile.${entry}`
      : root === "components" && typeof entry === "object"
        ? `components.${entry.id}`
        : null;
  if (marker && draft.samples[marker])
    controller.update(clearSample(draft, marker));
  return true;
}
