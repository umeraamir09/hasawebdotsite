import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const esbuild = createRequire(
  createRequire(import.meta.url).resolve("wrangler"),
)("esbuild");

export async function buildPublicationPlatform(directory) {
  const files = [];
  async function retain(bytes, suffix, contentType, role, path) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    path ??= `/platform/${sha256}.${suffix}`;
    await mkdir(join(directory, path, ".."), { recursive: true });
    await writeFile(join(directory, path), bytes);
    files.push({ path, bytes: bytes.length, sha256, contentType, role });
  }
  const manifest = JSON.parse(
    await readFile(
      join(root, "packages/components/static/manifest.json"),
      "utf8",
    ),
  );
  for (const [file, path] of Object.entries(manifest)) {
    const font = file.endsWith(".ttf");
    await retain(
      await readFile(join(root, "packages/components/static", file)),
      font ? "ttf" : "webp",
      font ? "font/ttf" : "image/webp",
      font ? "font" : "cat",
      path,
    );
  }
  // Sharing-card decoration stills. Publication reads them from the platform
  // build to draw the card; they are not page dependencies, so they stay out
  // of the retained platform pack.
  const art = JSON.parse(
    await readFile(
      join(root, "packages/components/static/sharing-card-art.json"),
      "utf8",
    ),
  );
  for (const { file, path } of Object.values(art)) {
    await mkdir(join(directory, path, ".."), { recursive: true });
    await writeFile(
      join(directory, path),
      await readFile(join(root, "packages/components/static", file)),
    );
  }
  const css = await esbuild.build({
    entryPoints: [join(root, "packages/components/static/portfolio.css")],
    bundle: true,
    write: false,
    logLevel: "error",
    external: ["/portfolio-platform/*"],
  });
  await retain(
    css.outputFiles[0].contents,
    "css",
    "text/css; charset=utf-8",
    "css",
  );
  const script = await esbuild.build({
    entryPoints: [join(root, "packages/components/src/site-entry.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2022",
    minify: true,
    logLevel: "error",
  });
  await retain(
    script.outputFiles[0].contents,
    "js",
    "text/javascript; charset=utf-8",
    "script",
  );
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ files }));
  return { files };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildPublicationPlatform(join(root, "apps/jobs/dist/platform"));
}
