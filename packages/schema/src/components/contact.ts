import { z } from "zod";
import { idSchema } from "../primitives";

// Private recipient and verification records live outside the draft document.
export const contactSchema = z.strictObject({
  recipientId: idSchema.optional(),
});
