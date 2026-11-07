import { appearanceCatalog } from "@hasaweb/theme";
import { z } from "zod";

// Saved preset appearance as the renderer displays it. Custom colors and
// decorations are separate later integrations and never reach this model.
const ids = <T extends { id: string }>(items: readonly T[]) =>
  items.map((item) => item.id) as [string, ...string[]];
export const THEME_IDS = ids(appearanceCatalog.themes);
export const FONT_IDS = ids(appearanceCatalog.fonts);
export const COLOR_MODES = ["light", "dark", "system"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const appearanceModelSchema = z.strictObject({
  themeId: z.enum(THEME_IDS),
  fontId: z.enum(FONT_IDS),
  colorMode: z.enum(COLOR_MODES),
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
}): AppearanceModel {
  return {
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
// mode need no script before first paint.
export function appearanceAttributes(input: unknown) {
  const appearance = appearanceModelSchema.parse(input);
  return {
    "data-theme": appearance.themeId,
    "data-font": appearance.fontId,
    "data-initial-mode": appearance.colorMode,
  } as const;
}

export function applyAppearance(
  element: HTMLElement,
  appearance: AppearanceModel | undefined,
): void {
  const attributes = appearanceAttributes(appearance ?? DEFAULT_APPEARANCE);
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, value);
}
export function clearAppearance(element: HTMLElement): void {
  for (const name of ["data-theme", "data-font", "data-initial-mode"])
    element.removeAttribute(name);
}
