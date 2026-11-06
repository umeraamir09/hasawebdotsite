"use client";

import { componentRegistry } from "@hasaweb/schema";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { moveEditorItem } from "../lib/editor/components";
import { OrderedItems } from "./ordered-items";

export function WorkExperienceControls({
  controller,
  componentId,
  disabled,
}: {
  controller: DraftController;
  componentId: string;
  disabled: boolean;
}) {
  const draft = useStore(controller.store).working;
  const component = draft?.components.find((item) => item.id === componentId);
  if (component?.type !== "work-experience") return null;
  const definition = componentRegistry["work-experience"];
  return (
    <section aria-label={`${definition.picker.title} controls`}>
      <h2>{definition.picker.title}</h2>
      <p>{definition.picker.description}</p>
      <OrderedItems
        label="Entry order"
        disabled={disabled}
        items={component.data.entries.map((entry, index) => ({
          id: entry.id,
          label: entry.role || `Entry ${index + 1}`,
        }))}
        onMove={(id, target) =>
          moveEditorItem(controller, id, target, {
            componentId: component.id,
            collection: "entries",
          })
        }
      />
      <ul>
        {definition.picker.requirements.map((requirement) => (
          <li key={requirement}>{requirement}</li>
        ))}
      </ul>
    </section>
  );
}
