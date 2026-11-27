export function publicationTaskBatch(value: string | undefined): number {
  if (value === undefined || value === "") return 16;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 32) return 16;
  return parsed;
}
