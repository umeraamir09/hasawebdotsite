import { z } from "zod";

// IDs are references, never storage keys, paths, URLs or user-supplied CSS.
export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
export const versionSchema = z.number().int().positive();
export const emailSchema = z.email();

export function isWebUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /[\s\\]/u.test(value)) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isSafeLink(value: string): boolean {
  return (
    isWebUrl(value) ||
    (value.startsWith("mailto:") &&
      emailSchema.safeParse(value.slice(7)).success &&
      !/[?%#\s]/u.test(value))
  );
}

export const webUrlSchema = z.string().refine(isWebUrl, "Enter an HTTP(S) URL");
export const safeLinkSchema = z
  .string()
  .refine(isSafeLink, "Enter a safe link");
export const draftWebUrlSchema = z.union([z.literal(""), webUrlSchema]);

export const imageReferenceSchema = z.strictObject({
  assetId: idSchema,
  alt: z.string().optional(),
});
export const pdfReferenceSchema = z.strictObject({ assetId: idSchema });
export type ImageReference = z.infer<typeof imageReferenceSchema>;

// Dates use month precision, matching a work-history date range.
export const monthSchema = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
export const draftMonthSchema = z.union([z.literal(""), monthSchema]);

export function checkUniqueIds(
  entries: readonly { id: string }[],
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  const ids = new Set<string>();
  entries.forEach((entry, index) => {
    if (ids.has(entry.id))
      ctx.addIssue({
        code: "custom",
        path: [...path, index, "id"],
        message: "Duplicate ID",
      });
    ids.add(entry.id);
  });
}
