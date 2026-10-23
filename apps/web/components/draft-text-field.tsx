"use client";

import { useId } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import type { FieldPath } from "../lib/draft/types";
import { editEditorField, readEditorField } from "../lib/editor/fields";

export function DraftTextField({
  controller,
  disabled,
  label,
  path,
  multiline = false,
}: {
  controller: DraftController;
  disabled: boolean;
  label: string;
  path: FieldPath;
  multiline?: boolean;
}) {
  const id = useId();
  const state = useStore(controller.store);
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
    <div className="editor-field">
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
