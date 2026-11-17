import { z } from "zod";
import { idSchema } from "../primitives";

// The recipient lives outside the draft (`contact_recipient`, Phase 43).
// `recipientId` is a legacy field: readiness ignores it and publication strips it.
export const contactSchema = z.strictObject({
  recipientId: idSchema.optional(),
});
