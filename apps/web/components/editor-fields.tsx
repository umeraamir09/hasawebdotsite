"use client";

import type { PreviewSelection } from "@hasaweb/components/browser";
import { componentRegistry } from "@hasaweb/schema";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { DraftTextField } from "./draft-text-field";
import { ProfileControls } from "./profile-controls";
import { SocialLinksControl } from "./social-links-control";

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
  const definition = componentRegistry[component.type];
  return (
    <section aria-label={`${definition.picker.title} controls`}>
      <h2>{definition.picker.title}</h2>
      <p>{definition.picker.description}</p>
      {component.type === "text" && (
        <DraftTextField
          controller={controller}
          disabled={disabled}
          label="Section title"
          path={["components", { id: component.id }, "data", "title"]}
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
