"use client";

import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import type { SocialLink } from "@hasaweb/schema";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import type { DraftState } from "../lib/draft/types";
import { readEditorField } from "../lib/editor/fields";
import { accountEmailSuggestion } from "../lib/editor/provider-suggestions";
import {
  addLinkTo,
  editLinkDestination,
  type LinkPlacement,
  linkDisplay,
  linkFromText,
  moveSocialLinkTo,
  readSocialPlacement,
  removeSocialLink,
  validLinkDestination,
} from "../lib/editor/social-links";
import {
  Button,
  Field,
  Icon,
  IconButton,
  type IconName,
  Popover,
} from "./workbench";
import "./links-editor.css";

const UNFINISHED =
  "Unfinished input stays in this browser. The preview keeps the last valid value.";
const NO_ROOM =
  "This draft cannot fit another link. Shorten text or remove unused content, then add it again.";

const icons: Record<string, IconName> = {
  github: "github",
  linkedin: "linkedin",
  x: "x-logo",
  email: "mail",
  website: "globe",
};
export function linkIcon(kind: string): IconName {
  return icons[kind] ?? "link";
}

type Suggestion =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; email: string }
  | { kind: "unavailable" };

// The owner's links (Figma 409:2175): one list shared by the profile and the
// Social links section. Each editor shows every link, and the eye shows or
// hides it in that editor's placement. Rows move by their grip or with Alt
// and an arrow key; selecting a row edits its label and destination. A
// pasted address becomes a new link.
export function LinksEditor(props: {
  controller: DraftController;
  disabled: boolean;
  placement: LinkPlacement;
}) {
  return <Editor key={props.controller.scopeKey} {...props} />;
}

function Editor({
  controller,
  disabled,
  placement,
}: {
  controller: DraftController;
  disabled: boolean;
  placement: LinkPlacement;
}) {
  const state = useStore(controller.store);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion>({ kind: "idle" });
  const [editing, setEditing] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const paste = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  useEffect(() => () => request.current?.abort(), []);
  const draft = state.working;
  if (!draft) return null;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const ids = draft.links.map((link) => link.id);
  const where = placement === "showInProfile" ? "profile" : "social links";

  function focusRow(id: string) {
    requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLElement>(
          `[data-link-id="${CSS.escape(id)}"] .links-editor-open`,
        )
        ?.focus(),
    );
  }
  function move(id: string, targetId: string) {
    const current = controller.store.getState().working;
    const index = current?.links.findIndex((link) => link.id === targetId);
    if (inactive || !current || index === undefined || index < 0) return;
    moveSocialLinkTo(controller, id, targetId);
    setAnnouncement(
      `Link moved to position ${index + 1} of ${current.links.length}.`,
    );
  }
  function keys(id: string) {
    return (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!event.altKey) return;
      const offset =
        event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      const target = ids[ids.indexOf(id) + offset];
      if (!offset || !target) return;
      event.preventDefault();
      move(id, target);
      focusRow(id);
    };
  }
  function add(value: string) {
    const pasted = linkFromText(value);
    if (!pasted) {
      setProblem("Enter a web address or an email address.");
      return;
    }
    const id = addLinkTo(controller, pasted, placement);
    if (!id) {
      setProblem(NO_ROOM);
      return;
    }
    setText("");
    setProblem("");
    setAnnouncement(`${pasted.label} link added.`);
    return id;
  }
  async function suggestEmail() {
    request.current?.abort();
    const pending = new AbortController();
    request.current = pending;
    setSuggestion({ kind: "loading" });
    try {
      const email = await accountEmailSuggestion({
        ...controller.identity,
        signal: pending.signal,
      });
      if (!pending.signal.aborted) setSuggestion({ kind: "ready", email });
    } catch {
      if (!pending.signal.aborted) setSuggestion({ kind: "unavailable" });
    }
  }

  return (
    <section
      className="links-editor"
      aria-label="Links"
      data-publication-field="links"
    >
      <h3 className="links-editor-title">Links</h3>
      {draft.links.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (over && active.id !== over.id)
              move(String(active.id), String(over.id));
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="links-editor-list" ref={list}>
              {draft.links.map((link) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  state={state}
                  placement={placement}
                  where={where}
                  disabled={inactive}
                  open={editing === link.id}
                  controller={controller}
                  onOpenChange={(open) => setEditing(open ? link.id : null)}
                  onKeyDown={keys(link.id)}
                  onRemove={() => {
                    setEditing(null);
                    removeSocialLink(controller, link.id);
                    setAnnouncement("Link removed.");
                    paste.current?.querySelector("input")?.focus();
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <div ref={paste}>
        <Field
          label="Add a link"
          lead="link"
          placeholder="Paste a link or email"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          disabled={inactive}
          error={problem || undefined}
          onChange={(event) => {
            setText(event.target.value);
            setProblem("");
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (text.trim() || !linkFromText(pasted)) return;
            event.preventDefault();
            add(pasted);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !text.trim()) return;
            event.preventDefault();
            add(text);
          }}
        />
      </div>
      <div className="links-editor-suggestion">
        {suggestion.kind === "ready" ? (
          <>
            <span className="links-editor-suggested">
              <Icon name="mail" size={16} />
              <strong>{suggestion.email}</strong>
              <Button
                size="s"
                disabled={inactive}
                onClick={() => {
                  if (add(suggestion.email)) setSuggestion({ kind: "idle" });
                }}
              >
                Add as public link
              </Button>
            </span>
            <IconButton
              icon="x"
              label="Dismiss account email"
              disabled={inactive}
              onClick={() => setSuggestion({ kind: "idle" })}
            />
            <p className="links-editor-note">
              Visitors see this address after you publish.
            </p>
          </>
        ) : (
          <Button
            size="s"
            kind="ghost"
            icon="mail"
            disabled={inactive || suggestion.kind === "loading"}
            onClick={() => void suggestEmail()}
          >
            {suggestion.kind === "loading"
              ? "Checking account email..."
              : "Use my account email"}
          </Button>
        )}
        {suggestion.kind === "unavailable" && (
          <p role="alert" className="links-editor-issue">
            Your account email is unavailable. Paste an email address instead.
          </p>
        )}
      </div>
      <p role="status" className="wb-visually-hidden">
        {announcement}
      </p>
    </section>
  );
}

function LinkRow({
  link,
  state,
  placement,
  where,
  disabled,
  open,
  controller,
  onOpenChange,
  onKeyDown,
  onRemove,
}: {
  link: SocialLink;
  state: DraftState;
  placement: LinkPlacement;
  where: string;
  disabled: boolean;
  open: boolean;
  controller: DraftController;
  onOpenChange(open: boolean): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onRemove(): void;
}) {
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: link.id, disabled, transition: null });
  // The grip drags with a pointer; the keyboard uses Alt with an arrow key
  // on the row, so dnd-kit's own keyboard handling stays off.
  const { onKeyDown: _dndKeys, ...pointer } = listeners ?? {};
  const path = ["links", { id: link.id }];
  const kind = readEditorField(state, [...path, "kind"]);
  const value = readEditorField(state, [...path, "value"]);
  const label = readEditorField(state, [...path, "label"]);
  const shown = readSocialPlacement(state, link, placement);
  const local = (field: string) =>
    Boolean(state.inputs[JSON.stringify([...path, field])]);
  const invalid = !validLinkDestination(kind, value);
  const name = label.trim() || "Link";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: DndCSS.Transform.toString(transform), transition }}
      className="links-editor-row"
      data-link-id={link.id}
      data-hidden={shown ? undefined : ""}
      data-invalid={invalid ? "" : undefined}
    >
      <span
        ref={setActivatorNodeRef}
        className="links-editor-grip"
        aria-hidden="true"
        {...pointer}
      >
        <Icon name="grip" size={16} />
      </span>
      <Popover
        label={`${name} link`}
        align="start"
        open={open}
        onOpenChange={onOpenChange}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className="links-editor-open"
            disabled={disabled}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            onKeyDown={(event) => {
              props.onKeyDown(event);
              onKeyDown(event);
            }}
          >
            <Icon name={linkIcon(kind)} size={18} />
            <span className="wb-visually-hidden">{name}, </span>
            <span className="links-editor-value">
              {linkDisplay(kind, value) || "No address"}
            </span>
            {invalid && <Icon name="alert" size={16} />}
          </button>
        )}
      >
        <div className="links-editor-fields">
          <Field
            label="Label"
            value={label}
            disabled={disabled}
            error={
              local("label")
                ? UNFINISHED
                : label.trim()
                  ? undefined
                  : "Add a label visitors understand."
            }
            onChange={(event) =>
              controller.edit([...path, "label"], event.target.value)
            }
          />
          <Field
            label={kind === "email" ? "Email address" : "Web address"}
            value={value}
            disabled={disabled}
            inputMode={kind === "email" ? "email" : "url"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            error={
              invalid
                ? `Enter ${kind === "email" ? "a valid email address" : "a web address"}. ${UNFINISHED}`
                : local("value")
                  ? UNFINISHED
                  : undefined
            }
            onChange={(event) =>
              editLinkDestination(controller, link.id, event.target.value)
            }
            onBlur={(event) => {
              // Adds a missing https:// once the owner leaves the field.
              const text = event.target.value;
              const completed = linkFromText(text);
              if (!disabled && completed && completed.value !== text.trim())
                editLinkDestination(controller, link.id, text, {
                  complete: true,
                });
            }}
          />
          <Button
            kind="danger"
            icon="trash"
            disabled={disabled}
            onClick={onRemove}
          >
            Remove link
          </Button>
        </div>
      </Popover>
      <IconButton
        icon={shown ? "eye" : "eye-off"}
        label={`Show ${name} in ${where}`}
        aria-pressed={shown}
        className="links-editor-eye"
        disabled={disabled}
        onClick={() => controller.edit([...path, placement], !shown)}
      />
    </li>
  );
}
