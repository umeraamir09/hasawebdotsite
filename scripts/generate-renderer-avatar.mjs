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
  .replace(/<\/div>\s*$/, "</div>}");
const output = `/* biome-ignore-all lint/a11y/noSvgWithoutTitle: Source artwork is decorative and hidden from assistive technology. */
import { AssetImage } from "./asset";
import type { DisplayAsset } from "./model";
${classNames(helpers)}
export function PortfolioAvatar({ asset, decoration = "none" }: { asset: DisplayAsset; decoration?: "none" | "cat" | "hands" }) {
return <div className="pf-avatar-envelope"><div className="pf-avatar-slot"><div className="pf-avatar-frame" data-decoration={decoration}>
<div className="pf-avatar-portraitButton"><AssetImage asset={asset} kind="avatar" /></div>
${Object.entries(platformAssets).reduce((text, [name, url]) => text.replaceAll(`/assets/${name}`, url), classNames(art))}
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
