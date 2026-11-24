// biome-ignore-all lint/performance/noImgElement: Private owner images come from the authorized asset route; Cloudflare image optimization is disabled.
"use client";

import { type ComponentOf, clearSample } from "@hasaweb/schema";
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { useStore } from "zustand";
import { privateImageUrl } from "../lib/assets/browser";
import type { DraftController } from "../lib/draft/controller";
import type { DraftState } from "../lib/draft/types";
import { moveEditorItem } from "../lib/editor/components";
import { editEditorField, readEditorField } from "../lib/editor/fields";
import { removeProject } from "../lib/editor/projects";
import { removeSkill } from "../lib/editor/skills";
import {
  addFirstEntry,
  addNamedSkill,
  findOptional,
  type OptionalType,
} from "../lib/guide/optional";
import { matchSkills } from "../lib/guide/skill-suggestions";
import { DraftField } from "./draft-field";
import { ImageSlot } from "./image-slot";
import { Area, Button, Icon, IconButton, Popover } from "./workbench";
import "./profile-editor.css";

const full =
  "This draft cannot fit more. Shorten text or remove unused content and try again.";

// The Skills step (Figma 471:11674): a token input. Typing offers matching
// names; Enter adds the highlighted name, or what was typed. Each skill is a
// token that moves with Alt and an arrow key and has its own remove button.
// The section is created with the first skill, so an untouched step leaves
// the draft without one.
export function GuideSkills({
  controller,
  disabled,
}: {
  controller: DraftController;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const tokens = useRef<HTMLOListElement>(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  const [message, setMessage] = useState("");
  const component = findOptional(state.working, "skills");
  const entries = component?.data.entries ?? [];
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const options = closed
    ? []
    : matchSkills(
        text,
        entries.map((entry) => entry.name),
      );
  const highlighted = options[Math.min(active, options.length - 1)];

  function add(name: string) {
    const added = addNamedSkill(controller, name);
    setMessage(added ? `${name.trim()} added.` : full);
    if (!added) return;
    setText("");
    setActive(0);
    setClosed(false);
  }
  function focusToken(entryId: string) {
    requestAnimationFrame(() =>
      tokens.current
        ?.querySelector<HTMLElement>(
          `[data-skill-id="${CSS.escape(entryId)}"] .guide-token-name`,
        )
        ?.focus(),
    );
  }
  function keys(entryId: string) {
    return (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!event.altKey || !component) return;
      const offset = ["ArrowLeft", "ArrowUp"].includes(event.key)
        ? -1
        : ["ArrowRight", "ArrowDown"].includes(event.key)
          ? 1
          : 0;
      const index = entries.findIndex((entry) => entry.id === entryId);
      const target = entries[index + offset];
      if (!offset || !target) return;
      event.preventDefault();
      moveEditorItem(controller, entryId, target.id, {
        componentId: component.id,
        collection: "entries",
      });
      setMessage(
        `Moved to position ${index + offset + 1} of ${entries.length}.`,
      );
      focusToken(entryId);
    };
  }
  return (
    <div className="guide-skills" data-guide-entries="skills">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a click on the box's empty space focuses its input, which keyboard users reach directly. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: as above. */}
      <div
        className="guide-token-box"
        onClick={(event) => {
          if (event.target === event.currentTarget) input.current?.focus();
        }}
      >
        {entries.length > 0 && component && (
          <ol className="guide-tokens" ref={tokens} aria-label="Your skills">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="guide-token"
                data-skill-id={entry.id}
              >
                <button
                  type="button"
                  className="guide-token-name"
                  disabled={inactive}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  onKeyDown={keys(entry.id)}
                >
                  {entry.name || "Unnamed skill"}
                </button>
                <button
                  type="button"
                  className="guide-token-remove"
                  aria-label={`Remove ${entry.name || "skill"}`}
                  disabled={inactive}
                  onClick={() => {
                    removeSkill(controller, component.id, entry.id);
                    setMessage(`${entry.name || "Skill"} removed.`);
                    input.current?.focus();
                  }}
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}
        <label htmlFor={id} className="wb-visually-hidden">
          Add a skill
        </label>
        <input
          ref={input}
          id={id}
          className="guide-token-input"
          value={text}
          placeholder={entries.length === 0 ? "Type a skill" : undefined}
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={`${id}-options`}
          aria-autocomplete="list"
          aria-activedescendant={
            highlighted
              ? `${id}-option-${options.indexOf(highlighted)}`
              : undefined
          }
          autoComplete="off"
          disabled={inactive}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setClosed(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && options.length > 0) {
              event.preventDefault();
              setActive((value) => (value + 1) % options.length);
            } else if (event.key === "ArrowUp" && options.length > 0) {
              event.preventDefault();
              setActive(
                (value) => (value - 1 + options.length) % options.length,
              );
            } else if (event.key === "Escape" && options.length > 0) {
              event.preventDefault();
              setClosed(true);
            } else if (event.key === "Enter" && text.trim()) {
              // Enter adds a skill; with an empty field it continues.
              event.preventDefault();
              add(highlighted ?? text);
            }
          }}
        />
      </div>
      <div
        id={`${id}-options`}
        role="listbox"
        aria-label="Suggested skills"
        className="guide-options"
        hidden={options.length === 0}
      >
        {options.map((name, index) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: options are chosen from the combobox with the arrow keys and Enter.
          <div
            key={name}
            id={`${id}-option-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={name === highlighted}
            className="guide-option"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => add(name)}
          >
            <Icon name="plus" size={16} />
            {name}
            {name === highlighted && (
              <span className="guide-kbd" aria-hidden="true">
                ↵
              </span>
            )}
          </div>
        ))}
      </div>
      <p role="status" className="wb-visually-hidden">
        {message}
      </p>
    </div>
  );
}

type Project = ComponentOf<"projects">["data"]["entries"][number];

// The Projects step (Figma 471:11747): one project card at a time, with a
// tab for each project and a tile that adds another. The card holds the
// image, title and summary; technologies, links and the contribution open
// from its pills. The section is created with the first project.
export function GuideProjects({
  controller,
  disabled,
}: {
  controller: DraftController;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const root = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const component = findOptional(state.working, "projects");
  const entries = component?.data.entries ?? [];
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const current =
    entries.find((entry) => entry.id === selected) ?? entries[0] ?? null;
  function add() {
    const id = addFirstEntry(controller, "projects");
    setMessage(id ? "Project ready to edit." : full);
    if (!id) return;
    setSelected(id);
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLInputElement>(
          `[data-project-id="${CSS.escape(id)}"] .guide-project-title input`,
        )
        ?.focus(),
    );
  }
  function keys(entryId: string) {
    return (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!event.altKey || !component) return;
      const offset =
        event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const index = entries.findIndex((entry) => entry.id === entryId);
      const target = entries[index + offset];
      if (!offset || !target) return;
      event.preventDefault();
      moveEditorItem(controller, entryId, target.id, {
        componentId: component.id,
        collection: "entries",
      });
      setMessage(
        `Moved to position ${index + offset + 1} of ${entries.length}.`,
      );
    };
  }
  return (
    <div ref={root} className="guide-projects" data-guide-entries="projects">
      <ul className="guide-project-tabs" aria-label="Your projects">
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              className="guide-project-tab"
              aria-pressed={entry.id === current?.id}
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
              disabled={inactive}
              onClick={() => setSelected(entry.id)}
              onKeyDown={keys(entry.id)}
            >
              {entry.image ? (
                <img
                  src={privateImageUrl(entry.image.assetId, "project")}
                  alt=""
                />
              ) : (
                <Icon name="image" size={16} />
              )}
              {entry.title.trim() || `Project ${index + 1}`}
            </button>
          </li>
        ))}
        <li>
          <IconButton
            icon="plus"
            label="Add project"
            className="guide-project-add"
            data-add-entry=""
            disabled={inactive}
            onClick={add}
          />
        </li>
      </ul>
      {component && current ? (
        <ProjectCard
          key={current.id}
          controller={controller}
          state={state}
          componentId={component.id}
          entry={current}
          disabled={inactive}
          onRemoved={() => {
            setSelected(null);
            setMessage("Project removed.");
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLButtonElement>("[data-add-entry]")
                ?.focus(),
            );
          }}
        />
      ) : (
        <button
          type="button"
          className="guide-card guide-project-empty"
          disabled={inactive}
          onClick={add}
        >
          <Icon name="plus" size={20} />
          Add a project
        </button>
      )}
      <p role="status" className="wb-visually-hidden">
        {message}
      </p>
    </div>
  );
}

function ProjectCard({
  controller,
  state,
  componentId,
  entry,
  disabled,
  onRemoved,
}: {
  controller: DraftController;
  state: DraftState;
  componentId: string;
  entry: Project;
  disabled: boolean;
  onRemoved(): void;
}) {
  const prefix = useId();
  const [open, setOpen] = useState<string | null>(null);
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
  const listed = entry.technologies.map((item) => item.trim()).filter(Boolean);
  const links = [entry.codeUrl, entry.demoUrl].filter(Boolean).length;
  const contribution = Boolean(entry.contribution?.trim());
  const inline = (key: "title" | "summary", label: string) => {
    const fieldPath = [...path, key];
    const unfinished = Boolean(state.inputs[JSON.stringify(fieldPath)]);
    return (
      <div className={`guide-project-${key}`}>
        <label htmlFor={`${prefix}-${key}`} className="wb-visually-hidden">
          {label}
        </label>
        {key === "title" ? (
          <input
            id={`${prefix}-${key}`}
            value={readEditorField(state, fieldPath)}
            placeholder="Project name"
            disabled={disabled}
            aria-invalid={unfinished || undefined}
            onChange={(event) =>
              editEditorField(controller, fieldPath, event.target.value)
            }
          />
        ) : (
          <textarea
            id={`${prefix}-${key}`}
            value={readEditorField(state, fieldPath)}
            placeholder="What it does, in a sentence"
            rows={2}
            disabled={disabled}
            aria-invalid={unfinished || undefined}
            onChange={(event) =>
              editEditorField(controller, fieldPath, event.target.value)
            }
          />
        )}
        {key === "title" && <Icon name="pencil" size={16} />}
      </div>
    );
  };
  const pill = (
    key: string,
    icon: "code" | "link" | "plus" | "briefcase",
    label: string,
    filled: boolean,
    body: ReactNode,
  ) => (
    <Popover
      label={label}
      align="start"
      open={open === key}
      onOpenChange={(next) => setOpen(next ? key : null)}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="guide-pill"
          aria-pressed={filled}
          disabled={disabled}
        >
          <Icon name={icon} size={16} />
          {label}
        </button>
      )}
    >
      <div className="guide-popover-fields">{body}</div>
    </Popover>
  );
  return (
    <section
      className="guide-card guide-project"
      aria-label={entry.title.trim() || "New project"}
      data-project-id={entry.id}
    >
      <div data-publication-field="image">
        <ImageSlot
          variant="tile"
          label="Project"
          purpose="project"
          noun="project image"
          value={entry.image}
          description={readEditorField(state, [...path, "image", "alt"])}
          descriptionInvalid={Boolean(
            state.inputs[JSON.stringify([...path, "image", "alt"])],
          )}
          ownerId={controller.identity.ownerId}
          disabled={disabled}
          onPendingChange={(pending) =>
            controller.store.setState((current) => ({
              pendingImages: {
                ...current.pendingImages,
                [`project:${componentId}:${entry.id}`]: pending,
              },
            }))
          }
          onReady={(assetId) => {
            const previous = findOptional(
              controller.store.getState().working,
              "projects",
            )?.data.entries.find((item) => item.id === entry.id)?.image;
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
      </div>
      <div className="guide-project-body">
        {inline("title", "Project title")}
        {inline("summary", "Summary")}
        <div className="guide-pills">
          {pill(
            "technologies",
            "code",
            listed.length > 0 ? listed.join(", ") : "Technologies",
            listed.length > 0,
            <Area
              label="Technologies, one per line"
              value={technologies}
              rows={4}
              disabled={disabled}
              error={
                rawTechnologies
                  ? "Unfinished technologies stay in this browser. Shorten the draft and edit again."
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
            />,
          )}
          {pill(
            "links",
            "link",
            links === 0 ? "Links" : links === 1 ? "1 link" : `${links} links`,
            links > 0,
            <>
              <DraftField
                controller={controller}
                disabled={disabled}
                label="Code URL"
                lead="code"
                path={[...path, "codeUrl"]}
              />
              <DraftField
                controller={controller}
                disabled={disabled}
                label="Demo URL"
                lead="globe"
                path={[...path, "demoUrl"]}
              />
            </>,
          )}
          {pill(
            "contribution",
            contribution ? "briefcase" : "plus",
            "Contribution",
            contribution,
            <DraftField
              controller={controller}
              disabled={disabled}
              label="Your contribution"
              multiline
              path={[...path, "contribution"]}
            />,
          )}
        </div>
      </div>
      <Popover
        label="Remove project"
        align="end"
        open={open === "remove"}
        onOpenChange={(next) => setOpen(next ? "remove" : null)}
        trigger={(props) => (
          <IconButton
            {...props}
            icon="trash"
            label="Remove project"
            className="guide-project-remove"
            disabled={disabled}
          />
        )}
      >
        <div className="guide-popover-fields">
          <Button
            kind="danger"
            icon="trash"
            onClick={() => {
              setOpen(null);
              removeProject(controller, componentId, entry.id);
              onRemoved();
            }}
          >
            Confirm remove project
          </Button>
          <Button kind="ghost" onClick={() => setOpen(null)}>
            Keep project
          </Button>
        </div>
      </Popover>
    </section>
  );
}

export type { OptionalType };
