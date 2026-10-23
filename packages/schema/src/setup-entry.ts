import { z } from "zod";
import { saveRevisionSchema } from "./owner-saves";
import { setupProgressSchema } from "./setup";

export const setupFieldSchema = z.enum([
  "address",
  "name",
  "bio",
  "avatar",
  "banner",
  "links",
]);
export type SetupField = z.infer<typeof setupFieldSchema>;
export const setupCommandSchema = z.strictObject({
  portfolioId: z.string().min(1).max(128),
  revision: saveRevisionSchema,
});
export type SetupCommand = z.infer<typeof setupCommandSchema>;
export const setupResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("required"),
    portfolioId: z.string(),
    revision: saveRevisionSchema,
    issues: z.array(setupFieldSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("ready"),
    portfolioId: z.string(),
    revision: saveRevisionSchema,
  }),
  z.strictObject({
    kind: z.literal("editor"),
    portfolioId: z.string(),
    revision: saveRevisionSchema,
    firstEditorEnteredAt: z.number().int().positive(),
  }),
]);
export type SetupResult = z.infer<typeof setupResultSchema>;
export const accountEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("setup"),
    revision: saveRevisionSchema,
    progress: setupProgressSchema,
  }),
  z.strictObject({
    kind: z.literal("editor"),
    revision: saveRevisionSchema,
    firstEditorEnteredAt: z.number().int().positive(),
  }),
]);
export type AccountEntry = z.infer<typeof accountEntrySchema>;
export const accountEntryResponseSchema = z.strictObject({
  user: z.strictObject({ id: z.string(), name: z.string() }),
  portfolio: z.strictObject({ id: z.string() }),
  entry: accountEntrySchema,
});
