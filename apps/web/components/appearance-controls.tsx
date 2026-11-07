"use client";

import type { DraftDoc } from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { useId } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";

type Appearance = DraftDoc["appearance"];
const modes = [
  { id: "system", name: "System", note: "Follows each visitor's setting" },
  { id: "light", name: "Light", note: "Visitors can still switch" },
  { id: "dark", name: "Dark", note: "Visitors can still switch" },
] as const;

// Changes one saved appearance field through the shared draft controller.
// A custom color, when present, is kept; Phase 36 owns its controls.
export function setAppearance(
  controller: DraftController,
  change: Partial<Pick<Appearance, "themeId" | "fontId" | "colorMode">>,
): void {
  const draft = controller.store.getState().working;
  if (!draft) throw new Error("Open your draft before changing appearance.");
  controller.update({
    ...draft,
    appearance: { ...draft.appearance, ...change },
  });
}

function Choice({
  name,
  value,
  checked,
  disabled,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="appearance-choice">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {children}
    </label>
  );
}

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
  const change = (next: Parameters<typeof setAppearance>[1]) => {
    if (!disabled) setAppearance(controller, next);
  };
  const knownTheme = appearanceCatalog.themes.some(
    (theme) => theme.id === appearance?.themeId,
  );
  const knownFont = appearanceCatalog.fonts.some(
    (font) => font.id === appearance?.fontId,
  );
  return (
    <section aria-label="Customization" className="appearance-controls">
      <h2>Make it yours</h2>
      <p className="editor-muted">
        Your theme, font and starting mode apply to your portfolio, case studies
        and resume page. Your content and layout stay the same.
      </p>
      <fieldset>
        <legend>Theme</legend>
        {!knownTheme && (
          <p className="editor-input-note">
            Your saved theme is no longer available. Choose a theme.
          </p>
        )}
        {appearanceCatalog.themes.map((theme) => (
          <Choice
            key={theme.id}
            name={`${id}-theme`}
            value={theme.id}
            checked={appearance?.themeId === theme.id}
            disabled={disabled}
            onChange={() => change({ themeId: theme.id })}
          >
            <span className="appearance-swatches" aria-hidden="true">
              {[theme.light.page, theme.light.accent, theme.dark.page].map(
                (color, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: Fixed three-swatch order.
                    key={index}
                    className="appearance-swatch"
                    style={{ background: color }}
                  />
                ),
              )}
            </span>
            {theme.name}
          </Choice>
        ))}
      </fieldset>
      <fieldset>
        <legend>Font</legend>
        {!knownFont && (
          <p className="editor-input-note">
            Your saved font is no longer available. Choose a font.
          </p>
        )}
        {appearanceCatalog.fonts.map((font) => (
          <Choice
            key={font.id}
            name={`${id}-font`}
            value={font.id}
            checked={appearance?.fontId === font.id}
            disabled={disabled}
            onChange={() => change({ fontId: font.id })}
          >
            {font.name}
          </Choice>
        ))}
      </fieldset>
      <fieldset>
        <legend>Starting mode</legend>
        {modes.map((mode) => (
          <Choice
            key={mode.id}
            name={`${id}-mode`}
            value={mode.id}
            checked={appearance?.colorMode === mode.id}
            disabled={disabled}
            onChange={() => change({ colorMode: mode.id })}
          >
            {mode.name}
            <span className="editor-muted"> · {mode.note}</span>
          </Choice>
        ))}
      </fieldset>
      <p className="editor-muted">
        Custom color controls will be available with the appearance tools.
        Avatar decoration and Face Reveal are under Profile.
      </p>
    </section>
  );
}
