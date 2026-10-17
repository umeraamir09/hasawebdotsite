import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

const catalogUrl = new URL("../packages/theme/catalog.json", import.meta.url);
const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
const reviewUrl = new URL(
  "../specs/2026-10-17-appearance-catalog/review.html",
  import.meta.url,
);
const assetRoot = new URL("../packages/theme/", import.meta.url);
const assetPrefix = "../../packages/theme/";
const fonts = catalog.fonts
  .map(
    (font) =>
      `@font-face {font-family: '${font.family}'; font-weight: ${font.weight.join(" ")}; font-style: normal; font-display: swap; src: url('${assetPrefix}${font.asset}') format('truetype');}`,
  )
  .join("\n");
const template = await readFile(
  new URL("../packages/theme/review.template.html", import.meta.url),
  "utf8",
);
const html = template
  .replace("/* catalog-fonts */", fonts)
  .replace(
    "<!-- catalog-data -->",
    `<script type="application/json" id="catalog-data">${JSON.stringify(catalog).replaceAll("<", "\\u003c")}</script>`,
  );
await writeFile(reviewUrl, html);
console.log(`Catalog review written to ${reviewUrl.pathname}`);

if (process.argv.includes("--serve")) {
  const assets = new Map(
    catalog.fonts.map((entry) => [
      `/packages/theme/${entry.asset}`,
      entry.asset,
    ]),
  );
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const asset = assets.get(path);
    if (!["GET", "HEAD"].includes(request.method) || (path !== "/" && !asset)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = asset ? await readFile(new URL(asset, assetRoot)) : html;
      response.writeHead(200, {
        "Content-Type": asset
          ? asset.endsWith(".svg")
            ? "image/svg+xml"
            : "font/ttf"
          : "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(500).end();
    }
  });
  server.listen(8791, "127.0.0.1", () =>
    console.log("Review at http://127.0.0.1:8791"),
  );
}
