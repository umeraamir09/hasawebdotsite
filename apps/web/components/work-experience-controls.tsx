"use client";

import { useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import type { FieldPath } from "../lib/draft/types";
import { moveEditorItem } from "../lib/editor/components";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import {
  addWorkEntry,
  removeWorkEntry,
  setCurrentRole,
} from "../lib/editor/work-experience";
import { DraftTextField } from "./draft-text-field";
import { OrderedItems } from "./ordered-items";

const REVERSED = "End date must not precede start date.";

function MonthField({
  controller,
  disabled,
  label,
  path,
  error,
}: {
  controller: DraftController;
  disabled: boolean;
  label: string;
  path: FieldPath;
  error?: string | undefined;
}) {
  const id = useId();
  const state = useStore(controller.store);
  const raw = Boolean(state.inputs[JSON.stringify(path)]);
  const note = error ?? (raw ? "Enter a month as YYYY-MM." : undefined);
  return (
    <div className="editor-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="month"
        placeholder="YYYY-MM"
        value={readEditorField(state, path)}
        disabled={disabled}
        aria-invalid={raw || Boolean(error)}
        aria-describedby={note ? `${id}-note` : undefined}
        onChange={(event) =>
          editEditorField(controller, path, event.target.value)
        }
      />
      {note && (
        <span className="editor-input-note" id={`${id}-note`}>
          {note}
        </span>
      )}
    </div>
  );
}

export function WorkExperienceControls({
  controller,
  componentId,
  disabled,
}: {
  controller: DraftController;
  componentId: string;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const section = useRef<HTMLElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const component = state.working?.components.find(
    (item) => item.id === componentId,
  );
  if (component?.type !== "work-experience") return null;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  return (
    <section
      ref={section}
      aria-label="Work experience controls"
      className="work-controls"
    >
      <h2>Work experience</h2>
      <p className="editor-muted">
        Add roles in the order you want them shown. Each role needs a title,
        organization, start date and description before Publish. Edits stay
        private until Publish.
      </p>
      <OrderedItems
        label="Entry order"
        disabled={inactive}
        items={component.data.entries.map((entry, index) => ({
          id: entry.id,
          label: entry.role || `Role ${index + 1}`,
        }))}
        onMove={(id, target) =>
          moveEditorItem(controller, id, target, {
            componentId,
            collection: "entries",
          })
        }
      />
      {component.data.entries.map((entry, index) => {
        const path: FieldPath = [
          "components",
          { id: componentId },
          "data",
          "entries",
          { id: entry.id },
        ];
        const blank = (key: string) =>
          !readEditorField(state, [...path, key]).trim();
        const start = readEditorField(state, [...path, "startDate"]);
        const end = readEditorField(state, [...path, "endDate"]);
        const reversed = Boolean(start && end && end < start);
        return (
          <fieldset
            key={entry.id}
            disabled={inactive}
            className="work-entry"
            data-work-id={entry.id}
          >
            <legend>
              Role {index + 1}
              {entry.role ? ` · ${entry.role}` : ""}
            </legend>
            <DraftTextField
              controller={controller}
              disabled={inactive}
              label="Role"
              path={[...path, "role"]}
              error={blank("role") ? "Add a role before Publish." : undefined}
            />
            <DraftTextField
              controller={controller}
              disabled={inactive}
              label="Organization"
              path={[...path, "organization"]}
              error={
                blank("organization")
                  ? "Add an organization before Publish."
                  : undefined
              }
            />
            <DraftTextField
              controller={controller}
              disabled={inactive}
              label="Organization link (optional)"
              path={[...path, "organizationUrl"]}
            />
            <p className="editor-muted">
              Use a complete https:// or http:// URL, or leave the link empty.
            </p>
            <MonthField
              controller={controller}
              disabled={inactive}
              label="Start date"
              path={[...path, "startDate"]}
              error={!start ? "Add a start date before Publish." : undefined}
            />
            <div className="editor-field">
              <label>
                <input
                  type="checkbox"
                  checked={entry.current}
                  disabled={inactive}
                  onChange={(event) =>
                    setCurrentRole(
                      controller,
                      componentId,
                      entry.id,
                      event.target.checked,
                    )
                  }
                />{" "}
                I currently work here
              </label>
            </div>
            {!entry.current && (
              <MonthField
                controller={controller}
                disabled={inactive}
                label="End date"
                path={[...path, "endDate"]}
                error={
                  reversed
                    ? REVERSED
                    : !end
                      ? "Add an end date or mark this as your current role."
                      : undefined
                }
              />
            )}
            <DraftTextField
              controller={controller}
              disabled={inactive}
              label="Description"
              multiline
              path={[...path, "description"]}
              error={
                blank("description")
                  ? "Add a description before Publish."
                  : undefined
              }
            />
            <button type="button" onClick={() => setRemoving(entry.id)}>
              Remove role
            </button>
            {removing === entry.id && (
              <fieldset aria-label="Confirm role removal">
                <p>
                  Remove this role and its entered content? Your public site
                  changes after Publish.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    removeWorkEntry(controller, componentId, entry.id);
                    setRemoving(null);
                    section.current
                      ?.querySelector<HTMLButtonElement>("[data-add-work]")
                      ?.focus();
                  }}
                >
                  Confirm remove role
                </button>
                <button type="button" onClick={() => setRemoving(null)}>
                  Keep role
                </button>
              </fieldset>
            )}
          </fieldset>
        );
      })}
      <button
        type="button"
        data-add-work
        disabled={inactive}
        onClick={() => {
          const id = addWorkEntry(controller, componentId);
          setMessage(
            id
              ? "Role ready to edit."
              : "This draft cannot fit another role. Shorten text or remove unused content and try again.",
          );
          if (id)
            requestAnimationFrame(() =>
              section.current
                ?.querySelector<HTMLInputElement>(
                  `[data-work-id="${id}"] input`,
                )
                ?.focus(),
            );
        }}
      >
        Add role
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
