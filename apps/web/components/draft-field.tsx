"use client";

import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import type { FieldPath } from "../lib/draft/types";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import { Area, Field, type IconName } from "./workbench";

const UNFINISHED =
  "Unfinished input stays in this browser. The preview keeps the last valid value.";

// A Workbench Field or Area bound to one draft text value. Input the draft
// cannot take yet stays in this browser and is marked on the field.
export function DraftField({
  controller,
  disabled,
  label,
  path,
  multiline = false,
  lead,
  publicationField,
}: {
  controller: DraftController;
  disabled: boolean;
  label: string;
  path: FieldPath;
  multiline?: boolean;
  lead?: IconName | undefined;
  // The key the publication checklist focuses this field by.
  publicationField?: string | undefined;
}) {
  const state = useStore(controller.store);
  const unfinished = state.inputs[JSON.stringify(path)]
    ? UNFINISHED
    : undefined;
  const common = {
    label,
    disabled,
    value: readEditorField(state, path),
    error: unfinished,
  };
  return (
    <div data-publication-field={publicationField}>
      {multiline ? (
        <Area
          {...common}
          rows={4}
          onChange={(event) =>
            editEditorField(controller, path, event.target.value)
          }
        />
      ) : (
        <Field
          {...common}
          lead={lead}
          onChange={(event) =>
            editEditorField(controller, path, event.target.value)
          }
        />
      )}
    </div>
  );
}
