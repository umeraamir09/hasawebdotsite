import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { publicNetwork } from "./spike-network.mjs";

const { dispatcher, resolver } = publicNetwork();
const observations = [];
const windows = [];
async function request(url, status, label) {
  const at = Date.now();
  const response = await fetch(url, {
    dispatcher,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.text();
  observations.push({
    case: label,
    url,
    at,
    status: response.status,
    bytes: Buffer.byteLength(body),
    target: response.headers.get("X-Spike-Target"),
    ray: response.headers.get("cf-ray"),
    cacheStatus: response.headers.get("cf-cache-status"),
  });
  assert.equal(response.status, status, url);
  if (new URL(url).hostname === "assets.hasaweb.site")
    assert.equal(response.headers.get("X-Spike-Target"), null);
}
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
let failure;
try {
  await window("site-control-before", async () => {
    for (let i = 0; i < 20; i++)
      await request(
        "https://hasaweb-s3-site.umerthepro2009.workers.dev/",
        421,
        "site-control-before",
      );
  });
  await window("assets-only", async () => {
    for (let i = 0; i < 50; i++)
      await request(
        "https://assets.hasaweb.site/routing-probe/asset.txt",
        200,
        "assets-only",
      );
    for (let i = 0; i < 50; i++)
      await request(
        "https://assets.hasaweb.site/routing-probe/missing.txt",
        404,
        "assets-only",
      );
  });
  await window("site-control-after", async () => {
    for (let i = 0; i < 100; i++)
      await request(
        "https://hasaweb-s3-site.umerthepro2009.workers.dev/",
        421,
        "site-control-after",
      );
  });
} catch (error) {
  failure = String(error);
} finally {
  let addresses;
  try {
    addresses = await resolver.resolve4("assets.hasaweb.site");
  } catch (error) {
    addresses = { error: error.code };
  }
  await writeFile(
    ".wrangler/routing-production/asset-requests.json",
    `${JSON.stringify({ recordedAt: new Date().toISOString(), method: "Actual deployed R2 custom-domain HTTPS requests, resolved through public 1.1.1.1, strict TLS, no Host/IP simulation. Existing assets and missing keys must both bypass Workers. Separate before/after positive controls invoke the site Worker on its workers.dev hostname, which it rejects. Join these windows to all routed Workers' analytics.", addresses, windows, observations, failure }, null, 2)}\n`,
  );
  await dispatcher.close();
}
if (failure) throw new Error(failure);
