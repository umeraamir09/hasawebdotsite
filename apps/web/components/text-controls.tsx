"use client";

import {
  clearSample,
  richTextContentSchema,
  safeLinkSchema,
} from "@hasaweb/schema";
import Link from "@tiptap/extension-link";
import { ListItem, OrderedList } from "@tiptap/extension-list";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { DraftTextField } from "./draft-text-field";

// Persist only the destination. Browser-only link attributes belong to rendering.
const SafeLink = Link.extend({
  addAttributes() {
    return { href: { default: null } };
  },
}).configure({
  openOnClick: false,
  autolink: false,
  linkOnPaste: false,
  isAllowedUri: (url) => safeLinkSchema.safeParse(url).success,
});

const SafeListItem = ListItem.extend({
  content: "paragraph (paragraph | bulletList | orderedList)*",
});

const SafeOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const start = Number(element.getAttribute("start") ?? 1);
          return Number.isSafeInteger(start) && start > 0 ? start : 1;
        },
      },
    };
  },
});

export function TextControls(props: {
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
  const component = state.working?.components.find(
    (item) => item.id === componentId,
  );
  const path = ["components", { id: componentId }, "data", "body"];
  const raw = state.inputs[JSON.stringify(path)];
  // Raw input is JSON checked by the controller, but may exceed the draft
  // byte budget. Keep it editable so the owner can shorten it after reload.
  const recovered = raw ? richTextContentSchema.safeParse(raw.value) : null;
  const body = recovered?.success
    ? recovered.data
    : component?.type === "text"
      ? component.data.body
      : undefined;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const id = useId();
  const [destination, setDestination] = useState("");
  const [linkError, setLinkError] = useState("");
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4, 5, 6] },
        bold: false,
        italic: false,
        strike: false,
        underline: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        hardBreak: false,
        link: false,
        trailingNode: false,
        orderedList: false,
        listItem: false,
      }),
      SafeLink,
      SafeOrderedList,
      SafeListItem,
    ],
    // Saved/recovered documents have passed the schema. Tiptap types do not
    // permit explicit undefined optional attributes used by the schema types.
    content: body as JSONContent,
    editable: !inactive,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Section body",
        "aria-multiline": "true",
        class: "rich-text-input",
      },
    },
    onUpdate: ({ editor }) => {
      // Tiptap JSON is external input. The controller owns full-draft validation
      // and retains rejected edits in owner-scoped recovery.
      if (controller.edit(path, editor.getJSON())) {
        const draft = controller.store.getState().working;
        if (draft?.samples[`components.${componentId}`])
          controller.update(clearSample(draft, `components.${componentId}`));
      }
    },
  });
  useEffect(() => {
    editor?.setEditable(!inactive, false);
  }, [editor, inactive]);
  useEffect(() => {
    if (
      editor &&
      body &&
      JSON.stringify(editor.getJSON()) !== JSON.stringify(body)
    )
      editor.commands.setContent(body as JSONContent, { emitUpdate: false });
  }, [editor, body]);
  if (component?.type !== "text") return null;
  return (
    <section aria-label="Text section controls">
      <h2>Text section</h2>
      <DraftTextField
        controller={controller}
        disabled={inactive}
        label="Section title"
        path={["components", { id: componentId }, "data", "title"]}
      />
      <p className="editor-muted">
        Use headings, paragraphs, lists and links. Edits stay private until
        Publish.
      </p>
      <fieldset disabled={inactive || !editor} className="rich-text-tools">
        <legend>Text formatting</legend>
        <button
          type="button"
          aria-pressed={editor?.isActive("paragraph") ?? false}
          onClick={() => editor?.chain().focus().setParagraph().run()}
        >
          Paragraph
        </button>
        {([2, 3, 4, 5, 6] as const).map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={editor?.isActive("heading", { level }) ?? false}
            onClick={() => editor?.chain().focus().setHeading({ level }).run()}
          >
            Heading {level}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={editor?.isActive("bulletList") ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          Bullet list
        </button>
        <button
          type="button"
          aria-pressed={editor?.isActive("orderedList") ?? false}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          Numbered list
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().undo().run()}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().redo().run()}
        >
          Redo
        </button>
      </fieldset>
      <EditorContent editor={editor} />
      {raw && (
        <p role="status">
          This body has unfinished content saved only in this browser. Shorten
          or repair it before Publish.
        </p>
      )}
      <fieldset disabled={inactive || !editor} className="editor-field">
        <legend>Link selected text</legend>
        <label htmlFor={id}>Link destination</label>
        <input
          id={id}
          value={destination}
          aria-invalid={Boolean(linkError)}
          aria-describedby={`${id}-note`}
          onChange={(event) => {
            setDestination(event.target.value);
            setLinkError("");
          }}
        />
        <p id={`${id}-note`}>
          {linkError ||
            "Select text, then enter an http://, https:// or mailto: destination."}
        </p>
        <button
          type="button"
          onClick={() => {
            const parsed = safeLinkSchema.safeParse(destination);
            if (!parsed.success) {
              setLinkError(
                "Use a complete http://, https:// or mailto: destination.",
              );
              return;
            }
            if (editor?.state.selection.empty && !editor.isActive("link")) {
              setLinkError("Select the text to link first.");
              return;
            }
            editor
              ?.chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href: parsed.data })
              .run();
            setDestination("");
          }}
        >
          Apply link
        </button>
        <button
          type="button"
          onClick={() =>
            editor?.chain().focus().extendMarkRange("link").unsetLink().run()
          }
        >
          Remove link
        </button>
      </fieldset>
    </section>
  );
}
