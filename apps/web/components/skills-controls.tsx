"use client";

import { useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { moveEditorItem } from "../lib/editor/components";
import { readEditorField } from "../lib/editor/fields";
import {
  addSkill,
  addSkillCategory,
  removeSkill,
  removeSkillCategory,
  setSkillCategory,
} from "../lib/editor/skills";
import { DraftTextField } from "./draft-text-field";
import { OrderedItems } from "./ordered-items";

export function SkillsControls(props: {
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
  const prefix = useId();
  const section = useRef<HTMLElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const component = state.working?.components.find(
    (item) => item.id === componentId,
  );
  if (component?.type !== "skills") return null;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const { entries, categories } = component.data;
  const base = ["components", { id: componentId }, "data"];
  const focus = (selector: string) =>
    requestAnimationFrame(() =>
      section.current?.querySelector<HTMLElement>(selector)?.focus(),
    );
  const full =
    "This draft cannot fit more skills. Shorten text or remove unused content and try again.";
  return (
    <section
      ref={section}
      aria-label="Skills and technologies controls"
      className="skills-controls"
    >
      <h2>Skills and technologies</h2>
      <p className="editor-muted">
        Add the skills and technologies you choose to list. Each skill needs a
        name before Publish. Categories are optional and uncategorized skills
        appear after the categories. Edits stay private until Publish.
      </p>
      {entries.length > 0 && (
        <OrderedItems
          label="Skill order"
          disabled={inactive}
          items={entries.map((entry, index) => ({
            id: entry.id,
            label: entry.name || `Skill ${index + 1}`,
          }))}
          onMove={(id, target) =>
            moveEditorItem(controller, id, target, {
              componentId,
              collection: "entries",
            })
          }
        />
      )}
      {entries.map((entry, index) => {
        const path = [...base, "entries", { id: entry.id }];
        return (
          <fieldset
            key={entry.id}
            disabled={inactive}
            className="skill-entry"
            data-skill-id={entry.id}
          >
            <legend>
              Skill {index + 1}
              {entry.name ? ` · ${entry.name}` : ""}
            </legend>
            <DraftTextField
              controller={controller}
              disabled={inactive}
              label="Skill name"
              path={[...path, "name"]}
              error={
                !readEditorField(state, [...path, "name"]).trim()
                  ? "Add a skill name before Publish."
                  : undefined
              }
            />
            {categories.length > 0 && (
              <div className="editor-field">
                <label htmlFor={`${prefix}-${entry.id}-category`}>
                  Category (optional)
                </label>
                <select
                  id={`${prefix}-${entry.id}-category`}
                  value={entry.categoryId ?? ""}
                  onChange={(event) =>
                    setSkillCategory(
                      controller,
                      componentId,
                      entry.id,
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category, categoryIndex) => (
                    <option key={category.id} value={category.id}>
                      {category.name || `Category ${categoryIndex + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button type="button" onClick={() => setRemoving(entry.id)}>
              Remove skill
            </button>
            {removing === entry.id && (
              <fieldset aria-label="Confirm skill removal">
                <p>
                  Remove this skill and its entered content? Your public site
                  changes after Publish.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    removeSkill(controller, componentId, entry.id);
                    setRemoving(null);
                    focus("[data-add-skill]");
                  }}
                >
                  Confirm remove skill
                </button>
                <button type="button" onClick={() => setRemoving(null)}>
                  Keep skill
                </button>
              </fieldset>
            )}
          </fieldset>
        );
      })}
      <button
        type="button"
        data-add-skill
        disabled={inactive}
        onClick={() => {
          const id = addSkill(controller, componentId);
          setMessage(id ? "Skill ready to edit." : full);
          if (id) focus(`[data-skill-id="${id}"] input`);
        }}
      >
        Add skill
      </button>
      <h3>Categories (optional)</h3>
      {categories.length > 1 && (
        <OrderedItems
          label="Category order"
          disabled={inactive}
          items={categories.map((category, index) => ({
            id: category.id,
            label: category.name || `Category ${index + 1}`,
          }))}
          onMove={(id, target) =>
            moveEditorItem(controller, id, target, {
              componentId,
              collection: "categories",
            })
          }
        />
      )}
      {categories.map((category, index) => {
        const path = [...base, "categories", { id: category.id }];
        const members = entries.filter(
          (entry) => entry.categoryId === category.id,
        ).length;
        return (
          <fieldset
            key={category.id}
            disabled={inactive}
            className="skill-category"
            data-category-id={category.id}
          >
            <legend>
              Category {index + 1}
              {category.name ? ` · ${category.name}` : ""}
            </legend>
            <DraftTextField
              controller={controller}
              disabled={inactive}
              label="Category name"
              path={[...path, "name"]}
              error={
                !readEditorField(state, [...path, "name"]).trim()
                  ? "Add a category name before Publish."
                  : undefined
              }
            />
            <button
              type="button"
              onClick={() => setRemoving(`category:${category.id}`)}
            >
              Remove category
            </button>
            {removing === `category:${category.id}` && (
              <fieldset aria-label="Confirm category removal">
                <p>
                  Remove this category?{" "}
                  {members
                    ? `Its ${members} ${members === 1 ? "skill stays" : "skills stay"} in your list as uncategorized.`
                    : "It has no skills."}{" "}
                  Your public site changes after Publish.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    removeSkillCategory(controller, componentId, category.id);
                    setRemoving(null);
                    focus("[data-add-category]");
                  }}
                >
                  Confirm remove category
                </button>
                <button type="button" onClick={() => setRemoving(null)}>
                  Keep category
                </button>
              </fieldset>
            )}
          </fieldset>
        );
      })}
      <button
        type="button"
        data-add-category
        disabled={inactive}
        onClick={() => {
          const id = addSkillCategory(controller, componentId);
          setMessage(id ? "Category ready to edit." : full);
          if (id) focus(`[data-category-id="${id}"] input`);
        }}
      >
        Add category
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
