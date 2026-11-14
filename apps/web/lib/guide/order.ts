import type { ComponentType } from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";
import { addEditorComponent } from "../editor/components";

// The guide's optional sections appear in screen order (ON-12): Skills,
// Projects, then GitHub. The editor appends new components; the guide inserts
// a section it creates before any later guide section, so Back to an earlier
// optional screen after adding a graph does not put Skills after it.
const guideOrder: readonly ComponentType[] = ["skills", "projects", "github"];
const rank = (type: ComponentType) => guideOrder.indexOf(type);

export function addGuideComponent(
  controller: DraftController,
  type: "skills" | "projects" | "github",
): string | null {
  const id = addEditorComponent(controller, type);
  if (!id) return null;
  const draft = controller.store.getState().working;
  const added = draft?.components.find((item) => item.id === id);
  if (!draft || !added) return id;
  const others = draft.components.filter((item) => item.id !== id);
  const target = others.findIndex((item) => rank(item.type) > rank(type));
  if (target < 0) return id;
  others.splice(target, 0, added);
  controller.update({ ...draft, components: others });
  return id;
}
