import { z } from "zod";
import { idSchema } from "./primitives";

// Architecture section 8.3.1 owns these rules. The draft stores the generated
// slug; the live publication manifest is the authority for frozen slugs.
export const CASE_STUDY_SLUG_MAX = 80;
export const caseStudySlugSchema = z
  .string()
  .max(CASE_STUDY_SLUG_MAX)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const caseStudyPathSchema = z
  .string()
  .regex(/^\/projects\/[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(CASE_STUDY_SLUG_MAX + 10);
export function caseStudyPath(slug: string) {
  return `/projects/${caseStudySlugSchema.parse(slug)}`;
}

// A slug frozen by the live publication. A null project ID comes from a version
// indexed before project IDs were recorded; it keeps its slug by name only.
export const publishedCaseStudySchema = z.strictObject({
  projectId: idSchema.nullable(),
  slug: caseStudySlugSchema,
});
export type PublishedCaseStudy = z.infer<typeof publishedCaseStudySchema>;
export const caseStudyAddressCommandSchema = z.strictObject({
  portfolioId: z.string().min(1).max(128),
});
export const caseStudyAddressesSchema = z.strictObject({
  portfolioId: z.string(),
  version: z.number().int().positive().nullable(),
  addresses: z.array(publishedCaseStudySchema),
});
export type CaseStudyAddresses = z.infer<typeof caseStudyAddressesSchema>;

const trimHyphens = (value: string) => value.replace(/^-+|-+$/g, "");

export function caseStudySlugBase(title: string): string {
  const ascii = title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return (
    trimHyphens(trimHyphens(ascii).slice(0, CASE_STUDY_SLUG_MAX)) || "project"
  );
}

export function caseStudySlugCandidate(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = `-${n}`;
  return `${trimHyphens(base.slice(0, CASE_STUDY_SLUG_MAX - suffix.length))}${suffix}`;
}

export type CaseStudySlugEntry = {
  id: string;
  title: string;
  caseStudy?: { slug: string } | undefined;
};

function frozenSlug(
  entry: CaseStudySlugEntry,
  published: readonly PublishedCaseStudy[],
): string | undefined {
  const byId = published.find((item) => item.projectId === entry.id);
  if (byId) return byId.slug;
  const legacy = published.find(
    (item) => item.projectId === null && item.slug === entry.caseStudy?.slug,
  );
  return legacy?.slug;
}

function nextFree(title: string, taken: ReadonlySet<string>) {
  const base = caseStudySlugBase(title);
  for (let n = 1; ; n++) {
    const slug = caseStudySlugCandidate(base, n);
    if (!taken.has(slug)) return slug;
  }
}

// Slugs another project cannot use: every live slug of a different project,
// including a deleted project whose removal has not been published yet, plus
// slugs held by other draft entries.
function takenBy(
  entry: CaseStudySlugEntry,
  entries: readonly CaseStudySlugEntry[],
  published: readonly PublishedCaseStudy[],
) {
  const taken = new Set<string>();
  for (const item of published)
    if (item.projectId !== entry.id) taken.add(item.slug);
  for (const other of entries)
    if (other.id !== entry.id && other.caseStudy)
      taken.add(other.caseStudy.slug);
  return taken;
}

// Returns the slug for one project's case study. A frozen slug never changes
// after first publication. Otherwise the slug regenerates from the title.
export function assignCaseStudySlug(
  entry: CaseStudySlugEntry,
  entries: readonly CaseStudySlugEntry[],
  published: readonly PublishedCaseStudy[],
): string {
  const frozen = frozenSlug(entry, published);
  if (frozen) return frozen;
  return nextFree(entry.title, takenBy(entry, entries, published));
}

// Repairs slugs in a loaded draft: frozen slugs are restored and an unfrozen
// slug that collides with a live or earlier draft slug is regenerated. Returns
// the slug for each entry with a case study, keyed by project ID.
export function reconcileCaseStudySlugs(
  entries: readonly CaseStudySlugEntry[],
  published: readonly PublishedCaseStudy[],
): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  const withCase = entries.filter((entry) => entry.caseStudy);
  for (const entry of withCase) {
    const frozen = frozenSlug(entry, published);
    if (frozen) {
      result.set(entry.id, frozen);
      used.add(frozen);
    }
  }
  const reserved = new Set(used);
  for (const entry of withCase) {
    if (result.has(entry.id)) continue;
    const current = entry.caseStudy?.slug ?? "";
    const blocked = (slug: string) =>
      reserved.has(slug) ||
      used.has(slug) ||
      published.some(
        (item) => item.slug === slug && item.projectId !== entry.id,
      );
    const slug =
      current && !blocked(current)
        ? current
        : nextFree(
            entry.title,
            new Set([
              ...used,
              ...reserved,
              ...published.map((item) => item.slug),
            ]),
          );
    result.set(entry.id, slug);
    used.add(slug);
  }
  return result;
}
