import { z } from "zod";
import { pdfReferenceSchema } from "../primitives";

export const resumeSchema = z.strictObject({
  file: pdfReferenceSchema.optional(),
});
