// Builds the static files that the full-page preview shell loads from the web
// Worker's asset binding: the platform fonts and cat art under their hashed
// manifest paths (the generated stylesheet links them by those paths) and the
// preview client bundle. The outputs are git-ignored build products.
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const web = join(root, "apps/web");
const esbuild = createRequire(
  createRequire(import.meta.url).resolve("wrangler"),
)("esbuild");

export async function buildPreviewAssets() {
  const platform = join(web, "public/portfolio-platform");
  const app = join(web, "public/preview-assets");
  await rm(platform, { recursive: true, force: true });
  await rm(app, { recursive: true, force: true });
  await mkdir(platform, { recursive: true });
  await mkdir(app, { recursive: true });
  const manifest = JSON.parse(
    await readFile(
      join(root, "packages/components/static/manifest.json"),
      "utf8",
    ),
  );
  for (const [file, path] of Object.entries(manifest)) {
    if (!/^\/portfolio-platform\/[a-f0-9]{16}-[a-z0-9.-]+$/.test(path))
      throw new Error(`Unexpected platform path ${path}`);
    await copyFile(
      join(root, "packages/components/static", file),
      join(platform, basename(path)),
    );
  }
  await esbuild.build({
    entryPoints: { app: join(web, "lib/editor/full-preview-entry.ts") },
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    logLevel: "error",
    // The generated stylesheet links these by their hashed manifest paths.
    external: ["/portfolio-platform/*"],
    outdir: app,
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await buildPreviewAssets();
