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
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import type { DraftState } from "../lib/draft/types";
import { readEditorField } from "../lib/editor/fields";
import { accountEmailSuggestion } from "../lib/editor/provider-suggestions";
import {
  addLinkTo,
  editLinkDestination,
  linkDisplay,
  linkFromText,
  moveSocialLinkTo,
  removeSocialLink,
  validLinkDestination,
} from "../lib/editor/social-links";
import { linkIcon } from "./links-editor";
import {
  Field,
  Icon,
  IconButton,
  type IconName,
  Popover,
  StatusPill,
} from "./workbench";

const UNFINISHED =
  "Unfinished input stays in this browser. The preview keeps the last valid value.";

// Quick-add pills: each starts the field with the platform's address.
const platforms: readonly {
  kind: string;
  label: string;
  icon: IconName;
  prefix: string;
}[] = [
  { kind: "github", label: "GitHub", icon: "github", prefix: "github.com/" },
  { kind: "x", label: "X", icon: "x-logo", prefix: "x.com/" },
  {
    kind: "linkedin",
    label: "LinkedIn",
    icon: "linkedin",
    prefix: "linkedin.com/in/",
  },
];

// The Links step (Figma 471:11618, public email 463:12153): paste a link or
// email into the large field, or start one from a platform pill. The account
// email is a pill too and becomes a link only when picked; email rows carry
// the Public pill. Rows move by their grip or with Alt and an arrow key.
export function GuideLinks(props: {
  controller: DraftController;
  disabled: boolean;
}) {
  return <Links key={props.controller.scopeKey} {...props} />;
}

function Links({
  controller,
  disabled,
}: {
  controller: DraftController;
  disabled: boolean;
}) {
  const state = useStore(controller.store);
  const id = useId();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  useEffect(() => {
    const request = new AbortController();
    accountEmailSuggestion({ ...controller.identity, signal: request.signal })
      .then(setEmail)
      .catch(() => {
        // The Email pill then starts an address in the field instead.
      });
    return () => request.abort();
  }, [controller]);
  const draft = state.working;
  if (!draft) return null;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const ids = draft.links.map((link) => link.id);
  const detected = linkFromText(text);

  function add(value: string) {
    const pasted = linkFromText(value);
    if (!pasted) {
      setProblem("Enter a web address or an email address.");
      return;
    }
    const added = addLinkTo(controller, pasted, "showInProfile");
    if (!added) {
      setProblem(
        "This draft cannot fit another link. Shorten text or remove unused content, then add it again.",
      );
      return;
    }
    setText("");
    setProblem("");
    setAnnouncement(`${pasted.label} link added.`);
  }
  function start(prefix: string) {
    setText(prefix);
    setProblem("");
    requestAnimationFrame(() => {
      const input = field.current;
      input?.focus();
      input?.setSelectionRange(prefix.length, prefix.length);
    });
  }
  function move(linkId: string, targetId: string) {
    const current = controller.store.getState().working;
    const index = current?.links.findIndex((link) => link.id === targetId);
    if (inactive || !current || index === undefined || index < 0) return;
    moveSocialLinkTo(controller, linkId, targetId);
    setAnnouncement(
      `Link moved to position ${index + 1} of ${current.links.length}.`,
    );
  }
  function keys(linkId: string) {
    return (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!event.altKey) return;
      const offset =
        event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      const target = ids[ids.indexOf(linkId) + offset];
      if (!offset || !target) return;
      event.preventDefault();
      move(linkId, target);
      requestAnimationFrame(() =>
        list.current
          ?.querySelector<HTMLElement>(
            `[data-link-id="${CSS.escape(linkId)}"] .guide-link-open`,
          )
          ?.focus(),
      );
    };
  }
  const has = (kind: string, value?: string) =>
    draft.links.some(
      (link) =>
        link.kind === kind && (value === undefined || link.value === value),
    );
  return (
    <section
      className="guide-links"
      aria-label="Links"
      data-publication-field="links"
    >
      <div className="guide-big-field" data-invalid={problem ? "" : undefined}>
        <Icon name={detected ? linkIcon(detected.kind) : "link"} size={20} />
        <label htmlFor={id} className="wb-visually-hidden">
          Add a link
        </label>
        <input
          ref={field}
          id={id}
          value={text}
          placeholder="Paste a link or email"
          inputMode="url"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={inactive}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-error` : undefined}
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
            // Enter adds the link; it never continues to the next step.
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (text.trim()) add(text);
          }}
        />
        <button
          type="button"
          className="guide-kbd"
          aria-label="Add link"
          disabled={inactive || !text.trim()}
          onClick={() => add(text)}
        >
          ↵
        </button>
      </div>
      {problem && (
        <p id={`${id}-error`} className="guide-field-error">
          {problem}
        </p>
      )}
      <ul className="guide-pills" aria-label="Add a link from">
        {platforms.map((platform) => (
          <li key={platform.kind}>
            <button
              type="button"
              className="guide-pill"
              aria-pressed={has(platform.kind)}
              disabled={inactive}
              onClick={() => start(platform.prefix)}
            >
              <Icon name={platform.icon} size={16} />
              {platform.label}
            </button>
          </li>
        ))}
        <li>
          {email ? (
            <button
              type="button"
              className="guide-pill"
              aria-pressed={has("email", email)}
              aria-label={`Add ${email} as a public link`}
              disabled={inactive || has("email", email)}
              onClick={() => add(email)}
            >
              <Icon name="mail" size={16} />
              {email}
            </button>
          ) : (
            <button
              type="button"
              className="guide-pill"
              aria-pressed={has("email")}
              disabled={inactive}
              onClick={() => start("")}
            >
              <Icon name="mail" size={16} />
              Email
            </button>
          )}
        </li>
        <li>
          <button
            type="button"
            className="guide-pill"
            aria-pressed={has("website")}
            disabled={inactive}
            onClick={() => start("")}
          >
            <Icon name="globe" size={16} />
            Website
          </button>
        </li>
      </ul>
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
            <ol className="guide-link-rows" ref={list} aria-label="Your links">
              {draft.links.map((link) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  state={state}
                  disabled={inactive}
                  open={editing === link.id}
                  controller={controller}
                  onOpenChange={(open) => setEditing(open ? link.id : null)}
                  onKeyDown={keys(link.id)}
                  onRemove={() => {
                    setEditing(null);
                    removeSocialLink(controller, link.id);
                    setAnnouncement("Link removed.");
                    field.current?.focus();
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <p role="status" className="wb-visually-hidden">
        {announcement}
      </p>
    </section>
  );
}

function LinkRow({
  link,
  state,
  disabled,
  open,
  controller,
  onOpenChange,
  onKeyDown,
  onRemove,
}: {
  link: SocialLink;
  state: DraftState;
  disabled: boolean;
  open: boolean;
  controller: DraftController;
  onOpenChange(open: boolean): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onRemove(): void;
}) {
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: link.id, disabled, transition: null });
  // The grip drags with a pointer; the keyboard uses Alt with an arrow key.
  const { onKeyDown: _dndKeys, ...pointer } = listeners ?? {};
  const path = ["links", { id: link.id }];
  const kind = readEditorField(state, [...path, "kind"]);
  const value = readEditorField(state, [...path, "value"]);
  const label = readEditorField(state, [...path, "label"]);
  const local = (name: string) =>
    Boolean(state.inputs[JSON.stringify([...path, name])]);
  const invalid = !validLinkDestination(kind, value);
  const name = label.trim() || "Link";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: DndCSS.Transform.toString(transform), transition }}
      className="guide-link-row"
      data-link-id={link.id}
      data-invalid={invalid || !label.trim() ? "" : undefined}
    >
      <span
        ref={setActivatorNodeRef}
        className="guide-link-grip"
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
            className="guide-link-open"
            disabled={disabled}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            onKeyDown={(event) => {
              props.onKeyDown(event);
              onKeyDown(event);
            }}
          >
            <Icon name={linkIcon(kind)} size={18} />
            <span className="wb-visually-hidden">{name}, </span>
            <span className="guide-link-value">
              {linkDisplay(kind, value) || "No address"}
            </span>
            {(invalid || !label.trim()) && <Icon name="alert" size={16} />}
          </button>
        )}
      >
        <div className="guide-link-fields">
          <Field
            label="Link label"
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
        </div>
      </Popover>
      {kind === "email" && <StatusPill status="pending">Public</StatusPill>}
      <IconButton
        icon="x"
        label={`Remove ${name} link`}
        className="guide-link-remove"
        disabled={disabled}
        onClick={onRemove}
      />
    </li>
  );
}
