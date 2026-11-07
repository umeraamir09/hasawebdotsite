import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appearanceCatalog from "../catalog.json";

// Parity between the approved catalog and the generated renderer platform
// files that both the editor preview and published pages load.
describe("renderer preset and font assets", () => {
  const root = new URL("../../../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root));

  it("applies the stored visitor mode before attaching controls", () => {
    const site = read("packages/components/src/site-entry.ts").toString();
    expect(site.indexOf("applyStoredMode(document)")).toBeGreaterThan(0);
    expect(site.indexOf("applyStoredMode(document)")).toBeLessThan(
      site.indexOf("DOMContentLoaded"),
    );
  });

  it("generates exact catalog tokens for all six presets in both modes", () => {
    const css = read("packages/components/static/themes.css").toString();
    expect(appearanceCatalog.themes.map((theme) => theme.id)).toEqual([
      "leaf",
      "violet",
      "clay",
      "matcha",
      "strawberry",
      "coffee",
    ]);
    const block = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf("}", start));
    };
    for (const theme of appearanceCatalog.themes) {
      const root = `:root[data-theme="${theme.id}"]`;
      const light = block(root);
      const dark = block(`${root}[data-color-mode="dark"]`);
      for (const [token, key] of [
        ["page", "page"],
        ["ink", "text"],
        ["muted", "muted"],
        ["link", "link"],
        ["focus", "focus"],
        ["control", "control"],
      ] as const) {
        expect(light).toContain(`--pf-${token}: ${theme.light[key]};`);
        expect(dark).toContain(`--pf-${token}: ${theme.dark[key]};`);
      }
      expect(css).toContain(
        `${root}[data-initial-mode="dark"]:not(\n  [data-color-mode="light"]\n)`,
      );
      expect(css).toMatch(
        new RegExp(
          `\\${root.replaceAll('"', '\\"').replaceAll("[", "\\[").replaceAll("]", "\\]")}:not\\(\\[data-color-mode="light"\\]\\):not\\(\\s*\\[data-initial-mode="light"\\]\\s*\\)`,
        ),
      );
    }
  });

  it("self-hosts each approved font with matching platform bytes", () => {
    const css = read("packages/components/static/themes.css").toString();
    const manifest: Record<string, string> = JSON.parse(
      read("packages/components/static/manifest.json").toString(),
    );
    for (const font of appearanceCatalog.fonts) {
      const file = font.asset.split("/").at(-1) as string;
      const shipped = read(`packages/components/static/${file}`);
      expect(createHash("sha256").update(shipped).digest("hex")).toBe(
        font.sha256,
      );
      expect(shipped.equals(read(`packages/theme/${font.asset}`))).toBe(true);
      expect(manifest[file]).toBe(
        `/portfolio-platform/${font.sha256.slice(0, 16)}-${file}`,
      );
      expect(css).toContain(`src: url("${manifest[file]}")`);
      expect(css).toContain(
        `:root[data-font="${font.id}"] {\n  font-family: "${font.family}", ${font.fallback};`,
      );
      expect(
        read(
          `packages/components/static/${font.id === "dm-sans" ? "OFL.txt" : `OFL-${font.id}.txt`}`,
        ).equals(read(`packages/theme/${font.license}`)),
      ).toBe(true);
    }
    expect(css).not.toMatch(/https?:\/\//);
  });
});
