import { z } from "zod";
import { type DraftDoc, toPublicContent } from "./draft";
import { setupCommandSchema } from "./setup-entry";

export const PUBLICATION_ASSET_PAGE = 8;
export const PUBLICATION_ISSUE_LIMIT = 50;
export const publicationIssueSchema = z.strictObject({
  code: z.enum([
    "required",
    "address",
    "catalog",
    "asset",
    "github",
    "recipient",
  ]),
  path: z
    .array(z.union([z.string().max(128), z.number().int().nonnegative()]))
    .max(64),
});
export type PublicationIssue = z.infer<typeof publicationIssueSchema>;
export const publicationCommandSchema = setupCommandSchema.extend({
  assetOffset: z.number().int().min(0).max(1_048_576).default(0),
});
export type PublicationCommand = z.infer<typeof publicationCommandSchema>;
export const publicationResultSchema = z.strictObject({
  portfolioId: z.string(),
  revision: z.number().int().nonnegative(),
  issues: z
    .array(publicationIssueSchema)
    .max(PUBLICATION_ISSUE_LIMIT + PUBLICATION_ASSET_PAGE + 1),
  hasMoreIssues: z.boolean(),
  nextAssetOffset: z.number().int().nonnegative().nullable(),
});
export type PublicationResult = z.infer<typeof publicationResultSchema>;

// Browser/offline projection only. Readiness and revision checks precede any
// immutable snapshot; this helper is neither an authorization nor a manifest.
export function publicationContent(draft: DraftDoc) {
  const content = toPublicContent(draft);
  return {
    ...content,
    components: content.components.filter(
      (component) => !draft.samples[`components.${component.id}`],
    ),
    profile: {
      ...content.profile,
      faceReveal: content.profile.faceReveal.enabled
        ? content.profile.faceReveal
        : { enabled: false },
    },
  };
}
