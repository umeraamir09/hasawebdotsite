import type { z } from "zod";
import { draftWebUrlSchema, emailSchema, safeLinkSchema } from "./primitives";
import {
  type DraftPath,
  resolveDraftPath,
  schemaDefinition,
  sqlJsonPath,
  unwrapSchema,
} from "./updates";

export function inspectionSchema(
  path: DraftPath,
  types: Record<string, unknown>,
  linkKind?: string | null,
): z.ZodType {
  if (path.length === 3 && path[0] === "links" && path[2] === "value") {
    return linkKind === "email"
      ? emailSchema.or(draftWebUrlSchema.options[0])
      : draftWebUrlSchema;
  }
  let schema = unwrapSchema(resolveDraftPath(path, types, true));
  const options = (value: z.ZodType): z.ZodType[] => {
    const current = unwrapSchema(value),
      def = schemaDefinition(current);
    return def.type === "union"
      ? (def.options ?? []).flatMap(options)
      : [current];
  };
  if (schemaDefinition(schema).type === "union") {
    const candidates = options(schema);
    if (
      candidates.some(
        (candidate) => schemaDefinition(candidate).type === "object",
      )
    ) {
      const type = types[sqlJsonPath(path)];
      const selected = candidates.find((candidate) => {
        const field = schemaDefinition(candidate).shape?.type;
        return (
          field && schemaDefinition(unwrapSchema(field)).values?.includes(type)
        );
      });
      if (!selected) throw new Error("Unknown discriminator");
      schema = selected;
    }
  }
  return schema;
}
export function inspectionFreeText(schema: z.ZodType): boolean {
  const def = schemaDefinition(unwrapSchema(schema));
  return (
    def.type === "string" &&
    (def.checks ?? []).every(
      (check) =>
        check._zod.def.check === "min_length" &&
        (check._zod.def.minimum ?? 0) <= 1,
    )
  );
}
export function inspectionDestination(path: DraftPath): boolean {
  return (
    (path.length === 3 && path[0] === "links" && path[2] === "value") ||
    ["href", "codeUrl", "demoUrl", "organizationUrl"].includes(
      String(path.at(-1)),
    )
  );
}
export function validateDestination(
  path: DraftPath,
  value: string,
  linkKind?: string | null,
): void {
  if (!inspectionDestination(path)) throw new Error("Not a destination");
  if (path.at(-1) === "href") safeLinkSchema.parse(value);
  else if (path[0] === "links" && linkKind === "email") {
    if (value !== "") emailSchema.parse(value);
  } else draftWebUrlSchema.parse(value);
}
