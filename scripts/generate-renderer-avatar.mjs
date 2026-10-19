/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: Generated TSX needs literal template placeholders. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const assetSource = (name) =>
  name.endsWith(".ttf")
    ? `packages/theme/assets/fonts/dm-sans/${name}`
    : `apps/web/public/assets/${name}`;
const hashed = (name) =>
  `/portfolio-platform/${createHash("sha256")
    .update(readFileSync(assetSource(name)))
    .digest("hex")
    .slice(0, 16)}-${name}`;
const platformAssets = Object.fromEntries(
  [
    "avatar-ginger-cat-clean-loop.webp",
    "avatar-ginger-cat-clean-still.webp",
    "dm-sans-variable.ttf",
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
copyFileSync(
  assetSource("dm-sans-variable.ttf"),
  "packages/components/static/dm-sans-variable.ttf",
);
copyFileSync(
  "packages/theme/assets/fonts/dm-sans/OFL.txt",
  "packages/components/static/OFL.txt",
);

const catalog = JSON.parse(readFileSync("packages/theme/catalog.json", "utf8"));
const leaf = catalog.themes.find((theme) => theme.id === "leaf");
const tokens = (mode) =>
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
    .map(([name, key]) => `--${name}:${leaf[mode][key]};`)
    .join("");
writeFileSync(
  "packages/components/static/default-theme.css",
  `:root { color-scheme:light; ${tokens("light")} }\n@media (prefers-color-scheme:dark) { :root:not([data-color-mode="light"]) { color-scheme:dark; ${tokens("dark")} } }\n:root[data-color-mode="dark"] { color-scheme:dark; ${tokens("dark")} }\n`,
);
const stylesheet = readFileSync(
  "packages/components/static/portfolio.css",
  "utf8",
);
writeFileSync(
  "packages/components/static/portfolio.css",
  stylesheet.replace(
    /\/portfolio-platform\/(?:[a-f0-9]{16}-)?dm-sans-variable\.ttf/,
    platformAssets["dm-sans-variable.ttf"],
  ),
);

execFileSync(
  "node_modules/.bin/biome",
  [
    "check",
    "--write",
    "packages/components/src/avatar.tsx",
    "packages/components/static/avatar.css",
    "packages/components/static/default-theme.css",
    "packages/components/static/manifest.json",
  ],
  { stdio: "inherit" },
);
