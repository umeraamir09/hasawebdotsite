"use client";

import { clearSample } from "@hasaweb/schema";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import {
  readCaseStudyAddresses,
  reconcileCaseStudies,
  syncCaseStudySlug,
} from "../lib/editor/case-studies";
import { moveEditorItem } from "../lib/editor/components";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import { addProject, removeProject } from "../lib/editor/projects";
import {
  type CaseStudyAddressState,
  CaseStudyControls,
} from "./case-study-controls";
import { DraftTextField } from "./draft-text-field";
import { ImageUpload } from "./image-upload";
import { OrderedItems } from "./ordered-items";

export function ProjectControls(props: {
  controller: DraftController;
  componentId: string;
  disabled: boolean;
  publicationKey?: string | undefined;
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
  publicationKey = "",
}: {
  controller: DraftController;
  componentId: string;
  disabled: boolean;
  publicationKey?: string | undefined;
}) {
  const state = useStore(controller.store);
  const [addresses, setAddresses] = useState<CaseStudyAddressState>({
    status: "loading",
  });
  const loadAddresses = useCallback(() => {
    let current = true;
    setAddresses({ status: "loading" });
    readCaseStudyAddresses(controller)
      .then((list) => {
        if (!current) return;
        setAddresses({ status: "ready", addresses: list });
        // Restore frozen slugs and move unfrozen ones off still-live URLs.
        // Unfrozen slugs otherwise change only when their title changes.
        try {
          reconcileCaseStudies(controller, componentId, list);
        } catch {
          // A paused or suspended draft is repaired on the next load.
        }
      })
      .catch(() => {
        if (current) setAddresses({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [controller, componentId]);
  // The live slug set changes only on a successful Publish.
  // biome-ignore lint/correctness/useExhaustiveDependencies: publicationKey is the reload signal.
  useEffect(() => loadAddresses(), [loadAddresses, publicationKey]);
  const prefix = useId();
  const section = useRef<HTMLElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const component = state.working?.components.find(
    (item) => item.id === componentId,
  );
  if (component?.type !== "projects") return null;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  return (
    <section
      ref={section}
      aria-label="Projects controls"
      className="project-controls"
    >
      <h2>Projects</h2>
      <p className="editor-muted">
        Add your own work. Each project needs a title and summary before
        Publish. Optional fields appear only when supplied. Edits stay private
        until Publish.
      </p>
      <OrderedItems
        label="Entry order"
        disabled={inactive}
        items={component.data.entries.map((entry, index) => ({
          id: entry.id,
          label: entry.title || `Project ${index + 1}`,
        }))}
        onMove={(id, target) =>
          moveEditorItem(controller, id, target, {
            componentId,
            collection: "entries",
          })
        }
      />
      {component.data.entries.map((entry, index) => {
        const path = [
          "components",
          { id: componentId },
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
            disabled={inactive}
            className="project-entry"
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
              onEdited={() => {
                if (addresses.status === "ready")
                  syncCaseStudySlug(
                    controller,
                    componentId,
                    entry.id,
                    addresses.addresses,
                  );
              }}
              error={
                !readEditorField(state, [...path, "title"]).trim()
                  ? "Add a project title before Publish."
                  : undefined
              }
            />
            <DraftTextField
              controller={controller}
              disabled={inactive}
              label="Summary"
              multiline
              path={[...path, "summary"]}
              error={
                !readEditorField(state, [...path, "summary"]).trim()
                  ? "Add a project summary before Publish."
                  : undefined
              }
            />
            <DraftTextField
              controller={controller}
              disabled={inactive}
              label="Individual contribution (optional)"
              multiline
              path={[...path, "contribution"]}
            />
            <p className="editor-muted">Explain what you personally built.</p>
            <div className="editor-field">
              <label htmlFor={`${prefix}-${entry.id}-technologies`}>
                Technologies (optional, one per line)
              </label>
              <textarea
                id={`${prefix}-${entry.id}-technologies`}
                rows={3}
                value={technologies}
                aria-invalid={Boolean(rawTechnologies)}
                aria-describedby={
                  rawTechnologies
                    ? `${prefix}-${entry.id}-technology-note`
                    : undefined
                }
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
                <p id={`${prefix}-${entry.id}-technology-note`}>
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
            <p className="editor-muted">
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
                    [`project:${componentId}:${entry.id}`]: pending,
                  },
                }))
              }
              onReady={(assetId) => {
                const current = controller.store
                  .getState()
                  .working?.components.find((item) => item.id === componentId);
                const previous =
                  current?.type === "projects"
                    ? current.data.entries.find((item) => item.id === entry.id)
                        ?.image
                    : undefined;
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
                    clearSample(draft, `components.${componentId}`),
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
                        item.id === componentId && item.type === "projects"
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
                    `components.${componentId}`,
                  ),
                );
                controller.clearInput([...path, "image", "alt"]);
              }}
              onDescription={(value) =>
                editEditorField(controller, [...path, "image", "alt"], value)
              }
            />
            <CaseStudyControls
              controller={controller}
              componentId={componentId}
              entry={entry}
              inactive={inactive}
              addresses={addresses}
              onRetry={loadAddresses}
            />
            <button type="button" onClick={() => setRemoving(entry.id)}>
              Remove project
            </button>
            {removing === entry.id && (
              <fieldset aria-label="Confirm project removal">
                <p>
                  Remove this project and its entered content? Your public site
                  changes after Publish.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    removeProject(controller, componentId, entry.id);
                    setRemoving(null);
                    section.current
                      ?.querySelector<HTMLButtonElement>("[data-add-project]")
                      ?.focus();
                  }}
                >
                  Confirm remove project
                </button>
                <button type="button" onClick={() => setRemoving(null)}>
                  Keep project
                </button>
              </fieldset>
            )}
          </fieldset>
        );
      })}
      <button
        type="button"
        data-add-project
        disabled={inactive}
        onClick={() => {
          const id = addProject(controller, componentId);
          setMessage(
            id
              ? "Project ready to edit."
              : "This draft cannot fit another project. Shorten text or remove unused content and try again.",
          );
          if (id)
            requestAnimationFrame(() =>
              section.current
                ?.querySelector<HTMLInputElement>(
                  `[data-project-id="${id}"] input`,
                )
                ?.focus(),
            );
        }}
      >
        Add project
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
