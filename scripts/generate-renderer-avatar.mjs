/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: Generated TSX needs literal template placeholders. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync("packages/theme/catalog.json", "utf8"));
const fontFile = (font) => font.asset.split("/").at(-1);
const assetSource = (name) => {
  const font = catalog.fonts.find((entry) => fontFile(entry) === name);
  return font
    ? `packages/theme/${font.asset}`
    : `apps/web/public/assets/${name}`;
};
const hashed = (name) =>
  `/portfolio-platform/${createHash("sha256")
    .update(readFileSync(assetSource(name)))
    .digest("hex")
    .slice(0, 16)}-${name}`;
const platformAssets = Object.fromEntries(
  [
    "avatar-ginger-cat-clean-loop.webp",
    "avatar-ginger-cat-clean-still.webp",
    ...catalog.fonts.map(fontFile),
  ].map((name) => [name, hashed(name)]),
);
writeFileSync(
  "packages/components/static/manifest.json",
  `${JSON.stringify(platformAssets, null, 2)}\n`,
);
const source = readFileSync("apps/web/components/profile-avatar.tsx", "utf8");
const classNames = (text) =>
  text
    .replace(/styles\.([A-Za-z]+)/g, '"pf-avatar-$1"')
    .replace(/styles\[pose\]/g, "`pf-avatar-${pose}`")
    .replace(/styles\[side\]/g, "`pf-avatar-${side}`")
    .replace(/styles\[position\]/g, "`pf-avatar-${position}`");
const helpers = source.slice(
  source.indexOf("type HandPose"),
  source.indexOf("export function ProfileAvatar"),
);
const art = source
  .slice(source.indexOf("      <picture"), source.lastIndexOf("    </div>"))
  .replace("<picture", '{decoration === "cat" && <picture')
  .replace("</picture>", "</picture>}")
  .replace(
    "<div\n        className={styles.decoration}",
    '{decoration === "hands" && <div\n        className={styles.decoration}',
  )
  .replace(/<\/div>\s*$/, "</div>}")
  // A still cat uses its still at every medium, as a paused one does.
  .replace(
    'media="(prefers-reduced-motion: reduce)"',
    'media={still ? "all" : "(prefers-reduced-motion: reduce)"}',
  );
const output = `/* biome-ignore-all lint/a11y/noSvgWithoutTitle: Source artwork is decorative and hidden from assistive technology. */
import { AssetImage } from "./asset";
import type { DisplayAsset } from "./model";
${classNames(helpers)}
// Phase 38: with Face Reveal the portrait is the source's native button with
// both owner images and the product labels; the shared platform script
// (site.ts) toggles it. A selected decoration adds the visitor pause/play
// control, which the script reveals unless reduced motion is requested.
// \`still\` draws the paused decoration with no control and no script, as the
// editor's decoration gallery shows it.
export function PortfolioAvatar({ asset, decoration = "none", faceReveal, still = false }: { asset: DisplayAsset; decoration?: "none" | "cat" | "hands"; faceReveal?: DisplayAsset | undefined; still?: boolean }) {
return <div className="pf-avatar-envelope"><div className="pf-avatar-slot"><div className="pf-avatar-frame" data-decoration={decoration} data-playback={decoration === "none" ? undefined : still ? "paused" : "playing"}>
{faceReveal ? <button type="button" className="pf-avatar-portraitButton" data-face-reveal="" data-photo="false" data-erasing="false" aria-label="Reveal face">
<AssetImage asset={asset} kind="avatar" className="pf-avatar-portrait pf-avatar-illustration" />
<AssetImage asset={faceReveal} kind="face" className="pf-avatar-portrait pf-avatar-photo" />
</button> : <div className="pf-avatar-portraitButton"><AssetImage asset={asset} kind="avatar" /></div>}
{faceReveal && <span className="pf-avatar-revealCue" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" focusable="false"><path d="M4 7.5h11l-3-3M16 12.5H5l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>}
${Object.entries(platformAssets).reduce((text, [name, url]) => text.replaceAll(`/assets/${name}`, url), classNames(art))}
{decoration !== "none" && !still && <button type="button" className="pf-avatar-playback" data-avatar-playback="" hidden><span className="pf-avatar-whenPlaying">Pause animation</span><span className="pf-avatar-whenPaused">Play animation</span></button>}
</div></div></div>;
}
`;
writeFileSync("packages/components/src/avatar.tsx", output);
const prefix = (css) => css.replace(/\.([A-Za-z][\w-]*)/g, ".pf-avatar-$1");
writeFileSync(
  "packages/components/static/avatar.css",
  `${prefix(readFileSync("apps/web/components/profile-avatar-slot.module.css", "utf8"))}\n${prefix(readFileSync("apps/web/components/profile-avatar.module.css", "utf8"))}\n.pf-avatar-portraitButton .pf-image { width:100%;height:100%;aspect-ratio:1; border:0; border-radius:0; }\n`,
);
mkdirSync("packages/components/static", { recursive: true });
for (const name of [
  "avatar-ginger-cat-clean-loop.webp",
  "avatar-ginger-cat-clean-still.webp",
])
  copyFileSync(
    `apps/web/public/assets/${name}`,
    `packages/components/static/${name}`,
  );
// Every approved font ships unmodified with its SIL OFL notice. DM Sans keeps
// the original OFL.txt name; the others are suffixed with their font ID.
for (const font of catalog.fonts) {
  copyFileSync(
    assetSource(fontFile(font)),
    `packages/components/static/${fontFile(font)}`,
  );
  copyFileSync(
    `packages/theme/${font.license}`,
    `packages/components/static/${font.id === "dm-sans" ? "OFL.txt" : `OFL-${font.id}.txt`}`,
  );
}

const tokens = (palette) =>
  Object.entries({
    "pf-page": "page",
    "pf-surface": "surface",
    "pf-raised": "raised",
    "pf-ink": "text",
    "pf-muted": "muted",
    "pf-border": "border",
    "pf-control": "control",
    "pf-accent": "accent",
    "pf-link": "link",
    "pf-focus": "focus",
  })
    .map(([name, key]) => `--${name}:${palette[key]};`)
    .join("");
// Attributes on <html>: data-theme and data-font select the saved preset and
// font, data-initial-mode is the owner's saved mode and data-color-mode is
// the visitor's choice. All but the last are in the server-rendered HTML.
// Dark applies for an explicit dark choice, an owner dark initial mode
// without an explicit light choice, or a dark system preference when neither
// the visitor nor the owner chose light. Leaf also covers a missing theme.
const themeRules = catalog.themes
  .map((theme) => {
    const roots =
      theme.id === catalog.defaults.appearance.themeId
        ? [":root", `:root[data-theme="${theme.id}"]`]
        : [`:root[data-theme="${theme.id}"]`];
    const scoped = (suffix) =>
      roots
        .map((root) =>
          root === ":root"
            ? `:root:not([data-theme])${suffix}`
            : `${root}${suffix}`,
        )
        .join(",");
    const dark = `color-scheme:dark;${tokens(theme.dark)}`;
    return [
      `${roots.join(",")} { color-scheme:light;${tokens(theme.light)} }`,
      `@media (prefers-color-scheme:dark) { ${scoped(':not([data-color-mode="light"]):not([data-initial-mode="light"])')} { ${dark} } }`,
      `${scoped('[data-initial-mode="dark"]:not([data-color-mode="light"])')} { ${dark} }`,
      `${scoped('[data-color-mode="dark"]')} { ${dark} }`,
    ].join("\n");
  })
  .join("\n");
// Each face downloads only when its family is used, so a page fetches just
// the saved font. The platform package retains all three.
const fontRules = catalog.fonts
  .map(
    (font) =>
      `@font-face { font-family:"${font.family}"; src:url("${platformAssets[fontFile(font)]}") format("truetype"); font-weight:${font.weight[0]} ${font.weight[1]}; font-style:${font.style}; font-display:swap; }\n:root[data-font="${font.id}"] { font-family:"${font.family}", ${font.fallback}; }`,
  )
  .join("\n");
writeFileSync(
  "packages/components/static/themes.css",
  `${fontRules}\n${themeRules}\n`,
);
execFileSync(
  "node_modules/.bin/biome",
  [
    "check",
    "--write",
    "packages/components/src/avatar.tsx",
    "packages/components/static/avatar.css",
    "packages/components/static/themes.css",
    "packages/components/static/manifest.json",
  ],
  { stdio: "inherit" },
);
