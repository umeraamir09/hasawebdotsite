// @vitest-environment jsdom
import { customPaletteProperties } from "@hasaweb/theme/palette";
import { describe, expect, it } from "vitest";
import {
  applyAppearance,
  clearAppearance,
  DEFAULT_APPEARANCE,
  displayAppearance,
} from "./appearance";

describe("custom color appearance", () => {
  it("projects a valid seed in lowercase and drops an invalid one", () => {
    expect(
      displayAppearance({ ...DEFAULT_APPEARANCE, customColor: "#4285FA" }),
    ).toEqual({ ...DEFAULT_APPEARANCE, customColor: "#4285fa" });
    expect(
      displayAppearance({ ...DEFAULT_APPEARANCE, customColor: "#4285" }),
    ).toEqual(DEFAULT_APPEARANCE);
  });

  it("sets both generated modes on the document and clears them on reset", () => {
    const root = document.documentElement;
    applyAppearance(root, { ...DEFAULT_APPEARANCE, customColor: "#4285fa" });
    expect(root.getAttribute("data-custom-color")).toBe("#4285fa");
    const properties = customPaletteProperties("#4285fa");
    for (const [name, value] of properties)
      expect(root.style.getPropertyValue(name)).toBe(value);

    applyAppearance(root, DEFAULT_APPEARANCE);
    expect(root.hasAttribute("data-custom-color")).toBe(false);
    expect(root.hasAttribute("style")).toBe(false);
    expect(root.getAttribute("data-theme")).toBe(DEFAULT_APPEARANCE.themeId);

    applyAppearance(root, { ...DEFAULT_APPEARANCE, customColor: "#123abc" });
    clearAppearance(root);
    expect(root.getAttributeNames()).toEqual([]);
  });
});
