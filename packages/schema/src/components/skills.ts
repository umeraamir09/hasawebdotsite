import { z } from "zod";
import { checkUniqueIds, idSchema } from "../primitives";

export const skillsSchema = z
  .strictObject({
    categories: z.array(z.strictObject({ id: idSchema, name: z.string() })),
    entries: z.array(
      z.strictObject({
        id: idSchema,
        name: z.string(),
        categoryId: idSchema.optional(),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    checkUniqueIds(data.categories, ctx, ["categories"]);
    checkUniqueIds(data.entries, ctx, ["entries"]);
    const ids = new Set(data.categories.map((category) => category.id));
    data.entries.forEach((entry, index) => {
      if (entry.categoryId && !ids.has(entry.categoryId))
        ctx.addIssue({
          code: "custom",
          path: ["entries", index, "categoryId"],
          message: "Unknown skill category",
        });
    });
  });
