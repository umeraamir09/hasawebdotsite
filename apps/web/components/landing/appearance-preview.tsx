// biome-ignore-all lint/performance/noImgElement: Static example images; Cloudflare image optimization is disabled.
"use client";

import {
  type CSSProperties,
  useId,
  useState,
  useSyncExternalStore,
} from "react";
import {
  landingFonts,
  landingThemes,
  type PreviewChoice,
  previewFontFamily,
  previewTokens,
} from "../../lib/landing";

const DARK = "(prefers-color-scheme: dark)";
function subscribe(change: () => void) {
  const query = window.matchMedia(DARK);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

// "Make it feel like you": the example profile in any approved theme, font
// and starting mode, using the catalog's exact tokens. System follows the
// visitor's own preference, as it does on a published portfolio.
export function AppearancePreview() {
  const id = useId();
  const [choice, setChoice] = useState<PreviewChoice>({
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  });
  const prefersDark = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DARK).matches,
    () => false,
  );
  const mode =
    choice.colorMode === "system"
      ? prefersDark
        ? "dark"
        : "light"
      : choice.colorMode;
  const style = {
    ...previewTokens(choice.themeId, mode),
    fontFamily: previewFontFamily(choice.fontId),
  } as CSSProperties;
  const select = (
    key: keyof PreviewChoice,
    label: string,
    options: readonly { id: string; name: string }[],
  ) => (
    <div className="appearance-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <select
        id={`${id}-${key}`}
        value={choice[key]}
        onChange={(event) =>
          setChoice((current) => ({ ...current, [key]: event.target.value }))
        }
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <>
      <div className="appearance-controls">
        {select("themeId", "Theme", landingThemes)}
        {select("fontId", "Font", landingFonts)}
        {select("colorMode", "Initial mode", [
          { id: "system", name: "System" },
          { id: "light", name: "Light" },
          { id: "dark", name: "Dark" },
        ])}
      </div>
      <section
        className="appearance-preview"
        style={style}
        data-mode={mode}
        aria-label="Example profile in the selected appearance"
      >
        <p className="sr-only" role="status">
          Showing {landingThemes.find((t) => t.id === choice.themeId)?.name},{" "}
          {landingFonts.find((f) => f.id === choice.fontId)?.name}, {mode} mode
        </p>
        <div className="preview-banner">
          <img src="/landing/example/banner.webp" alt="" />
        </div>
        <div className="preview-head">
          <img
            className="preview-avatar"
            src="/landing/example/avatar.webp"
            alt=""
            width="212"
            height="220"
          />
          <span className="preview-action">Let&rsquo;s talk →</span>
        </div>
        <div className="preview-body">
          <p className="preview-name">Umer Aamir</p>
          <ul className="preview-links" aria-label="Profile links">
            <li>@umeraamir09</li>
            <li>@umrooGRR</li>
          </ul>
          <p className="preview-bio">
            I build thoughtful web experiences, draw playful things, and make
            technology feel a little more human. Usually exploring the space
            between design, code, and self-hosting.
          </p>
          <p className="preview-location">Pakistan</p>
        </div>
      </section>
    </>
  );
}
