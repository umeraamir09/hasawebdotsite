import { z } from "zod";
import { boundedJsonSchema } from "./json";
import { imageReferenceSchema, safeLinkSchema } from "./primitives";

const linkMarkSchema = z.strictObject({
  type: z.literal("link"),
  attrs: z.strictObject({ href: safeLinkSchema }),
});
const textNodeSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(linkMarkSchema).max(1).optional(),
});
const paragraphSchema = z.strictObject({
  type: z.literal("paragraph"),
  content: z.array(textNodeSchema).optional(),
});
const headingSchema = z.strictObject({
  type: z.literal("heading"),
  attrs: z.strictObject({
    level: z.union([
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
  }),
  content: z.array(textNodeSchema).optional(),
});

type TextNode = z.infer<typeof textNodeSchema>;
type Paragraph = z.infer<typeof paragraphSchema>;
type Heading = z.infer<typeof headingSchema>;
type ListItems = {
  type: "listItem";
  content: [Paragraph, ...(Paragraph | RichList)[]];
}[];
export type RichList =
  | {
      type: "bulletList";
      content: ListItems;
    }
  | {
      type: "orderedList";
      attrs?: { start: number } | undefined;
      content: ListItems;
    };
const listSchema: z.ZodType<RichList> = z.lazy(() => {
  const content = z
    .array(
      z.strictObject({
        type: z.literal("listItem"),
        content: z.tuple(
          [paragraphSchema],
          z.union([paragraphSchema, listSchema]),
        ),
      }),
    )
    .min(1);
  return z.union([
    z.strictObject({ type: z.literal("bulletList"), content }),
    z.strictObject({
      type: z.literal("orderedList"),
      attrs: z.strictObject({ start: z.number().int().positive() }).optional(),
      content,
    }),
  ]);
});
const imageNodeSchema = z.strictObject({
  type: z.literal("image"),
  attrs: imageReferenceSchema,
});
export type RichTextDocument = {
  type: "doc";
  content: (Paragraph | Heading | RichList)[];
};
export type CaseStudyDocument = {
  type: "doc";
  content: (Paragraph | Heading | RichList | z.infer<typeof imageNodeSchema>)[];
};
// All objects are strict. HTML, inline styles, src URLs, event handlers, embeds,
// arbitrary marks and serializer-controlled attributes cannot enter the document.
export const richTextSchema = boundedJsonSchema.pipe(
  z.strictObject({
    type: z.literal("doc"),
    content: z.array(z.union([paragraphSchema, headingSchema, listSchema])),
  }),
);
export const caseStudyRichTextSchema = boundedJsonSchema.pipe(
  z.strictObject({
    type: z.literal("doc"),
    content: z.array(
      z.union([paragraphSchema, headingSchema, listSchema, imageNodeSchema]),
    ),
  }),
);

export function emptyRichText(): RichTextDocument {
  return { type: "doc", content: [] };
}

export function richText(text: string): RichTextDocument {
  const content: TextNode[] = text ? [{ type: "text", text }] : [];
  return { type: "doc", content: [{ type: "paragraph", content }] };
}
