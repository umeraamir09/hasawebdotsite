import { z } from "zod";
import { richTextSchema } from "../rich-text";

export const textSchema = z.strictObject({
  title: z.string(),
  body: richTextSchema,
});
