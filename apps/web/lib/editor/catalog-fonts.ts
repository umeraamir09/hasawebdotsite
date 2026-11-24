import platformFiles from "@hasaweb/components/static/manifest.json";
import { appearanceCatalog } from "@hasaweb/theme";

export type CatalogFont = (typeof appearanceCatalog.fonts)[number];

const family = (font: CatalogFont) => `hasaweb-font-${font.id}`;

/**
 * The portfolio's self-hosted face under an editor-only family name, for the
 * sharing card preview and the Style panel's font tiles. The editor's own
 * fonts stay Geist.
 */
export function catalogFontFamily(font: CatalogFont): string {
  return `"${family(font)}", ${font.fallback}`;
}

export function loadCatalogFont(font: CatalogFont): void {
  const file = font.asset.split("/").at(-1) ?? "";
  const path = (platformFiles as Record<string, string>)[file];
  if (!path || [...document.fonts].some((f) => f.family === family(font)))
    return;
  const face = new FontFace(family(font), `url(${path})`, {
    weight: `${font.weight[0]} ${font.weight[1]}`,
  });
  document.fonts.add(face);
  void face.load().catch(() => {});
}

export function findCatalogFont(fontId: string): CatalogFont | undefined {
  return appearanceCatalog.fonts.find((font) => font.id === fontId);
}
