import { z } from "zod";
import { idSchema, imageReferenceSchema } from "./primitives";

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
