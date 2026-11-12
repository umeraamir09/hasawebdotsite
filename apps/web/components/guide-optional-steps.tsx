"use client";

import { clearSample } from "@hasaweb/schema";
import { useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { moveEditorItem } from "../lib/editor/components";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import { removeProject } from "../lib/editor/projects";
import { removeSkill } from "../lib/editor/skills";
import {
  addFirstEntry,
  findOptional,
  type OptionalType,
} from "../lib/guide/optional";
import { DraftTextField } from "./draft-text-field";
import { ImageUpload } from "./image-upload";
import { OrderedItems } from "./ordered-items";

const full =
  "This draft cannot fit more. Shorten text or remove unused content and try again.";

// Guide adapters for the optional Skills and Projects screens. They reuse the
// editor's entry controls and mutations; categories and case studies stay in
// the editor. The section is created with the first entry, so an untouched
// screen leaves the draft without a component.
export function GuideSkills(props: {
  controller: DraftController;
  disabled: boolean;
}) {
  const { controller, disabled } = props;
  const state = useStore(controller.store);
  const root = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const component = findOptional(state.working, "skills");
  const entries = component?.data.entries ?? [];
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  return (
    <div ref={root} className="guide-entries" data-guide-entries="skills">
      {component && entries.length > 1 && (
        <OrderedItems
          label="Skill order"
          disabled={inactive}
          items={entries.map((entry, index) => ({
            id: entry.id,
            label: entry.name || `Skill ${index + 1}`,
          }))}
          onMove={(id, target) =>
            moveEditorItem(controller, id, target, {
              componentId: component.id,
              collection: "entries",
            })
          }
        />
      )}
      {component &&
        entries.map((entry, index) => (
          <fieldset
            key={entry.id}
            className="guide-entry"
            disabled={inactive}
            data-skill-id={entry.id}
          >
            <legend>Skill {index + 1}</legend>
            <DraftTextField
              controller={controller}
              disabled={inactive}
              label="Skill name"
              path={[
                "components",
                { id: component.id },
                "data",
                "entries",
                { id: entry.id },
                "name",
              ]}
            />
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                removeSkill(controller, component.id, entry.id);
                requestAnimationFrame(() =>
                  root.current
                    ?.querySelector<HTMLButtonElement>("[data-add-entry]")
                    ?.focus(),
                );
              }}
            >
              Remove skill {index + 1}
            </button>
          </fieldset>
        ))}
      <button
        type="button"
        className="ghost-button"
        data-add-entry
        disabled={inactive}
        onClick={() => {
          const id = addFirstEntry(controller, "skills");
          setMessage(id ? "Skill ready to edit." : full);
          if (id)
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLInputElement>(
                  `[data-skill-id="${id}"] input`,
                )
                ?.focus(),
            );
        }}
      >
        Add skill
      </button>
      <p role="status" className="guide-help">
        {message}
      </p>
    </div>
  );
}

export function GuideProjects(props: {
  controller: DraftController;
  disabled: boolean;
}) {
  const { controller, disabled } = props;
  const state = useStore(controller.store);
  const prefix = useId();
  const root = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const component = findOptional(state.working, "projects");
  const entries = component?.data.entries ?? [];
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  return (
    <div ref={root} className="guide-entries" data-guide-entries="projects">
      {component && entries.length > 1 && (
        <OrderedItems
          label="Project order"
          disabled={inactive}
          items={entries.map((entry, index) => ({
            id: entry.id,
            label: entry.title || `Project ${index + 1}`,
          }))}
          onMove={(id, target) =>
            moveEditorItem(controller, id, target, {
              componentId: component.id,
              collection: "entries",
            })
          }
        />
      )}
      {component &&
        entries.map((entry, index) => {
          const path = [
            "components",
            { id: component.id },
            "data",
            "entries",
            { id: entry.id },
          ];
          const technologyPath = [...path, "technologies"];
          const rawTechnologies = state.inputs[JSON.stringify(technologyPath)];
          const technologies =
            typeof rawTechnologies?.value === "string"
              ? rawTechnologies.value
              : entry.technologies.join("\n");
          return (
            <fieldset
              key={entry.id}
              className="guide-entry"
              disabled={inactive}
              data-project-id={entry.id}
            >
              <legend>
                Project {index + 1}
                {entry.title ? ` · ${entry.title}` : ""}
              </legend>
              <DraftTextField
                controller={controller}
                disabled={inactive}
                label="Project title"
                path={[...path, "title"]}
              />
              <DraftTextField
                controller={controller}
                disabled={inactive}
                label="Summary"
                multiline
                path={[...path, "summary"]}
              />
              <DraftTextField
                controller={controller}
                disabled={inactive}
                label="Individual contribution (optional)"
                multiline
                path={[...path, "contribution"]}
              />
              <div className="editor-field">
                <label htmlFor={`${prefix}-${entry.id}-technologies`}>
                  Technologies (optional, one per line)
                </label>
                <textarea
                  id={`${prefix}-${entry.id}-technologies`}
                  rows={3}
                  value={technologies}
                  aria-invalid={Boolean(rawTechnologies)}
                  onChange={(event) => {
                    const value = event.target.value;
                    const accepted = editEditorField(
                      controller,
                      technologyPath,
                      value ? value.split("\n") : [],
                    );
                    if (!accepted) controller.setInput(technologyPath, value);
                  }}
                />
                {rawTechnologies && (
                  <p className="guide-help">
                    Unfinished technologies stay in this browser. Shorten the
                    draft and edit again.
                  </p>
                )}
              </div>
              <DraftTextField
                controller={controller}
                disabled={inactive}
                label="Code URL (optional)"
                path={[...path, "codeUrl"]}
              />
              <DraftTextField
                controller={controller}
                disabled={inactive}
                label="Demo URL (optional)"
                path={[...path, "demoUrl"]}
              />
              <p className="guide-help">
                Use a complete https:// or http:// URL, or leave the link empty.
              </p>
              <ImageUpload
                label="Project"
                purpose="project"
                ownerId={controller.identity.ownerId}
                disabled={inactive}
                value={entry.image}
                description={readEditorField(state, [...path, "image", "alt"])}
                descriptionInvalid={Boolean(
                  state.inputs[JSON.stringify([...path, "image", "alt"])],
                )}
                onPendingChange={(pending) =>
                  controller.store.setState((current) => ({
                    pendingImages: {
                      ...current.pendingImages,
                      [`project:${component.id}:${entry.id}`]: pending,
                    },
                  }))
                }
                onReady={(assetId) => {
                  const current = findOptional(
                    controller.store.getState().working,
                    "projects",
                  );
                  const previous = current?.data.entries.find(
                    (item) => item.id === entry.id,
                  )?.image;
                  if (
                    !controller.edit([...path, "image"], {
                      assetId,
                      alt: previous?.alt ?? "",
                    })
                  )
                    throw new Error(
                      "The image is ready but cannot fit in your draft. Shorten content and retry.",
                    );
                  const draft = controller.store.getState().working;
                  if (draft)
                    controller.update(
                      clearSample(draft, `components.${component.id}`),
                    );
                }}
                onRemove={() => {
                  const draft = controller.store.getState().working;
                  if (!draft) return;
                  controller.update(
                    clearSample(
                      {
                        ...draft,
                        components: draft.components.map((item) =>
                          item.id === component.id && item.type === "projects"
                            ? {
                                ...item,
                                data: {
                                  entries: item.data.entries.map((project) => {
                                    if (project.id !== entry.id) return project;
                                    const { image: _image, ...rest } = project;
                                    return rest;
                                  }),
                                },
                              }
                            : item,
                        ),
                      },
                      `components.${component.id}`,
                    ),
                  );
                  controller.clearInput([...path, "image", "alt"]);
                }}
                onDescription={(value) =>
                  editEditorField(controller, [...path, "image", "alt"], value)
                }
              />
              <button
                type="button"
                className="ghost-button"
                onClick={() => setRemoving(entry.id)}
              >
                Remove project {index + 1}
              </button>
              {removing === entry.id && (
                <fieldset aria-label="Confirm project removal">
                  <p>Remove this project and its entered content?</p>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      removeProject(controller, component.id, entry.id);
                      setRemoving(null);
                      requestAnimationFrame(() =>
                        root.current
                          ?.querySelector<HTMLButtonElement>("[data-add-entry]")
                          ?.focus(),
                      );
                    }}
                  >
                    Confirm remove project
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setRemoving(null)}
                  >
                    Keep project
                  </button>
                </fieldset>
              )}
            </fieldset>
          );
        })}
      <button
        type="button"
        className="ghost-button"
        data-add-entry
        disabled={inactive}
        onClick={() => {
          const id = addFirstEntry(controller, "projects");
          setMessage(id ? "Project ready to edit." : full);
          if (id)
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLInputElement>(
                  `[data-project-id="${id}"] input`,
                )
                ?.focus(),
            );
        }}
      >
        Add project
      </button>
      <p role="status" className="guide-help">
        {message}
      </p>
    </div>
  );
}

export type { OptionalType };
