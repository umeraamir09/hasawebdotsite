import { z } from "zod";

export const publicationStartSchema = z.strictObject({
  portfolioId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  operationId: z.string().uuid(),
});
export const publicationStatusCommandSchema = z.strictObject({
  portfolioId: z.string().min(1),
  operationId: z.string().uuid().optional(),
});
export const publicationCommitRequestSchema =
  publicationStatusCommandSchema.required();
const common = {
  operationId: z.string().uuid(),
  portfolioId: z.string(),
  revision: z.number().int().nonnegative(),
};
export const publicationOperationSchema = z.discriminatedUnion("stage", [
  z.strictObject({
    ...common,
    stage: z.enum([
      "admitting",
      "preparing",
      "assembling",
      "transferring",
      "ready",
    ]),
  }),
  z.strictObject({
    ...common,
    stage: z.literal("failed"),
    error: z.enum([
      "preparation_failed",
      "revision_conflict",
      "unavailable_address",
      "stale_publication",
      "candidate_unavailable",
    ]),
  }),
  z.strictObject({
    ...common,
    stage: z.literal("withdrawing"),
    url: z.string().url(),
    retrying: z.boolean(),
  }),
  z.strictObject({
    ...common,
    stage: z.literal("published"),
    url: z.string().url(),
  }),
]);
export type PublicationOperation = z.infer<typeof publicationOperationSchema>;
