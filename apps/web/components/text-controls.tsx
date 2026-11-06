"use client";

import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { DraftTextField } from "./draft-text-field";
import { RichTextEditor } from "./rich-text-editor";

export function TextControls(props: {
  controller: DraftController;
  componentId: string;
  disabled: boolean;
}) {
  return (
    <Controls
      key={`${props.controller.scopeKey}:${props.componentId}`}
      {...props}
    />
  );
}

function Controls({
  controller,
  componentId,
  disabled,
}: {
  controller: DraftController;
  componentId: string;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const component = state.working?.components.find(
    (item) => item.id === componentId,
  );
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  if (component?.type !== "text") return null;
  return (
    <section aria-label="Text section controls">
      <h2>Text section</h2>
      <DraftTextField
        controller={controller}
        disabled={inactive}
        label="Section title"
        path={["components", { id: componentId }, "data", "title"]}
      />
      <p className="editor-muted">
        Use headings, paragraphs, lists and links. Edits stay private until
        Publish.
      </p>
      <RichTextEditor
        controller={controller}
        path={["components", { id: componentId }, "data", "body"]}
        sampleKey={`components.${componentId}`}
        label="Section body"
        inactive={inactive}
      />
    </section>
  );
}
