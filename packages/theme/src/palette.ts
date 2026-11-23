import type { DraftDoc } from "@hasaweb/schema";
import { clampChroma, converter, formatHex, wcagContrast } from "culori";
import catalog from "../catalog.json";

export type Palette = (typeof catalog.themes)[number]["light"];
export type PaletteToken = keyof Palette;
export type PaletteMode = "light" | "dark";
export type PaletteAdjustment = {
  kind: "accent-lightness" | "gamut" | "contrast";
  mode: PaletteMode;
  tokens: PaletteToken[];
  message: string;
};
export type GeneratedPalette = {
  seed: string;
  light: Palette;
  dark: Palette;
  adjustments: PaletteAdjustment[];
};
export type PaletteSelection = Pick<
  DraftDoc["appearance"],
  "themeId" | "customColor"
>;
export type ResolvedPalette =
  | (GeneratedPalette & { source: "custom"; themeId: string })
  | {
      source: "preset";
      themeId: string;
      light: Palette;
      dark: Palette;
      adjustments: PaletteAdjustment[];
    };

const toOklch = converter("oklch");
const surfaces = ["page", "surface", "raised"] as const;

export function generatePalette(seed: string): GeneratedPalette {
  if (
    typeof seed !== "string" ||
    seed.length !== 7 ||
    !/^#[\da-f]{6}$/i.test(seed)
  )
    throw new TypeError("Choose an opaque six-digit hex color");
  const color = toOklch(seed);
  if (!color) throw new TypeError("Choose an opaque six-digit hex color");
  const hue = color.h ?? 0;
  const chroma = color.c < 0.00001 ? 0 : color.c;
  const seedLightness = color.l;
  const adjustments: PaletteAdjustment[] = [];

  function modePalette(mode: PaletteMode): Palette {
    const dark = mode === "dark";
    const gamut = new Set<PaletteToken>();
    const contrast = new Set<PaletteToken>();
    function tone(token: PaletteToken, l: number, c: number, h = hue) {
      const mapped = clampChroma({ mode: "oklch", l, c, h }, "oklch");
      if (mapped.c < c - 0.00001) gamut.add(token);
      return formatHex(mapped);
    }
    function readable(
      token: PaletteToken,
      l: number,
      c: number,
      backgrounds: string[],
      minimum: number,
      towardLight: boolean,
      h = hue,
    ) {
      let result = tone(token, l, c, h);
      for (
        let step = 1;
        backgrounds.some((bg) => wcagContrast(result, bg) < minimum);
        step++
      ) {
        contrast.add(token);
        const next = towardLight
          ? Math.min(1, l + step / 200)
          : Math.max(0, l - step / 200);
        result = tone(token, next, c, h);
        if (
          step >= 200 &&
          backgrounds.some((bg) => wcagContrast(result, bg) < minimum)
        )
          throw new Error("Palette contrast cannot be satisfied");
      }
      return result;
    }

    const surfaceChroma = Math.min(chroma * 0.12, 0.018);
    const surfaceTokens: Pick<Palette, "page" | "surface" | "raised"> = dark
      ? {
          page: tone("page", 0.16, surfaceChroma),
          surface: tone("surface", 0.2, surfaceChroma),
          raised: tone("raised", 0.25, surfaceChroma),
        }
      : {
          page: tone("page", 0.975, surfaceChroma),
          surface: tone("surface", 0.945, surfaceChroma),
          raised: tone("raised", 0.995, surfaceChroma),
        };
    const backgrounds = surfaces.map((token) => surfaceTokens[token]);
    const inkChroma = Math.min(chroma * 0.18, 0.025);
    const accentChroma = Math.min(chroma, 0.22);
    const accentL = dark
      ? Math.max(0.72, Math.min(0.88, seedLightness))
      : Math.max(0.35, Math.min(0.6, seedLightness));
    const onAccent = dark ? "#000000" : "#ffffff";
    const accent = readable(
      "accent",
      accentL,
      accentChroma,
      [onAccent],
      4.5,
      dark,
    );
    const actualAccent = toOklch(accent);
    if (!actualAccent) throw new Error("Generated accent is invalid");
    if (accent !== seed.toLowerCase())
      adjustments.push({
        kind: "accent-lightness",
        mode,
        tokens: ["accent", "hover", "pressed"],
        message: `The ${mode} button color differs from your chosen color so its label stays readable in every state.`,
      });
    const tokens: Palette = {
      ...surfaceTokens,
      text: readable(
        "text",
        dark ? 0.96 : 0.22,
        inkChroma,
        backgrounds,
        4.5,
        dark,
      ),
      muted: readable(
        "muted",
        dark ? 0.78 : 0.46,
        inkChroma,
        backgrounds,
        4.5,
        dark,
      ),
      accent,
      onAccent,
      link: readable(
        "link",
        dark ? 0.8 : 0.42,
        accentChroma,
        backgrounds,
        4.5,
        dark,
      ),
      control: readable(
        "control",
        dark ? 0.68 : 0.52,
        inkChroma,
        backgrounds,
        3,
        dark,
      ),
      border: tone("border", dark ? 0.34 : 0.87, surfaceChroma),
      hover: readable(
        "hover",
        Math.max(0, Math.min(1, actualAccent.l + (dark ? 0.04 : -0.04))),
        accentChroma,
        [onAccent],
        4.5,
        dark,
      ),
      pressed: readable(
        "pressed",
        Math.max(0, Math.min(1, actualAccent.l + (dark ? 0.08 : -0.08))),
        accentChroma,
        [onAccent],
        4.5,
        dark,
      ),
      focus: readable(
        "focus",
        dark ? 0.82 : 0.45,
        accentChroma,
        backgrounds,
        3,
        dark,
      ),
      error: readable(
        "error",
        dark ? 0.8 : 0.45,
        0.16,
        backgrounds,
        4.5,
        dark,
        25,
      ),
    };
    if (gamut.size)
      adjustments.push({
        kind: "gamut",
        mode,
        tokens: [...gamut],
        message: `Some ${mode} colors use less saturation to fit the sRGB color range while keeping their hue.`,
      });
    if (contrast.size)
      adjustments.push({
        kind: "contrast",
        mode,
        tokens: [...contrast],
        message: `Some ${mode} colors use adjusted lightness to meet text and control contrast requirements.`,
      });
    return tokens;
  }

  return {
    seed: seed.toLowerCase(),
    light: modePalette("light"),
    dark: modePalette("dark"),
    adjustments,
  };
}

export function resolvePalette({
  themeId,
  customColor,
}: PaletteSelection): ResolvedPalette {
  const theme = catalog.themes.find((entry) => entry.id === themeId);
  if (!theme) throw new TypeError("Choose an approved preset theme");
  if (customColor !== undefined)
    return {
      source: "custom",
      themeId,
      ...generatePalette(customColor),
    };
  return {
    source: "preset",
    themeId,
    light: { ...theme.light },
    dark: { ...theme.dark },
    adjustments: [],
  };
}

// The portfolio custom properties and the palette token behind each. The
// generated `themes.css` sets these for presets; a custom palette sets the
// `--pf-custom-{mode}-*` values that its rules read.
export const PORTFOLIO_TOKENS = {
  page: "page",
  surface: "surface",
  raised: "raised",
  ink: "text",
  muted: "muted",
  border: "border",
  control: "control",
  accent: "accent",
  link: "link",
  focus: "focus",
} as const satisfies Record<string, PaletteToken>;

/**
 * The custom properties a custom color sets on the document element, in a
 * fixed order. The preview sets them through the CSSOM; publication retains
 * them as a stylesheet from `customPaletteCss`.
 */
export function customPaletteProperties(seed: string): [string, string][] {
  const palette = generatePalette(seed);
  return (["light", "dark"] as const).flatMap((mode) =>
    Object.entries(PORTFOLIO_TOKENS).map(([name, token]): [string, string] => [
      `--pf-custom-${mode}-${name}`,
      palette[mode][token],
    ]),
  );
}

/** The retained stylesheet that delivers a custom palette to a published page. */
export function customPaletteCss(seed: string): string {
  return `:root{${customPaletteProperties(seed)
    .map(([name, value]) => `${name}:${value};`)
    .join("")}}\n`;
}
