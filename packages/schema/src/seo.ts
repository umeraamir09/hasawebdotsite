import type { DraftDoc } from "./draft";

// Owner overrides are bounded to what search results and sharing cards show.
// Derived defaults are clipped to the same lengths, so an override and a
// default are never treated differently downstream.
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 160;

export type SeoSource = {
  profile: Pick<DraftDoc["profile"], "name" | "bio">;
  seo: DraftDoc["seo"];
};
// The owner's uploaded sharing image, or the profile card that Publish
// generates from the banner, avatar, decoration, bio and profile links.
export type SharingImage =
  | { kind: "upload"; assetId: string; alt: string }
  | { kind: "card"; alt: string };
export type ResolvedSeo = {
  title: string;
  description: string;
  image: SharingImage;
  // The name used in page-specific titles.
  identity: string;
  overridden: { title: boolean; description: boolean; image: boolean };
};
export type SeoPage =
  | { kind: "home" }
  | { kind: "case-study"; projectTitle: string }
  | { kind: "resume" };

const FALLBACK_TITLE = "Portfolio";

/**
 * Collapses whitespace, line breaks and control characters into single
 * spaces. Metadata is one line of plain text.
 */
export function normalizeSeoText(value: string | undefined): string {
  return (value ?? "").replace(/[\s\p{Cc}]+/gu, " ").trim();
}

/**
 * Shortens text to `max` code points, ending on a word boundary with an
 * ellipsis. A single word longer than the limit is cut inside the word.
 */
export function clipSeoText(value: string, max: number): string {
  const text = normalizeSeoText(value);
  const points = Array.from(text);
  if (points.length <= max) return text;
  const head = points.slice(0, max - 1).join("");
  const space = head.lastIndexOf(" ");
  const cut = space > max / 2 ? head.slice(0, space) : head;
  return `${cut.replace(/[\s,;:.–—-]+$/u, "")}…`;
}

/**
 * The one rule for search and sharing values, shared by the editor's sharing
 * preview and the publish step. Empty overrides fall back to the profile:
 * title to the name, description to the bio, image to the generated card.
 */
export function resolveSeo({ profile, seo }: SeoSource): ResolvedSeo {
  const name = clipSeoText(profile.name, SEO_TITLE_MAX);
  const title = normalizeSeoText(seo.title);
  const description = normalizeSeoText(seo.description);
  const resolvedTitle = title
    ? clipSeoText(title, SEO_TITLE_MAX)
    : name || FALLBACK_TITLE;
  const identity = name || resolvedTitle;
  const image: SharingImage = seo.ogImage
    ? { kind: "upload", assetId: seo.ogImage.assetId, alt: "" }
    : { kind: "card", alt: `${identity}'s portfolio profile` };
  return {
    title: resolvedTitle,
    description: description
      ? clipSeoText(description, SEO_DESCRIPTION_MAX)
      : clipSeoText(profile.bio, SEO_DESCRIPTION_MAX),
    image,
    identity,
    overridden: {
      title: Boolean(title),
      description: Boolean(description),
      image: Boolean(seo.ogImage),
    },
  };
}

/** Case studies and the resume keep the portfolio's identity in the title. */
export function seoPageTitle(resolved: ResolvedSeo, page: SeoPage): string {
  if (page.kind === "home") return resolved.title;
  const label =
    page.kind === "resume"
      ? "Resume"
      : clipSeoText(page.projectTitle, SEO_TITLE_MAX) || "Untitled project";
  return `${label} · ${resolved.identity}`;
}
