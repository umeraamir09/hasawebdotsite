// @vitest-environment jsdom
import type { DraftDoc } from "@hasaweb/schema";
import { generatePalette } from "@hasaweb/theme/palette";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { completeDraft } from "../../../packages/schema/src/fixtures.test-support";
import type { DraftController } from "../lib/draft/controller";
import { AppearanceControls, adjustmentLabel } from "./appearance-controls";

// jsdom has no FontFace; the tiles' faces load only in a browser.
vi.mock("../lib/editor/catalog-fonts", async (original) => ({
  ...(await original<typeof import("../lib/editor/catalog-fonts")>()),
  loadCatalogFont: () => {},
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function render(appearance: DraftDoc["appearance"]) {
  const draft = { ...completeDraft(), appearance };
  const store = createStore(() => ({
    working: draft,
    suspended: false,
    error: null as string | null,
  }));
  const update = vi.fn((next: DraftDoc) => store.setState({ working: next }));
  const controller = { store, update } as unknown as DraftController;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<AppearanceControls controller={controller} />));
  const saved = () => store.getState().working.appearance;
  return { host, update, saved };
}
const radio = (value: string) =>
  host?.querySelector<HTMLInputElement>(`input[type=radio][value="${value}"]`);
const setValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("Style panel", () => {
  const preset = {
    themeId: "violet",
    fontId: "lora",
    colorMode: "dark",
  } as const;

  it("offers the six presets, Custom and the three fonts", () => {
    const { host } = render(preset);
    expect(
      [...host.querySelectorAll<HTMLInputElement>("input[type=radio]")].map(
        (input) => input.value,
      ),
    ).toEqual([
      "leaf",
      "violet",
      "clay",
      "matcha",
      "strawberry",
      "coffee",
      "custom",
      "dm-sans",
      "manrope",
      "lora",
    ]);
    expect(radio("violet")?.checked).toBe(true);
    expect(host.querySelector("[aria-label='Custom color']")).toBeNull();
  });

  it("starts a custom color from the preset and resets to that preset", () => {
    const { host, saved } = render(preset);
    act(() => radio("custom")?.click());
    expect(saved()).toEqual({ ...preset, customColor: "#7934ad" });
    expect(radio("custom")?.checked).toBe(true);
    expect(radio("violet")?.checked).toBe(false);

    const hex = host.querySelector<HTMLInputElement>(
      "input[aria-label='Hex color']",
    );
    if (!hex) throw new Error("hex field");
    // A partial value stays local; a full one saves in lowercase.
    act(() => setValue(hex, "#285A"));
    expect(saved().customColor).toBe("#7934ad");
    expect(hex.getAttribute("aria-invalid")).toBe("true");
    act(() => setValue(hex, "285ACB"));
    expect(saved().customColor).toBe("#285acb");

    act(() =>
      host
        .querySelector<HTMLButtonElement>(
          "button[aria-label='Reset to Violet']",
        )
        ?.click(),
    );
    expect(saved()).toEqual(preset);
    expect(radio("violet")?.checked).toBe(true);
  });

  it("choosing a preset drops the custom color", () => {
    const { saved } = render({ ...preset, customColor: "#285acb" });
    act(() => radio("clay")?.click());
    expect(saved()).toEqual({ ...preset, themeId: "clay" });
  });

  it("shows the generated pair and names each automatic adjustment", () => {
    const { host } = render({ ...preset, customColor: "#ffff00" });
    const palette = generatePalette("#ffff00");
    expect(palette.adjustments.length).toBeGreaterThan(0);
    expect(
      [...host.querySelectorAll("[aria-label='Automatic adjustments'] li")].map(
        (item) => item.textContent,
      ),
    ).toEqual(palette.adjustments.map((a) => adjustmentLabel(a, palette)));
    expect(adjustmentLabel(palette.adjustments[0] as never, palette)).toBe(
      "Light accent darkened for contrast",
    );
  });

  it("changes the mode with the segmented control", () => {
    const { host, saved } = render(preset);
    const system = [
      ...host.querySelectorAll<HTMLButtonElement>("[role=radio]"),
    ].find((button) => button.textContent === "System");
    act(() => system?.click());
    expect(saved().colorMode).toBe("system");
  });
});
