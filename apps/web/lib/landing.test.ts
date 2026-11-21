import { readFile } from "node:fs/promises";
import { componentRegistry } from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { describe, expect, it } from "vitest";
import {
  landingComponents,
  landingDecorations,
  landingFonts,
  landingThemes,
  previewFontFaces,
  previewFontFamily,
  previewTokens,
} from "./landing";

describe("entry page content", () => {
  it("names every optional component the editor offers", () => {
    expect(Object.keys(landingComponents).sort()).toEqual(
      Object.keys(componentRegistry).sort(),
    );
  });

  it("offers exactly the approved themes, fonts and decorations", () => {
    expect(landingThemes.map((theme) => theme.id)).toEqual(
      appearanceCatalog.themes.map((theme) => theme.id),
    );
    expect(landingFonts.map((font) => font.id)).toEqual(
      appearanceCatalog.fonts.map((font) => font.id),
    );
    expect(landingDecorations.map((decoration) => decoration.id)).toEqual(
      appearanceCatalog.decorations.map((decoration) => decoration.id),
    );
  });

  it("previews each theme and mode with the catalog's own tokens", () => {
    for (const theme of appearanceCatalog.themes)
      for (const mode of ["light", "dark"] as const) {
        const tokens = previewTokens(theme.id, mode);
        expect(tokens["--pv-page"]).toBe(theme[mode].page);
        expect(tokens["--pv-text"]).toBe(theme[mode].text);
        expect(tokens["--pv-accent"]).toBe(theme[mode].accent);
        expect(tokens["--pv-on-accent"]).toBe(theme[mode].onAccent);
        expect(tokens["--pv-link"]).toBe(theme[mode].link);
      }
  });

  it("loads each font from its content-hashed platform file", async () => {
    const manifest = JSON.parse(
      await readFile(
        new URL(
          "../../../packages/components/static/manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    const faces = previewFontFaces();
    for (const font of appearanceCatalog.fonts) {
      const file = manifest[font.asset.split("/").at(-1) ?? ""];
      expect(file).toMatch(/^\/portfolio-platform\/[a-f0-9]{16}-/);
      expect(faces).toContain(
        `font-family:"Preview ${font.family}";src:url("${file}")`,
      );
      expect(previewFontFamily(font.id)).toContain(font.fallback);
    }
  });
});
