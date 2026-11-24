// The decoration gallery's choices (Figma 431:15145, 431:15358). The gallery
// reads the catalog, so a new entry needs no editor change. Search and the
// category chips appear only once the catalog has more than eight entries;
// a category chip exists for each `category` the entries name.

export type CatalogDecoration = {
  id: string;
  name: string;
  category?: string | undefined;
};
export type DecorationChoice = { id: string | null; name: string };

export const GALLERY_TOOLS_AFTER = 8;

export function galleryTools(entries: readonly CatalogDecoration[]) {
  if (entries.length <= GALLERY_TOOLS_AFTER)
    return { search: false, categories: [] as string[] };
  const categories = [
    ...new Set(
      entries.flatMap((entry) => (entry.category ? [entry.category] : [])),
    ),
  ];
  return { search: true, categories };
}

/**
 * The tiles to show: "None" first, then the catalog in order. A search or a
 * category hides "None" and keeps the entries that match.
 */
export function decorationChoices(
  entries: readonly CatalogDecoration[],
  { query = "", category = null }: { query?: string; category?: string | null },
): DecorationChoice[] {
  const text = query.trim().toLocaleLowerCase();
  const filtered = !text && category === null;
  const matches = entries.filter(
    (entry) =>
      (category === null || entry.category === category) &&
      entry.name.toLocaleLowerCase().includes(text),
  );
  return [
    ...(filtered ? [{ id: null, name: "None" }] : []),
    ...matches.map(({ id, name }) => ({ id, name })),
  ];
}

/** The Decoration row's value: the saved entry's name, or "None". */
export function decorationName(
  entries: readonly CatalogDecoration[],
  saved: string | undefined,
): string {
  if (saved === undefined) return "None";
  return entries.find((entry) => entry.id === saved)?.name ?? "Unavailable";
}
