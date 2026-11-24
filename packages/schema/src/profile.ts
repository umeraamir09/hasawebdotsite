import { z } from "zod";
import { idSchema, imageReferenceSchema } from "./primitives";

// A bio longer than this blocks setup continuation and Publish. The draft
// still loads and saves a longer bio, so an older draft is never rejected.
export const BIO_MAX = 160;

export const profileSchema = z.strictObject({
  name: z.string(),
  bio: z.string(),
  location: z.string().optional(),
  avatar: imageReferenceSchema.extend({ accepted: z.boolean() }).optional(),
  banner: imageReferenceSchema.optional(),
  decorationId: idSchema.optional(),
  faceReveal: z.strictObject({
    enabled: z.boolean(),
    image: imageReferenceSchema.optional(),
  }),
});
export type Profile = z.infer<typeof profileSchema>;
export const profileDefinition = {
  type: "profile",
  version: 1,
  singleton: true,
  fixed: true,
  schema: profileSchema,
  defaults: (): Profile => ({
    name: "",
    bio: "",
    faceReveal: { enabled: false },
  }),
};
