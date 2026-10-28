"use client";

import type { PreviewSelection } from "@hasaweb/components/browser";
import { componentRegistry } from "@hasaweb/schema";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { moveEditorItem } from "../lib/editor/components";
import { OrderedItems } from "./ordered-items";
import { ProfileControls } from "./profile-controls";
import { ProjectControls } from "./project-controls";
import { SocialLinksControl } from "./social-links-control";
import { TextControls } from "./text-controls";

export function EditorFields({
  controller,
  selection,
  disabled,
}: {
  controller: DraftController;
  selection: PreviewSelection;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const draft = state.working;
  if (!draft) return <p>Opening your draft...</p>;
  if (selection.kind === "profile")
    return (
      <>
        <ProfileControls controller={controller} disabled={disabled} />
        <SocialLinksControl controller={controller} disabled={disabled} />
      </>
    );
  const component = draft.components.find((item) => item.id === selection.id);
  if (!component) return null;
  if (component.type === "social-links")
    return <SocialLinksControl controller={controller} disabled={disabled} />;
  if (component.type === "projects")
    return (
      <ProjectControls
        controller={controller}
        componentId={component.id}
        disabled={disabled}
      />
    );
  if (component.type === "text")
    return (
      <TextControls
        controller={controller}
        componentId={component.id}
        disabled={disabled}
      />
    );
  const definition = componentRegistry[component.type];
  return (
    <section aria-label={`${definition.picker.title} controls`}>
      <h2>{definition.picker.title}</h2>
      <p>{definition.picker.description}</p>
      {(component.type === "skills" ||
        component.type === "work-experience") && (
        <OrderedItems
          label="Entry order"
          disabled={disabled}
          items={component.data.entries.map((entry, index) => ({
            id: entry.id,
            label:
              ("name" in entry ? entry.name : entry.role) ||
              `Entry ${index + 1}`,
          }))}
          onMove={(id, target) =>
            moveEditorItem(controller, id, target, {
              componentId: component.id,
              collection: "entries",
            })
          }
        />
      )}
      {component.type === "skills" && (
        <OrderedItems
          label="Category order"
          disabled={disabled}
          items={component.data.categories.map((category, index) => ({
            id: category.id,
            label: category.name || `Category ${index + 1}`,
          }))}
          onMove={(id, target) =>
            moveEditorItem(controller, id, target, {
              componentId: component.id,
              collection: "categories",
            })
          }
        />
      )}
      <p className="editor-muted">
        This section appears in your preview. More{" "}
        {definition.picker.title.toLowerCase()} controls will be available soon.
      </p>
      <ul>
        {definition.picker.requirements.map((requirement) => (
          <li key={requirement}>{requirement}</li>
        ))}
      </ul>
    </section>
  );
}
