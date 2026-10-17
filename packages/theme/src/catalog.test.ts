import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createEmptyDraft, draftSchema } from "@hasaweb/schema";
import { describe, expect, it } from "vitest";
import { appearanceCatalog as catalog } from "./index";

const root = new URL("../", import.meta.url);
function readAsset(path: string) {
  expect(path).toMatch(/^assets\/[a-z0-9/.-]+$/i);
  expect(path.split("/")).not.toContain("..");
  return readFileSync(new URL(path, root));
}
function luminance(hex: string) {
  const rgb = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (
    (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722
  );
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe("approved appearance catalog", () => {
  it("keeps approval explicit, six presets, unique stable IDs and one template", () => {
    expect(catalog.status).toBe("approved");
    expect(catalog.approval).toEqual(
      expect.objectContaining({
        approvedAt: "2026-10-17",
        approvedBy: "owner",
        phase: "11E",
        generatorExceptionAccepted: true,
      }),
    );
    expect(catalog.version).toBe(1);
    expect(catalog.themes.map((theme) => theme.id)).toEqual([
      "leaf",
      "violet",
      "clay",
      "matcha",
      "strawberry",
      "coffee",
    ]);
    expect(catalog.defaults.templateId).toBe(catalog.template.id);
    for (const entries of [
      catalog.themes,
      catalog.fonts,
      catalog.decorations,
    ]) {
      expect(new Set(entries.map((entry) => entry.id)).size).toBe(
        entries.length,
      );
      for (const entry of entries)
        expect(entry.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    expect(
      catalog.themes.some(
        (theme) => theme.id === catalog.defaults.appearance.themeId,
      ),
    ).toBe(true);
    expect(
      catalog.fonts.some(
        (font) => font.id === catalog.defaults.appearance.fontId,
      ),
    ).toBe(true);
  });

  it("preserves the reference-derived Figma palettes without token drift", () => {
    const snapshot = JSON.parse(
      readFileSync(
        new URL(
          "../../../specs/2026-10-17-appearance-catalog/figma-palettes.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      themes: {
        id: string;
        nodeId: string;
        collectionId: string;
        light: Record<string, string>;
        dark: Record<string, string>;
      }[];
    };
    expect(snapshot.themes.map((theme) => theme.id)).toEqual([
      "matcha",
      "strawberry",
      "coffee",
    ]);
    for (const reference of snapshot.themes) {
      const theme = catalog.themes.find((theme) => theme.id === reference.id);
      expect(theme?.light).toEqual(reference.light);
      expect(theme?.dark).toEqual(reference.dark);
      expect(theme?.sourceNodes).toContain(reference.nodeId);
      expect(theme?.sourceCollection).toBe(reference.collectionId);
    }
  });

  it("defines schema-compatible empty drafts for every font, theme and mode", () => {
    for (const theme of catalog.themes) {
      for (const font of catalog.fonts) {
        for (const colorMode of ["light", "dark", "system"] as const) {
          const draft = createEmptyDraft({
            themeId: theme.id,
            fontId: font.id,
            colorMode,
          });
          expect(draftSchema.safeParse(draft).success).toBe(true);
          expect(draft.profile).toEqual({
            name: "",
            bio: "",
            faceReveal: { enabled: false },
          });
          expect(draft.components).toEqual([]);
          expect(draft.links).toEqual([]);
          expect(draft.samples).toEqual({});
          for (const decoration of catalog.decorations) {
            expect(
              draftSchema.safeParse({
                ...draft,
                profile: { ...draft.profile, decorationId: decoration.id },
              }).success,
            ).toBe(true);
          }
        }
      }
    }
    expect(catalog.defaults.appearance).toEqual({
      themeId: "leaf",
      fontId: "dm-sans",
      colorMode: "system",
    });
    expect(catalog.defaults.faceRevealEnabled).toBe(false);
    expect(catalog.defaults).not.toHaveProperty("decorationId");
  });

  for (const entry of catalog.fonts) {
    it(`pins the actual ${entry.asset} bytes`, () => {
      const bytes = readAsset(entry.asset);
      expect(bytes.length).toBeGreaterThan(0);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        entry.sha256,
      );
    });
  }
  for (const font of catalog.fonts) {
    it(`ships ${font.name} as a licensed variable font`, () => {
      const bytes = readAsset(font.asset);
      expect(bytes.readUInt32BE(0)).toBe(0x00010000);
      const tags = Array.from({ length: bytes.readUInt16BE(4) }, (_, index) =>
        bytes.toString("ascii", 12 + index * 16, 16 + index * 16),
      );
      expect(tags).toContain("fvar");
      expect(readAsset(font.license).toString()).toContain(
        "SIL OPEN FONT LICENSE Version 1.1",
      );
      expect(font.fallback.length).toBeGreaterThan(0);
    });
  }
  it("records both imported decoration implementations and their actual files", () => {
    expect(catalog.decorations.map((entry) => entry.id)).toEqual([
      "cat",
      "hands",
    ]);
    const repository = new URL("../../../", import.meta.url);
    const digest = (path: string) =>
      createHash("sha256")
        .update(readFileSync(new URL(path, repository)))
        .digest("hex");
    for (const decoration of catalog.decorations) {
      expect(decoration.variant).toBe(decoration.id);
      expect(decoration.component).toBe("ProfileAvatar");
      if (decoration.implementation === "animated-webp") {
        expect(digest(decoration.asset as string)).toBe(decoration.sha256);
        expect(digest(decoration.stillAsset as string)).toBe(
          decoration.stillSha256,
        );
        expect(decoration.frames).toBe(32);
        expect(decoration.loop).toBe(0);
      } else {
        expect(decoration.implementation).toBe("svg-css");
        expect(digest(decoration.componentAsset as string)).toBe(
          decoration.componentSha256,
        );
        expect(digest(decoration.styleAsset as string)).toBe(
          decoration.styleSha256,
        );
        expect(decoration.durationMs).toBe(6000);
      }
    }
  });
  for (const theme of catalog.themes) {
    for (const mode of ["light", "dark"] as const) {
      it(`${theme.name} ${mode} passes all declared text and control contrast pairs`, () => {
        const tokens = theme[mode];
        for (const value of Object.values(tokens))
          expect(value).toMatch(/^#[0-9a-f]{6}$/);
        for (const background of ["page", "surface", "raised"] as const) {
          for (const foreground of [
            "text",
            "muted",
            "link",
            "error",
          ] as const) {
            expect(
              contrast(tokens[foreground], tokens[background]),
              `${foreground}/${background}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
          for (const foreground of ["control", "focus"] as const) {
            expect(
              contrast(tokens[foreground], tokens[background]),
              `${foreground}/${background}`,
            ).toBeGreaterThanOrEqual(3);
          }
        }
        for (const background of ["accent", "hover", "pressed"] as const) {
          expect(
            contrast(tokens.onAccent, tokens[background]),
            `onAccent/${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});
