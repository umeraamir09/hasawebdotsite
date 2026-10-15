import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parseEnv } from "node:util";
import { publicNetwork } from "./spike-network.mjs";

// Uses only synthetic, unique keys in the already configured S-3 public bucket.
const root = new URL("../", import.meta.url);
const account = "b6f9a87e6702c76c45a8d61744826e0f";
const zone = "86935ec740f2f63695422cc388bbb0bd";
const config = await readFile(
  join(
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone operator script outside Turbo tasks
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    ".wrangler/config/default.toml",
  ),
  "utf8",
);
const oauth = config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
assert.ok(oauth, "Run wrangler login first");
let extra = {};
try {
  extra = parseEnv(
    await readFile(new URL(".env.workflow-spike.local", root), "utf8"),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const purgeToken =
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone operator credentials, never cached by Turbo
  extra.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || oauth;
const key = `workflow-probe/${randomUUID()}.png`;
const url = `https://assets.hasaweb.site/${key}`;
const objectPath = `/accounts/${account}/r2/buckets/hasaweb-s3-assets/objects/${key}`;
const { dispatcher } = publicNetwork();
const evidence = {
  recordedAt: new Date().toISOString(),
  key,
  url,
  observations: [],
  checks: [],
  limitations: [
    "Observed locations are samples, not a worldwide propagation guarantee",
  ],
};
async function api(path, init = {}, token = oauth) {
  return fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(30000),
  });
}
async function observe(stage, method = "GET", query = "") {
  const response = await fetch(url + query, {
    method,
    dispatcher,
    signal: AbortSignal.timeout(30000),
  });
  const record = {
    stage,
    method,
    query,
    status: response.status,
    cache: response.headers.get("cf-cache-status"),
    ray: response.headers.get("cf-ray"),
    age: response.headers.get("age"),
    cacheControl: response.headers.get("cache-control"),
    at: new Date().toISOString(),
  };
  await response.arrayBuffer();
  evidence.observations.push(record);
  return record;
}
async function remoteOnce(stage) {
  const response = await api(
    `/accounts/${account}/browser-rendering/content?cacheTTL=0`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: "domcontentloaded", timeout: 15000 },
      }),
    },
  );
  const result = await response.json();
  assert.ok(
    response.ok && result.success && result.meta?.headers,
    `Remote browser observations unavailable: HTTP ${response.status} ${JSON.stringify(result.errors)} meta=${JSON.stringify(result.meta)}`,
  );
  const headers = result.meta.headers;
  const record = {
    stage,
    method: "GET",
    query: "",
    vantage: "Cloudflare remote browser",
    status: result.meta.status,
    cache: headers["cf-cache-status"],
    ray: headers["cf-ray"],
    age: headers.age ?? null,
    cacheControl: headers["cache-control"],
    at: new Date().toISOString(),
  };
  evidence.observations.push(record);
  return record;
}
async function remoteObserve(stage) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await remoteOnce(stage);
    } catch (error) {
      lastError = error;
      await setTimeout(3000);
    }
  }
  throw lastError;
}
let created = false;
try {
  // A real 1x1 PNG is harmless and uses a cacheable asset extension.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const put = await api(objectPath, {
    method: "PUT",
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=0, s-maxage=60, must-revalidate",
    },
    body: png,
  });
  assert.ok(put.ok, `Synthetic R2 put HTTP ${put.status}`);
  created = true;
  let hit = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const record = await observe("warm");
    assert.equal(record.status, 200);
    if (record.cache === "HIT") {
      hit = true;
      break;
    }
  }
  evidence.checks.push({
    name: "synthetic public asset warmed to CDN HIT",
    passed: hit,
  });
  let remoteHit = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const record = await remoteObserve("remote-warm");
    assert.equal(record.status, 200);
    if (record.cache === "HIT") {
      remoteHit = true;
      break;
    }
  }
  evidence.checks.push({
    name: "remote browser warmed a CDN HIT",
    passed: remoteHit,
  });
  const deleted = await api(objectPath, { method: "DELETE" });
  assert.ok(deleted.ok, `Synthetic R2 delete HTTP ${deleted.status}`);
  created = false;
  const origin = await api(objectPath);
  evidence.checks.push({
    name: "deleted R2 origin returns 404",
    passed: origin.status === 404,
  });
  await origin.arrayBuffer();
  await observe("after-origin-delete-before-purge");
  evidence.purgeRequestedAt = new Date().toISOString();
  const purged = await api(
    `/zones/${zone}/purge_cache`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [url] }),
    },
    purgeToken,
  );
  const result = await purged.json();
  evidence.purge = {
    status: purged.status,
    success: result.success === true,
    errors: result.errors,
  };
  if (purged.ok && result.success) {
    for (const method of ["GET", "HEAD"]) {
      let record;
      for (let attempt = 0; attempt < 15; attempt++) {
        record = await observe("after-purge", method);
        if (record.status === 404) break;
        await setTimeout(1000);
      }
      evidence.checks.push({
        name: `withdrawn CDN ${method} returns 404`,
        passed: record.status === 404,
      });
    }
    let remote;
    for (let attempt = 0; attempt < 4; attempt++) {
      remote = await remoteObserve("remote-after-purge");
      if (remote.status === 404) break;
      await setTimeout(1000);
    }
    evidence.checks.push({
      name: "withdrawn remote CDN GET returns 404",
      passed: remote.status === 404,
    });
    const warmedLocations = new Set(
      evidence.observations
        .filter(
          (record) => record.stage.includes("warm") && record.cache === "HIT",
        )
        .map((record) => record.ray?.split("-").at(-1)),
    );
    evidence.checks.push({
      name: "at least two distinct edge locations warmed",
      passed: warmedLocations.size >= 2,
    });
    const variant = await observe("after-purge-query", "GET", "?download=1");
    evidence.checks.push({
      name: "uncached query variant returns 404",
      passed: variant.status === 404,
    });
  } else {
    process.exitCode = 1;
    evidence.limitations.push(
      "CDN purge rejected. Provide a hasaweb.site zone-scoped Cache Purge token in .env.workflow-spike.local and rerun.",
    );
  }
  if (evidence.checks.some((check) => !check.passed)) process.exitCode = 1;
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  if (created) await api(objectPath, { method: "DELETE" });
  await dispatcher.close();
  await writeFile(
    new URL("specs/2026-10-15-workflow-assets/live-evidence.json", root),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(JSON.stringify(evidence, null, 2));
}
