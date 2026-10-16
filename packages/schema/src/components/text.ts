import { z } from "zod";
import { richTextContentSchema, richTextSchema } from "../rich-text";

export const textSchema = z.strictObject({
  title: z.string(),
  body: richTextSchema,
});

export const textContentSchema = textSchema.extend({
  body: richTextContentSchema,
});
