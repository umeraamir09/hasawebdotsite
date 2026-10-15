import { z } from "zod";
import {
  checkUniqueIds,
  draftMonthSchema,
  draftWebUrlSchema,
  idSchema,
} from "../primitives";

export const workExperienceSchema = z
  .strictObject({
    entries: z.array(
      z
        .strictObject({
          id: idSchema,
          role: z.string(),
          organization: z.string(),
          startDate: draftMonthSchema,
          endDate: draftMonthSchema.optional(),
          current: z.boolean(),
          description: z.string(),
          organizationUrl: draftWebUrlSchema.optional(),
        })
        .superRefine((entry, ctx) => {
          if (
            entry.startDate &&
            entry.endDate &&
            entry.endDate < entry.startDate
          )
            ctx.addIssue({
              code: "custom",
              path: ["endDate"],
              message: "End date must not precede start date",
            });
        }),
    ),
  })
  .superRefine((data, ctx) => checkUniqueIds(data.entries, ctx, ["entries"]));
