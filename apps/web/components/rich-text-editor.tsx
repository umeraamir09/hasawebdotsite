"use client";

import {
  type CaseStudyDocument,
  caseStudyRichTextContentSchema,
  clearSample,
  idSchema,
  type RichTextDocument,
  richTextContentSchema,
  safeLinkSchema,
} from "@hasaweb/schema";
import Link from "@tiptap/extension-link";
import { ListItem, OrderedList } from "@tiptap/extension-list";
import { Selection } from "@tiptap/pm/state";
import {
  type Editor,
  EditorContent,
  type JSONContent,
  mergeAttributes,
  Node,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId, useMemo, useState } from "react";
import { useStore } from "zustand";
import { privateImageUrl } from "../lib/assets/browser";
import type { DraftController } from "../lib/draft/controller";
import { getAt, resolveField } from "../lib/draft/planner";
import type { FieldPath } from "../lib/draft/types";
import { ImageUpload } from "./image-upload";

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

// Case-study image blocks hold only an uploaded asset ID and description, as
// the saved schema requires. No parse rule exists, so pasted or dropped HTML
// (including <img src>) can never create an image node; only a ready upload
// inserted by these controls can. List items and headings cannot contain it.
export const CaseStudyImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      assetId: { default: null, rendered: false },
      alt: { default: "", rendered: false },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node, HTMLAttributes }) {
    const assetId = idSchema.safeParse(node.attrs.assetId);
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { class: "rich-text-image" }),
      assetId.success
        ? [
            "img",
            {
              src: privateImageUrl(assetId.data, "case_study"),
              alt: typeof node.attrs.alt === "string" ? node.attrs.alt : "",
            },
          ]
        : ["span", {}, "Image unavailable"],
    ];
  },
});

// Top-level positions of image blocks, in document order.
function imagePositions(editor: Editor) {
  const positions: number[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "image") positions.push(offset);
  });
  return positions;
}

export function RichTextEditor({
  controller,
  path,
  sampleKey,
  label,
  inactive,
  images = false,
}: {
  controller: DraftController;
  path: FieldPath;
  sampleKey: string;
  label: string;
  inactive: boolean;
  images?: boolean;
}) {
  const state = useStore(controller.store);
  const schema = images
    ? caseStudyRichTextContentSchema
    : richTextContentSchema;
  const raw = state.inputs[JSON.stringify(path)];
  // Use the store's own reference for the saved body: the sync effect below
  // must see a stable object, or each render would reset the editor content.
  let saved: RichTextDocument | CaseStudyDocument | undefined;
  try {
    const value = state.working
      ? getAt(state.working, resolveField(state.working, path))
      : undefined;
    if (value && typeof value === "object" && "type" in value)
      saved = value as RichTextDocument | CaseStudyDocument;
  } catch {
    saved = undefined;
  }
  // Raw input is JSON checked by the controller, but may exceed the draft
  // byte budget. Keep it editable so the owner can shorten it after reload.
  const recovered = useMemo(
    () => (raw ? schema.safeParse(raw.value) : null),
    [raw, schema],
  );
  const body: RichTextDocument | CaseStudyDocument | undefined =
    recovered?.success ? recovered.data : saved;
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
      ...(images ? [CaseStudyImage] : []),
    ],
    // Saved/recovered documents have passed the schema. Tiptap types do not
    // permit explicit undefined optional attributes used by the schema types.
    content: body as JSONContent,
    editable: !inactive,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        class: "rich-text-input",
      },
      // Files dropped or pasted into the body never upload implicitly.
      handleDrop: (_view, event) => Boolean(event.dataTransfer?.files.length),
      handlePaste: (_view, event) => Boolean(event.clipboardData?.files.length),
    },
    onUpdate: ({ editor }) => {
      // Tiptap JSON is external input. The controller owns full-draft validation
      // and retains rejected edits in owner-scoped recovery.
      if (controller.edit(path, editor.getJSON())) {
        const draft = controller.store.getState().working;
        if (draft?.samples[sampleKey])
          controller.update(clearSample(draft, sampleKey));
      }
    },
  });
  useEffect(() => {
    editor?.setEditable(!inactive, false);
  }, [editor, inactive]);
  useEffect(() => {
    // Compare in the schema's key order. Tiptap emits text-node keys in a
    // different order, and a raw string comparison would reset the document
    // (and the cursor) after every edit that contains a link.
    const canonical = (value: unknown) => {
      const parsed = schema.safeParse(value);
      return JSON.stringify(parsed.success ? parsed.data : value);
    };
    if (editor && body && canonical(editor.getJSON()) !== canonical(body))
      editor.commands.setContent(body as JSONContent, { emitUpdate: false });
  }, [editor, body, schema]);
  const blocks = body?.content.flatMap((node) =>
    node.type === "image" ? [node.attrs] : [],
  );
  function changeImage(
    index: number,
    attrs: { assetId?: string; alt?: string },
  ) {
    if (!editor) return;
    const position = imagePositions(editor)[index];
    const node =
      position === undefined ? null : editor.state.doc.nodeAt(position);
    if (position === undefined || !node) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, {
        ...node.attrs,
        ...attrs,
      }),
    );
  }
  function removeImage(index: number) {
    if (!editor) return;
    const position = imagePositions(editor)[index];
    const node =
      position === undefined ? null : editor.state.doc.nodeAt(position);
    if (position === undefined || !node) return;
    editor.view.dispatch(
      editor.state.tr.delete(position, position + node.nodeSize),
    );
  }
  function insertImage(assetId: string) {
    if (!editor) throw new Error("The editor is not ready. Retry the upload.");
    // Insert after the top-level block holding the cursor, never inside a list.
    const { $from } = editor.state.selection;
    const position =
      $from.depth > 0 ? $from.after(1) : editor.state.doc.content.size;
    const inserted = editor
      .chain()
      .insertContentAt(
        position,
        { type: "image", attrs: { assetId, alt: "" } },
        { updateSelection: false },
      )
      // Keep the cursor in the text before the image. A selection on the new
      // atom would let the next keystroke or paste replace the image.
      .command(({ tr }) => {
        tr.setSelection(Selection.near(tr.doc.resolve(position), -1));
        return true;
      })
      .run();
    if (!inserted) throw new Error("The image could not be added. Retry.");
    if (controller.store.getState().inputs[JSON.stringify(path)]) {
      // The body no longer fits the draft. Keep the previous saved body.
      editor.commands.undo();
      throw new Error(
        "The image is ready but cannot fit in your draft. Shorten content and retry.",
      );
    }
  }
  return (
    <>
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
      {images && (
        <fieldset
          disabled={inactive || !editor}
          className="case-study-images"
          aria-label="Case study images"
        >
          <legend>Images</legend>
          <p className="editor-muted">
            Uploaded images appear after the paragraph, heading or list that
            holds your cursor. Pasted or dropped images are not added.
          </p>
          {blocks?.map((image, index) => (
            <ImageUpload
              // Asset IDs are immutable, so a replacement remounts the control.
              // The position disambiguates a repeated asset after undo.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above.
              key={`${index}:${image.assetId}`}
              label={`Case study ${index + 1}`}
              noun="image"
              purpose="case_study"
              ownerId={controller.identity.ownerId}
              disabled={inactive || !editor}
              value={image}
              description={image.alt ?? ""}
              onPendingChange={(pending) =>
                controller.store.setState((current) => ({
                  pendingImages: {
                    ...current.pendingImages,
                    [`case-study:${JSON.stringify(path)}:${index}`]: pending,
                  },
                }))
              }
              onReady={(assetId) => changeImage(index, { assetId })}
              onRemove={() => removeImage(index)}
              onDescription={(alt) => changeImage(index, { alt })}
            />
          ))}
          <ImageUpload
            key={`new:${blocks?.length ?? 0}`}
            label="New case study"
            noun="image"
            purpose="case_study"
            ownerId={controller.identity.ownerId}
            disabled={inactive || !editor}
            value={undefined}
            description=""
            onPendingChange={(pending) =>
              controller.store.setState((current) => ({
                pendingImages: {
                  ...current.pendingImages,
                  [`case-study:${JSON.stringify(path)}:new`]: pending,
                },
              }))
            }
            onReady={insertImage}
            onRemove={() => {}}
            onDescription={() => {}}
          />
        </fieldset>
      )}
    </>
  );
}
