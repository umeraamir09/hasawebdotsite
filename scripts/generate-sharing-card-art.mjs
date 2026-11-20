// Captures one still of each avatar decoration for the generated sharing
// card. Chromium renders the real PortfolioAvatar markup with the platform
// CSS, hides the portrait, pauses every animation at its start and
// screenshots the decoration alone on a
// transparent background. The geometry records where that image sits relative
// to the portrait's center at the desktop portrait size, so the card can
// place it at any portrait size. Run `pnpm generate:sharing-card-art` after
// changing decoration art or avatar CSS; the outputs are committed.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
// The cat loop starts almost hidden below the portrait (frames 0-5); frame 6
// is the first where it wraps the portrait, ears and eyes over the top edge.
const CAT_FRAME = 6;
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("wrangler"))("esbuild");
const staticDir = join(root, "packages/components/static");
const manifest = JSON.parse(
  await readFile(join(staticDir, "manifest.json"), "utf8"),
);
const platform = new Map(
  Object.entries(manifest).map(([file, path]) => [path, file]),
);

const scratch = await mkdtemp(join(tmpdir(), "sharing-card-art-"));
const markupFile = join(scratch, "markup.cjs");
await esbuild.build({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { PortfolioAvatar } from "./src/avatar";
      export const markup = (decoration) =>
        renderToStaticMarkup(
          createElement(PortfolioAvatar, {
            asset: { state: "ready", url: "/blank.png", alt: "" },
            decoration,
          }),
        );`,
    loader: "tsx",
    // React resolves from the package that depends on it.
    resolveDir: join(root, "packages/components"),
  },
  bundle: true,
  outfile: markupFile,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  logLevel: "error",
});
const { markup } = require(markupFile);
const css = (
  await esbuild.build({
    entryPoints: [join(staticDir, "portfolio.css")],
    bundle: true,
    write: false,
    logLevel: "error",
    external: ["/portfolio-platform/*"],
  })
).outputFiles[0].contents;
// A 1x1 transparent PNG stands in for the hidden portrait.
const blank = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const page = (decoration) =>
  `<!doctype html><html lang="en" data-theme="leaf" data-font="dm-sans" data-initial-mode="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/portfolio.css"><style>html,body{background:transparent!important}body{margin:0;padding:240px}.pf-avatar-portraitButton{visibility:hidden}.pf-avatar-playback{display:none!important}</style></head><body><div class="pf-profile" style="background:transparent;border:0">${markup(decoration)}</div></body></html>`;
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const send = (type, body) => {
    response.writeHead(200, { "Content-Type": type });
    response.end(body);
  };
  if (url.pathname === "/portfolio.css") return send("text/css", css);
  if (url.pathname === "/blank.png") return send("image/png", blank);
  if (url.pathname.startsWith("/page/"))
    return send("text/html", page(url.pathname.slice(6)));
  const file = platform.get(url.pathname);
  if (file)
    return send(
      file.endsWith(".ttf") ? "font/ttf" : "image/webp",
      await readFile(join(staticDir, file)),
    );
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const geometry = {};
try {
  for (const decoration of ["cat", "hands"]) {
    const tab = await browser.newPage({
      viewport: { width: 900, height: 900 },
      deviceScaleFactor: 3,
    });
    await tab.goto(`${origin}/page/${decoration}`);
    await tab.evaluate(() => document.fonts.ready);
    const box = await tab.evaluate(
      async ([decoration, catFrame]) => {
        if (decoration === "cat") {
          // One decoded frame of the loop replaces the animation.
          const picture = document.querySelector(".pf-avatar-catDecoration");
          const img = picture.querySelector("img");
          for (const source of picture.querySelectorAll("source"))
            source.remove();
          const response = await fetch(img.currentSrc || img.src);
          const decoder = new ImageDecoder({
            data: response.body,
            type: "image/webp",
          });
          const { image } = await decoder.decode({ frameIndex: catFrame });
          const canvas = document.createElement("canvas");
          canvas.width = image.displayWidth;
          canvas.height = image.displayHeight;
          canvas.getContext("2d").drawImage(image, 0, 0);
          img.src = canvas.toDataURL("image/png");
          await img.decode();
        }
        for (const animation of document.getAnimations()) {
          animation.pause();
          animation.currentTime = 0;
        }
        const rect = (element) => element.getBoundingClientRect();
        const portrait = rect(
          document.querySelector(".pf-avatar-portraitButton"),
        );
        const layer = document.querySelector(
          decoration === "cat"
            ? ".pf-avatar-catDecoration"
            : ".pf-avatar-decoration",
        );
        let [left, top, right, bottom] = [
          Infinity,
          Infinity,
          -Infinity,
          -Infinity,
        ];
        for (const element of [layer, ...layer.querySelectorAll("*")]) {
          const r = rect(element);
          if (!r.width || !r.height) continue;
          left = Math.min(left, r.left);
          top = Math.min(top, r.top);
          right = Math.max(right, r.right);
          bottom = Math.max(bottom, r.bottom);
        }
        [left, top] = [Math.floor(left), Math.floor(top)];
        [right, bottom] = [Math.ceil(right), Math.ceil(bottom)];
        return {
          clip: { x: left, y: top, width: right - left, height: bottom - top },
          portrait: {
            x: portrait.left,
            y: portrait.top,
            size: portrait.width,
          },
        };
      },
      [decoration, CAT_FRAME],
    );
    const file = `sharing-card-${decoration}.png`;
    const png = await tab.screenshot({ clip: box.clip, omitBackground: true });
    await writeFile(join(staticDir, file), png);
    const centerX = box.portrait.x + box.portrait.size / 2;
    const centerY = box.portrait.y + box.portrait.size / 2;
    const round = (value) => Math.round(value * 100) / 100;
    const sha256 = createHash("sha256").update(png).digest("hex");
    geometry[decoration] = {
      file,
      // Served beside the other platform files by the web Worker (editor
      // preview) and read by publication from the platform build.
      path: `/portfolio-platform/${sha256.slice(0, 16)}-${file}`,
      sha256,
      // CSS pixels at the desktop portrait size, relative to its center.
      portraitSize: round(box.portrait.size),
      x: round(box.clip.x - centerX),
      y: round(box.clip.y - centerY),
      width: box.clip.width,
      height: box.clip.height,
    };
    await tab.close();
  }
} finally {
  await browser.close();
  server.close();
  await rm(scratch, { recursive: true, force: true });
}
await writeFile(
  join(staticDir, "sharing-card-art.json"),
  `${JSON.stringify(geometry, null, 2)}\n`,
);
console.log(geometry);
