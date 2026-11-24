import { appearanceCatalog } from "@hasaweb/theme";
import { customPaletteProperties } from "@hasaweb/theme/palette";
import { z } from "zod";

// Saved appearance as the renderer displays it: the preset, font and initial
// mode, plus the custom color seed when the owner chose one. The selected
// avatar decoration is projected with the profile (see `displayDecoration`).
const ids = <T extends { id: string }>(items: readonly T[]) =>
  items.map((item) => item.id) as [string, ...string[]];
export const THEME_IDS = ids(appearanceCatalog.themes);
export const FONT_IDS = ids(appearanceCatalog.fonts);
export const DECORATION_IDS = ids(appearanceCatalog.decorations);
export const COLOR_MODES = ["light", "dark", "system"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const appearanceModelSchema = z.strictObject({
  themeId: z.enum(THEME_IDS),
  fontId: z.enum(FONT_IDS),
  colorMode: z.enum(COLOR_MODES),
  customColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .optional(),
});
export type AppearanceModel = z.infer<typeof appearanceModelSchema>;

// The shipped platform file name of an approved font, such as
// `lora-variable.ttf`. Publication retains only the saved font's file.
export function fontFileName(fontId: string): string | undefined {
  return appearanceCatalog.fonts
    .find((font) => font.id === fontId)
    ?.asset.split("/")
    .at(-1);
}
export const DEFAULT_APPEARANCE: AppearanceModel = appearanceModelSchema.parse(
  appearanceCatalog.defaults.appearance,
);

// Preview display only. Publication validation rejects unknown IDs with an
// owner correction, so a published page never takes this fallback.
export function displayAppearance(saved: {
  themeId: string;
  fontId: string;
  colorMode: string;
  customColor?: string | undefined;
}): AppearanceModel {
  const customColor = saved.customColor?.toLowerCase();
  return {
    ...(customColor && /^#[0-9a-f]{6}$/.test(customColor)
      ? { customColor }
      : {}),
    themeId: THEME_IDS.includes(saved.themeId)
      ? saved.themeId
      : DEFAULT_APPEARANCE.themeId,
    fontId: FONT_IDS.includes(saved.fontId)
      ? saved.fontId
      : DEFAULT_APPEARANCE.fontId,
    colorMode: (COLOR_MODES as readonly string[]).includes(saved.colorMode)
      ? (saved.colorMode as ColorMode)
      : DEFAULT_APPEARANCE.colorMode,
  };
}

// The document element attributes read by the generated theme CSS. They are
// present in the first HTML bytes, so presets, fonts and the owner's initial
// mode need no script before first paint. `data-custom-color` switches the
// theme rules to the `--pf-custom-*` properties, which a published page gets
// from its retained palette stylesheet.
export function appearanceAttributes(input: unknown): Record<string, string> {
  const appearance = appearanceModelSchema.parse(input);
  return {
    "data-theme": appearance.themeId,
    "data-font": appearance.fontId,
    "data-initial-mode": appearance.colorMode,
    ...(appearance.customColor
      ? { "data-custom-color": appearance.customColor }
      : {}),
  };
}

const CUSTOM_PROPERTIES = customPaletteProperties("#000000").map(
  ([name]) => name,
);
// The document element, typed structurally so Workers code without the DOM
// library can import this module.
type AppearanceTarget = Pick<
  HTMLElement,
  "setAttribute" | "removeAttribute"
> & {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): string;
    readonly length: number;
  };
};
// The preview applies a custom palette through the CSSOM, which the strict
// preview CSP allows: there is no style attribute or element in its markup.
export function applyAppearance(
  element: AppearanceTarget,
  appearance: AppearanceModel | undefined,
): void {
  const attributes = appearanceAttributes(appearance ?? DEFAULT_APPEARANCE);
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, value);
  const custom = appearance?.customColor;
  if (custom) {
    for (const [name, value] of customPaletteProperties(custom))
      element.style.setProperty(name, value);
  } else clearCustomPalette(element);
}
function clearCustomPalette(element: AppearanceTarget) {
  element.removeAttribute("data-custom-color");
  for (const name of CUSTOM_PROPERTIES) element.style.removeProperty(name);
  if (!element.style.length) element.removeAttribute("style");
}
export function clearAppearance(element: AppearanceTarget): void {
  for (const name of ["data-theme", "data-font", "data-initial-mode"])
    element.removeAttribute(name);
  clearCustomPalette(element);
}

// The avatar decoration as the renderer displays it. An absent selection is
// "none". The saved ID is opaque, so an unknown historical ID also shows no
// decoration in preview; publication validation rejects it with a correction.
// A unit test keeps this list equal to the approved catalog.
export const decorationModelSchema = z.enum(["none", "cat", "hands"]);
export type DecorationModel = z.infer<typeof decorationModelSchema>;
export function displayDecoration(saved: string | undefined): DecorationModel {
  return saved !== undefined && DECORATION_IDS.includes(saved)
    ? (saved as DecorationModel)
    : "none";
}
