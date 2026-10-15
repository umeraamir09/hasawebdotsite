import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

const origin =
  process.argv[2] ?? "https://hasaweb-s2-spike.umerthepro2009.workers.dev";
assert.ok(
  [
    "https://hasaweb.site",
    "https://hasaweb-s2-spike.umerthepro2009.workers.dev",
  ].includes(origin),
);
const output = ".wrangler/routing-production";
await mkdir(output, { recursive: true });
const observations = [];
async function request(path, label, status = 200) {
  const at = Date.now();
  const response = await fetch(`${origin}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  observations.push({
    case: label,
    url: `${origin}${path}`,
    at,
    status: response.status,
    bytes: Buffer.byteLength(body),
    ray: response.headers.get("cf-ray"),
    cacheStatus: response.headers.get("cf-cache-status"),
    etag: response.headers.get("etag"),
    age: response.headers.get("age"),
  });
  assert.equal(response.status, status, `${label} ${path}`);
  return body;
}
const html = await request("/", "discovery");
const assets = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(
      (match) => match[1].replaceAll("&amp;", "&"),
    ),
  ),
].filter((path) => path.startsWith("/"));
assert.ok(
  assets.length > 0,
  "Rendered OpenNext app must name real build assets",
);
const windows = [];
async function window(name, run) {
  await setTimeout(3000);
  const from = new Date().toISOString();
  const index = observations.length;
  await run();
  await setTimeout(2000);
  windows.push({
    name,
    from,
    to: new Date().toISOString(),
    clientRequests: observations.length - index,
  });
  console.log(JSON.stringify(windows.at(-1)));
}
await window("dynamic-before", async () => {
  for (let i = 0; i < 20; i++) await request("/api/health", "dynamic-before");
});
await window("static-only", async () => {
  for (let i = 0; i < 100; i++) await request(assets[0], "static-only");
});
await window("static-missing", async () => {
  for (let i = 0; i < 20; i++)
    await request("/_next/static/s4-does-not-exist.js", "static-missing", 404);
});
await window("app-loads", async () => {
  for (let i = 0; i < 20; i++) {
    await request("/", "app-loads");
    for (const asset of assets) await request(asset, "app-loads");
  }
});
await window("dynamic-after", async () => {
  for (let i = 0; i < 20; i++) await request("/api/health", "dynamic-after");
});
await writeFile(
  `${output}/static-requests.json`,
  `${JSON.stringify({ recordedAt: new Date().toISOString(), origin, assets, method: "Deployed HTTPS document and all build assets named in the skeleton HTML. No browser cache, no Worker-first override, no CDN purge. The static-only case repeats one real hashed file. Each window has gaps and a two-second drain before closing. Request status or cache headers alone do not prove accounting; join the recorded windows to Cloudflare analytics. These HTTP app loads do not claim full browser interaction coverage.", windows, observations }, null, 2)}\n`,
);
