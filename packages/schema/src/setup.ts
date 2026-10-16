import { z } from "zod";

export const setupStepSchema = z.enum([
  "address",
  "profile",
  "links",
  "skills",
  "projects",
  "github",
  "review",
]);
// Navigation is private recovery data, never evidence of required completion.
// There is deliberately no client-editable entry/completion flag.
export const setupProgressSchema = z.strictObject({
  schemaVersion: z.literal(1),
  step: setupStepSchema,
});
export type SetupProgress = z.infer<typeof setupProgressSchema>;
export function initialSetupProgress(): SetupProgress {
  return { schemaVersion: 1, step: "address" };
}
