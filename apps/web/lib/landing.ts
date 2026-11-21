import manifest from "@hasaweb/components/static/manifest.json";
import type { ComponentType } from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";

// Phase 50 entry page content that must follow the product rather than drift
// from it: every optional component, and every approved theme, font and
// decoration, come from the registry and the appearance catalog.

export const EXAMPLE_URL = "https://example.hasaweb.site/";

/** One line per optional component; the type makes the list exhaustive. */
export const landingComponents = {
  projects: {
    name: "Projects",
    description: "Your work and your contribution, with optional case studies.",
  },
  skills: { name: "Skills", description: "The technologies you use." },
  github: {
    name: "GitHub activity",
    description: "Your public contributions, and private ones if you allow.",
  },
  "work-experience": {
    name: "Work experience",
    description: "Roles, organizations and dates.",
  },
  text: { name: "Text sections", description: "Anything else in your words." },
  "social-links": {
    name: "Social links",
    description: "Your profiles and website in one place.",
  },
  contact: {
    name: "Contact form",
    description: "Messages reach your inbox without showing your email.",
  },
  resume: {
    name: "Resume",
    description: "A PDF visitors can read at /resume or download.",
  },
} satisfies Record<ComponentType, { name: string; description: string }>;

export type PreviewMode = "light" | "dark";
export type PreviewChoice = {
  themeId: string;
  fontId: string;
  colorMode: PreviewMode | "system";
};

export const landingThemes = appearanceCatalog.themes.map(
  ({ id, name, light, dark }) => ({ id, name, light, dark }),
);
export const landingFonts = appearanceCatalog.fonts.map(({ id, name }) => ({
  id,
  name,
}));
export const landingDecorations = appearanceCatalog.decorations.map(
  ({ id, name }) => ({ id, name }),
);

/** The preview's custom properties: the theme's tokens for one mode. */
export function previewTokens(themeId: string, mode: PreviewMode) {
  const theme =
    landingThemes.find((candidate) => candidate.id === themeId) ??
    landingThemes[0];
  if (!theme) throw new Error("The appearance catalog has no themes");
  const tokens = theme[mode];
  return {
    "--pv-page": tokens.page,
    "--pv-surface": tokens.surface,
    "--pv-raised": tokens.raised,
    "--pv-text": tokens.text,
    "--pv-muted": tokens.muted,
    "--pv-accent": tokens.accent,
    "--pv-on-accent": tokens.onAccent,
    "--pv-link": tokens.link,
    "--pv-control": tokens.control,
    "--pv-border": tokens.border,
    "--pv-focus": tokens.focus,
  };
}

/** The family the preview uses for a font, loaded by `previewFontFaces`. */
export function previewFontFamily(fontId: string) {
  const font =
    appearanceCatalog.fonts.find((candidate) => candidate.id === fontId) ??
    appearanceCatalog.fonts[0];
  if (!font) throw new Error("The appearance catalog has no fonts");
  return `"Preview ${font.family}", ${font.fallback}`;
}

/**
 * `@font-face` rules for the approved fonts, from the same content-hashed
 * platform files published portfolios use (built into /portfolio-platform).
 */
export function previewFontFaces() {
  const files = manifest as Record<string, string>;
  return appearanceCatalog.fonts
    .map((font) => {
      const path = files[font.asset.split("/").at(-1) ?? ""];
      if (!path) throw new Error(`No platform file for ${font.id}`);
      return `@font-face{font-family:"Preview ${font.family}";src:url("${path}") format("truetype");font-weight:${font.weight[0]} ${font.weight[1]};font-style:normal;font-display:swap}`;
    })
    .join("\n");
}
