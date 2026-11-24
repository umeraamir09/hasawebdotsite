import { converter, formatHex } from "culori";
import { describe, expect, it } from "vitest";
import { appearanceCatalog as catalog } from "./index";
import {
  customPaletteCss,
  customPaletteProperties,
  generatePalette,
  type Palette,
  PORTFOLIO_TOKENS,
  resolvePalette,
} from "./palette";

function luminance(hex: string) {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return channel(1) * 0.2126 + channel(3) * 0.7152 + channel(5) * 0.0722;
}

function contrast(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function checkPalette(palette: Palette, seed: string) {
  expect(Object.keys(palette).sort()).toEqual(
    Object.keys(catalog.themes[0]?.light ?? {}).sort(),
  );
  for (const value of Object.values(palette))
    expect(value).toMatch(/^#[0-9a-f]{6}$/);
  for (const background of ["page", "surface", "raised"] as const) {
    for (const foreground of ["text", "muted", "link", "error"] as const)
      expect(
        contrast(palette[foreground], palette[background]),
        `${seed} ${foreground}/${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    for (const foreground of ["control", "focus"] as const)
      expect(
        contrast(palette[foreground], palette[background]),
        `${seed} ${foreground}/${background}`,
      ).toBeGreaterThanOrEqual(3);
  }
  for (const background of ["accent", "hover", "pressed"] as const)
    expect(
      contrast(palette.onAccent, palette[background]),
      `${seed} onAccent/${background}`,
    ).toBeGreaterThanOrEqual(4.5);
}

describe("coordinated custom palettes", () => {
  it("meets the declared contrast pairs across an sRGB cube and hue/lightness/chroma sweep", () => {
    const seeds = new Set([
      "#000000",
      "#ffffff",
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#ffff00",
      "#00ffff",
      "#ff00ff",
      "#010101",
      "#fefefe",
      "#808080",
      "#bdeb70",
    ]);
    const levels = Array.from({ length: 17 }, (_, index) =>
      Math.min(255, index * 16),
    );
    for (const red of levels)
      for (const green of levels)
        for (const blue of levels)
          seeds.add(
            `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`,
          );
    for (let hue = 0; hue < 360; hue += 5)
      for (const l of [0.2, 0.5, 0.8])
        for (const c of [0.02, 0.15, 0.3])
          seeds.add(formatHex({ mode: "oklch", l, c, h: hue }));
    for (const seed of seeds) {
      const result = generatePalette(seed);
      checkPalette(result.light, `${seed} light`);
      checkPalette(result.dark, `${seed} dark`);
    }
  }, 60_000);

  it.each(["#000000", "#ffffff", "#808080", "#ff0000", "#0000ff", "#00ff00"])(
    "keeps every surface distinct and interaction states readable for %s",
    (seed) => {
      const result = generatePalette(seed);
      for (const mode of ["light", "dark"] as const) {
        const palette = result[mode];
        expect(
          new Set([palette.page, palette.surface, palette.raised]).size,
        ).toBe(3);
        expect(
          new Set([palette.accent, palette.hover, palette.pressed]).size,
        ).toBe(3);
        expect(luminance(result.light.page)).toBeGreaterThan(
          luminance(result.dark.page),
        );
      }
    },
  );

  it("normalizes seed case and returns deterministic independent values", () => {
    const first = generatePalette("#12aBcD");
    expect(first).toEqual(generatePalette("#12ABCD"));
    expect(first.seed).toBe("#12abcd");
    first.light.page = "#000000";
    expect(generatePalette("#12abcd").light.page).not.toBe("#000000");
  });

  it("coordinates hue without adding a hue to neutral seeds", () => {
    const oklch = converter("oklch");
    for (const seed of ["#bc3232", "#329c58", "#3265bc"]) {
      const hue = oklch(seed)?.h ?? 0;
      for (const palette of [
        generatePalette(seed).light,
        generatePalette(seed).dark,
      ]) {
        const accentHue = oklch(palette.accent)?.h ?? 0;
        const difference = Math.abs(accentHue - hue);
        expect(Math.min(difference, 360 - difference)).toBeLessThan(3);
      }
    }
    for (const mode of ["light", "dark"] as const)
      for (const token of [
        "page",
        "surface",
        "raised",
        "text",
        "accent",
        "link",
      ] as const) {
        const value = generatePalette("#808080")[mode][token];
        expect(value.slice(1, 3)).toBe(value.slice(3, 5));
        expect(value.slice(3, 5)).toBe(value.slice(5, 7));
      }
  });

  it("explains lightness and gamut adjustments without mutating the chosen seed", () => {
    const result = generatePalette("#ffff00");
    expect(result.seed).toBe("#ffff00");
    expect(result.adjustments.some((entry) => entry.kind === "gamut")).toBe(
      true,
    );
    for (const mode of ["light", "dark"] as const)
      expect(result.adjustments).toContainEqual(
        expect.objectContaining({ kind: "accent-lightness", mode }),
      );
    for (const entry of result.adjustments) {
      expect(entry.tokens.length).toBeGreaterThan(0);
      expect(entry.message).toContain(entry.mode);
      for (const token of entry.tokens)
        expect(token in result[entry.mode]).toBe(true);
    }
  });

  it.each([
    "red",
    "#fff",
    "#ffffffff",
    "#12345g",
    " #123456",
    "#123456\n",
    "rgb(1, 2, 3)",
    "transparent",
    "#fff;}</style><script>alert(1)</script>",
  ])("rejects unsupported seed input %j", (seed) => {
    expect(() => generatePalette(seed)).toThrow(TypeError);
  });

  it("resets to each exact approved preset when the custom color is removed", () => {
    const original = JSON.stringify(catalog);
    for (const theme of catalog.themes) {
      const custom = resolvePalette({
        themeId: theme.id,
        customColor: "#4285fa",
      });
      expect(custom.source).toBe("custom");
      expect(custom.light).toEqual(generatePalette("#4285fa").light);
      const reset = resolvePalette({ themeId: theme.id });
      expect(reset.source).toBe("preset");
      expect(reset.light).toEqual(theme.light);
      expect(reset.dark).toEqual(theme.dark);
      expect(reset.adjustments).toEqual([]);
      checkPalette(reset.light, `${theme.id} light`);
      checkPalette(reset.dark, `${theme.id} dark`);
      reset.light.page = "#000000";
    }
    expect(JSON.stringify(catalog)).toBe(original);
  });

  it("rejects unknown presets instead of silently replacing the selected theme", () => {
    expect(() => resolvePalette({ themeId: "unknown" })).toThrow(TypeError);
    expect(() =>
      resolvePalette({ themeId: "unknown", customColor: "#123456" }),
    ).toThrow(TypeError);
    expect(() => resolvePalette({ themeId: "leaf", customColor: "" })).toThrow(
      TypeError,
    );
  });

  it("delivers both generated modes as custom properties and a stylesheet", () => {
    const palette = generatePalette("#4285FA");
    const properties = customPaletteProperties("#4285FA");
    expect(properties).toHaveLength(Object.keys(PORTFOLIO_TOKENS).length * 2);
    for (const mode of ["light", "dark"] as const)
      for (const [name, token] of Object.entries(PORTFOLIO_TOKENS))
        expect(properties).toContainEqual([
          `--pf-custom-${mode}-${name}`,
          palette[mode][token],
        ]);
    const css = customPaletteCss("#4285fa");
    expect(css).toBe(
      `:root{${properties.map(([name, value]) => `${name}:${value};`).join("")}}\n`,
    );
    expect(css).toMatch(
      /^:root\{(--pf-custom-(light|dark)-[a-z]+:#[0-9a-f]{6};)+\}\n$/,
    );
    expect(() => customPaletteCss("red;}body{")).toThrow(TypeError);
  });
});
