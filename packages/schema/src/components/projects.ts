import { z } from "zod";
import {
  checkUniqueIds,
  draftWebUrlSchema,
  idSchema,
  imageReferenceSchema,
} from "../primitives";
import {
  caseStudyRichTextContentSchema,
  caseStudyRichTextSchema,
} from "../rich-text";

export const projectSchema = z.strictObject({
  id: idSchema,
  title: z.string(),
  summary: z.string(),
  image: imageReferenceSchema.optional(),
  technologies: z.array(z.string()),
  contribution: z.string(),
  codeUrl: draftWebUrlSchema.optional(),
  demoUrl: draftWebUrlSchema.optional(),
  caseStudy: z
    .strictObject({
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(80),
      body: caseStudyRichTextSchema,
    })
    .optional(),
});
function projectsWith(schema: z.ZodType<z.infer<typeof projectSchema>>) {
  return z
    .strictObject({ entries: z.array(schema) })
    .superRefine((data, ctx) => {
      checkUniqueIds(data.entries, ctx, ["entries"]);
      const slugs = new Set<string>();
      data.entries.forEach((entry, index) => {
        if (!entry.caseStudy) return;
        if (slugs.has(entry.caseStudy.slug))
          ctx.addIssue({
            code: "custom",
            path: ["entries", index, "caseStudy", "slug"],
            message: "Duplicate case-study slug",
          });
        slugs.add(entry.caseStudy.slug);
      });
    });
}
export const projectsSchema = projectsWith(projectSchema);
export const projectsContentSchema = projectsWith(
  projectSchema.extend({
    caseStudy: projectSchema.shape.caseStudy
      .unwrap()
      .extend({ body: caseStudyRichTextContentSchema })
      .optional(),
  }),
);
