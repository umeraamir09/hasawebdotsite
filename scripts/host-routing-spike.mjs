import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, ".wrangler/routing-spike");
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const config = join(output, "wrangler.json");
await writeFile(
  config,
  JSON.stringify({
    name: "hasaweb-routing-local",
    main: join(root, "apps/site/spike/worker.ts"),
    compatibility_date: "2026-10-14",
    r2_buckets: [{ binding: "SITES_BUCKET", bucket_name: "hasaweb-s3-sites" }],
  }),
);
const result = spawnSync(
  process.execPath,
  [
    join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js"),
    "deploy",
    "--dry-run",
    "--config",
    config,
    "--outdir",
    output,
  ],
  { encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
assert.equal(result.status, 0, result.stdout + result.stderr);
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: join(output, "worker.js"),
    compatibilityDate: "2026-10-14",
    r2Buckets: ["SITES_BUCKET"],
  }),
);
const observations = [];
try {
  await runtime.ready;
  const bucket = await runtime.getR2Bucket("SITES_BUCKET");
  await bucket.put(
    "routing-probe/index.html",
    "<!doctype html><title>S-3 routing fixture</title><p>Published routing fixture</p>",
  );
  const tests = [
    { host: "routingprobe.hasaweb.site", path: "/", status: 200 },
    {
      host: "routingprobe.hasaweb.site",
      path: "/",
      method: "HEAD",
      status: 200,
    },
    {
      host: "routingprobe.hasaweb.site",
      path: "/",
      method: "POST",
      status: 405,
    },
    {
      host: "routingprobe.hasaweb.site",
      path: "/api/runtime-spike",
      status: 404,
    },
    { host: "routingprobe.hasaweb.site", path: "/api/draft", status: 404 },
    {
      host: "routingprobe.hasaweb.site",
      path: "/draft/private.png",
      status: 404,
    },
    { host: "unknown.hasaweb.site", path: "/", status: 404 },
    { host: "example.hasaweb.site", path: "/", status: 404 },
    ...[
      "hasaweb.site",
      "www.hasaweb.site",
      "assets.hasaweb.site",
      "app.hasaweb.site",
      "api.hasaweb.site",
      "mail.hasaweb.site",
      "admin.hasaweb.site",
      "status.hasaweb.site",
      "docs.hasaweb.site",
      "blog.hasaweb.site",
      "help.hasaweb.site",
      "support.hasaweb.site",
      "static.hasaweb.site",
      "cdn.hasaweb.site",
      "demo.hasaweb.site",
      "a.b.hasaweb.site",
      "ab.hasaweb.site",
      "-alice.hasaweb.site",
      "ali_ce.hasaweb.site",
      "hasaweb.site.evil.test",
      "evilhasaweb.site",
      "routingprobe.hasaweb.site.",
      "routingprobe.hasaweb.site:444",
    ].map((host) => ({ host, path: "/", status: 421 })),
  ];
  for (const test of tests) {
    const response = await runtime.dispatchFetch(
      `https://${test.host}${test.path}`,
      { method: test.method ?? "GET" },
    );
    const body = await response.text();
    assert.equal(response.status, test.status, JSON.stringify(test));
    assert.equal(response.headers.get("Set-Cookie"), null);
    if (response.status !== 200)
      assert.ok(!body.includes("Published routing fixture"));
    if (test.method === "HEAD") assert.equal(body, "");
    observations.push({
      ...test,
      observed: response.status,
      target: response.headers.get("X-Spike-Target"),
    });
  }
  const report = {
    recordedAt: new Date().toISOString(),
    method:
      "Local workerd dispatch into the S-3 site entry with a real local R2 fixture. This tests handler boundaries only. It does not model Cloudflare route selection, DNS, TLS, R2 custom domains or request billing.",
    node: process.version,
    wrangler: require("wrangler/package.json").version,
    workerd: wranglerRequire("workerd/package.json").version,
    observations,
  };
  await writeFile(
    join(output, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `PASS: ${observations.length} local host/path/method boundaries; deployed routing remains separate`,
  );
} finally {
  await runtime.dispose();
}
