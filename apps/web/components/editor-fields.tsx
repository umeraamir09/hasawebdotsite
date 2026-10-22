"use client";

import type { PreviewSelection } from "@hasaweb/components/browser";
import { componentRegistry } from "@hasaweb/schema";
import { useId } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import type { FieldPath } from "../lib/draft/types";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import { ProfileImages } from "./profile-images";
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
  const prefix = useId();
  const state = useStore(controller.store);
  const draft = state.working;
  function field(label: string, path: FieldPath, multiline = false) {
    const id = `${prefix}${JSON.stringify(path)}`;
    const raw = Boolean(state.inputs[JSON.stringify(path)]);
    const props = {
      id,
      value: readEditorField(state, path),
      disabled,
      "aria-invalid": raw,
      "aria-describedby": raw ? `${id}-note` : undefined,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => {
        editEditorField(controller, path, event.target.value);
      },
    };
    return (
      <div className="editor-field" key={JSON.stringify(path)}>
        <label htmlFor={id}>{label}</label>
        {multiline ? <textarea {...props} rows={4} /> : <input {...props} />}
        {raw && (
          <span className="editor-input-note" id={`${id}-note`}>
            Unfinished input stays in this browser. The preview keeps the last
            valid value.
          </span>
        )}
      </div>
    );
  }
  if (!draft) return <p>Opening your draft...</p>;
  if (selection.kind === "profile")
    return (
      <section aria-label="Profile controls">
        <h2>Your profile</h2>
        <p className="editor-muted">
          A few essentials, with a live view of every valid edit.
        </p>
        {field("Name", ["profile", "name"])}
        {field("Bio", ["profile", "bio"], true)}
        {field("Location", ["profile", "location"])}
        <ProfileImages controller={controller} disabled={disabled} />
        <SocialLinksControl controller={controller} disabled={disabled} />
        <p className="editor-muted">
          Provider name and photo suggestions will be available with the profile
          tools.
        </p>
      </section>
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
      {component.type === "text" &&
        field("Section title", [
          "components",
          { id: component.id },
          "data",
          "title",
        ])}
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
