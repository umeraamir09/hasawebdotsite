"use client";

import type { DraftDoc } from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import {
  type GeneratedPalette,
  generatePalette,
  type PaletteAdjustment,
} from "@hasaweb/theme/palette";
import { useEffect, useId, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import {
  catalogFontFamily,
  loadCatalogFont,
} from "../lib/editor/catalog-fonts";
import { Icon, IconButton, SegmentedControl } from "./workbench";
import "./style-panel.css";

type Appearance = DraftDoc["appearance"];
const HEX = /^#?([0-9a-f]{6})$/i;

// Replaces the saved appearance through the shared draft controller. Choosing
// a preset drops the custom color, which restores that preset's palette.
function saveAppearance(controller: DraftController, next: Appearance): void {
  const draft = controller.store.getState().working;
  if (!draft) throw new Error("Open your draft before changing appearance.");
  controller.update({ ...draft, appearance: next });
}
function withoutCustom(appearance: Appearance): Appearance {
  const { customColor: _, ...rest } = appearance;
  return rest;
}

/** Style (Figma 413:6305): theme, custom color, mode and font. */
export function AppearanceControls({
  controller,
  disabled: blocked = false,
}: {
  controller: DraftController;
  disabled?: boolean;
}) {
  const id = useId();
  const state = useStore(controller.store);
  const appearance = state.working?.appearance;
  const disabled =
    blocked ||
    !appearance ||
    state.suspended ||
    state.error === "owner_changed";
  useEffect(() => {
    for (const font of appearanceCatalog.fonts) loadCatalogFont(font);
  }, []);
  if (!appearance) return null;
  const save = (next: Appearance) => {
    if (!disabled) saveAppearance(controller, next);
  };
  const preset = appearanceCatalog.themes.find(
    (theme) => theme.id === appearance.themeId,
  );
  const custom = appearance.customColor;
  return (
    <div className="style-panel">
      <fieldset className="style-group" data-publication-field="themeId">
        <legend className="style-label">Theme</legend>
        {!preset && (
          <p className="style-note" role="status">
            Your saved theme is no longer available. Choose a theme.
          </p>
        )}
        <div className="style-themes">
          {appearanceCatalog.themes.map((theme) => (
            <label key={theme.id} className="style-tile">
              <input
                type="radio"
                className="style-choice-input"
                name={`${id}-theme`}
                value={theme.id}
                checked={!custom && appearance.themeId === theme.id}
                disabled={disabled}
                onChange={() =>
                  save({ ...withoutCustom(appearance), themeId: theme.id })
                }
              />
              <span
                className="style-swatch"
                aria-hidden="true"
                style={
                  {
                    "--swatch-page": theme.light.page,
                    "--swatch-text": theme.light.text,
                    "--swatch-accent": theme.light.accent,
                    "--swatch-raised": theme.light.raised,
                    "--swatch-border": theme.light.border,
                  } as React.CSSProperties
                }
              >
                <span className="style-swatch-type">Aa</span>
                <span className="style-swatch-bar" />
                <span className="style-swatch-dot" />
              </span>
              <span className="style-tile-name">{theme.name}</span>
            </label>
          ))}
          <label className="style-tile">
            <input
              type="radio"
              className="style-choice-input"
              name={`${id}-theme`}
              value="custom"
              checked={Boolean(custom)}
              disabled={disabled || !preset}
              onChange={() =>
                preset &&
                save({ ...appearance, customColor: preset.light.accent })
              }
            />
            <span
              className="style-swatch"
              data-custom=""
              aria-hidden="true"
              style={
                custom
                  ? ({ "--swatch-seed": custom } as React.CSSProperties)
                  : undefined
              }
            >
              <span className="style-swatch-ring" />
              <span className="style-swatch-check">
                <Icon name="check" size={12} />
              </span>
            </span>
            <span className="style-tile-name">Custom</span>
          </label>
        </div>
        {custom && (
          <CustomColor
            seed={custom}
            presetName={preset?.name ?? "preset"}
            disabled={disabled}
            onSeed={(seed) => save({ ...appearance, customColor: seed })}
            onReset={() => save(withoutCustom(appearance))}
          />
        )}
      </fieldset>
      <div className="style-group">
        <span className="style-label" aria-hidden="true">
          Mode
        </span>
        <SegmentedControl
          label="Mode"
          value={appearance.colorMode}
          onChange={(colorMode) => save({ ...appearance, colorMode })}
          options={[
            { value: "light", label: "Light", icon: "sun" },
            { value: "dark", label: "Dark", icon: "moon" },
            { value: "system", label: "System", icon: "monitor" },
          ]}
        />
      </div>
      <fieldset className="style-group" data-publication-field="fontId">
        <legend className="style-label">Font</legend>
        {!appearanceCatalog.fonts.some(
          (font) => font.id === appearance.fontId,
        ) && (
          <p className="style-note" role="status">
            Your saved font is no longer available. Choose a font.
          </p>
        )}
        <div className="style-fonts">
          {appearanceCatalog.fonts.map((font) => (
            <label key={font.id} className="style-font">
              <input
                type="radio"
                className="style-choice-input"
                name={`${id}-font`}
                value={font.id}
                checked={appearance.fontId === font.id}
                disabled={disabled}
                onChange={() => save({ ...appearance, fontId: font.id })}
              />
              <span
                className="style-font-sample"
                aria-hidden="true"
                style={{ fontFamily: catalogFontFamily(font) }}
              >
                Aa
              </span>
              <span className="style-tile-name">{font.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function CustomColor({
  seed,
  presetName,
  disabled,
  onSeed,
  onReset,
}: {
  seed: string;
  presetName: string;
  disabled: boolean;
  onSeed(seed: string): void;
  onReset(): void;
}) {
  const palette = useMemo(() => generatePalette(seed), [seed]);
  // The hex field keeps what the owner types until it is a full color.
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? seed.toUpperCase();
  const invalid = typed !== null && !HEX.test(typed);
  return (
    <fieldset className="style-custom" aria-label="Custom color">
      <div className="style-custom-seed">
        <span className="style-custom-picker" style={{ background: seed }}>
          <input
            type="color"
            aria-label="Pick a color"
            value={seed.toLowerCase()}
            disabled={disabled}
            onChange={(event) => {
              setTyped(null);
              onSeed(event.target.value);
            }}
          />
        </span>
        <input
          className="style-custom-hex"
          aria-label="Hex color"
          aria-invalid={invalid || undefined}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          maxLength={7}
          value={text}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            const match = HEX.exec(value.trim());
            setTyped(value);
            if (match) onSeed(`#${match[1]?.toLowerCase()}`);
          }}
          onBlur={() => setTyped(null)}
        />
        <IconButton
          icon="reset"
          label={`Reset to ${presetName}`}
          disabled={disabled}
          onClick={onReset}
        />
      </div>
      <div className="style-custom-modes">
        <ModeSample palette={palette} mode="light" />
        <ModeSample palette={palette} mode="dark" />
      </div>
      {palette.adjustments.length > 0 && (
        <ul
          className="style-custom-adjustments"
          aria-label="Automatic adjustments"
        >
          {palette.adjustments.map((adjustment) => (
            <li key={`${adjustment.mode}-${adjustment.kind}`}>
              <Icon name="check-circle" size={14} />
              {adjustmentLabel(adjustment, palette)}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

// The generated pair, drawn in its own colors (Figma 413:6437).
function ModeSample({
  palette,
  mode,
}: {
  palette: GeneratedPalette;
  mode: "light" | "dark";
}) {
  const tokens = palette[mode];
  return (
    <span
      className="style-custom-mode"
      style={
        {
          "--sample-page": tokens.page,
          "--sample-text": tokens.text,
          "--sample-muted": tokens.muted,
          "--sample-accent": tokens.accent,
          "--sample-on-accent": tokens.onAccent,
          "--sample-border": tokens.border,
        } as React.CSSProperties
      }
    >
      <span className="style-custom-mode-type" aria-hidden="true">
        Aa
      </span>
      <span className="style-custom-mode-name">
        {mode === "light" ? "Light" : "Dark"}
      </span>
      <span className="style-custom-mode-button" aria-hidden="true" />
    </span>
  );
}

const MODE_NAMES = { light: "Light", dark: "Dark" } as const;
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
// A short line for each automatic change, so the owner sees why the
// generated colors differ from the one they chose.
export function adjustmentLabel(
  adjustment: PaletteAdjustment,
  palette: GeneratedPalette,
): string {
  const mode = MODE_NAMES[adjustment.mode];
  if (adjustment.kind === "accent-lightness")
    return `${mode} accent ${
      luminance(palette[adjustment.mode].accent) > luminance(palette.seed)
        ? "lightened"
        : "darkened"
    } for contrast`;
  if (adjustment.kind === "gamut")
    return `${mode} colors softened to stay displayable`;
  return `${mode} text colors adjusted for contrast`;
}
