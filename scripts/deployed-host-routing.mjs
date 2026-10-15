import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import tls from "node:tls";
import { publicNetwork } from "./spike-network.mjs";

const publicDNS = process.argv.includes("--public-dns");
const network = publicDNS ? publicNetwork() : undefined;
const resolver = network?.resolver;
const lookup = network?.lookup;
const dispatcher = network?.dispatcher;

const output = ".wrangler/routing-production";
await mkdir(output, { recursive: true });
const reserved = [
  "app",
  "api",
  "mail",
  "admin",
  "status",
  "docs",
  "blog",
  "help",
  "support",
  "static",
  "cdn",
  "demo",
];
const cases = [
  { url: "https://hasaweb.site/", status: 200, marker: "hasaweb.site" },
  { url: "https://hasaweb.site/api/runtime-spike", status: 404 },
  {
    url: "https://www.hasaweb.site/?s3=1",
    status: 308,
    location: "https://hasaweb.site/?s3=1",
  },
  {
    url: "https://www.hasaweb.site/_next/static/probe.js?s3=1",
    status: 308,
    location: "https://hasaweb.site/_next/static/probe.js?s3=1",
  },
  {
    url: "https://routingprobe.hasaweb.site/",
    status: 200,
    target: "site",
    marker: "Published routing fixture",
  },
  {
    url: "https://routingprobe.hasaweb.site/",
    method: "HEAD",
    status: 200,
    target: "site",
  },
  {
    url: "https://routingprobe.hasaweb.site/",
    method: "POST",
    status: 405,
    target: "site",
  },
  ...[
    "/api/draft",
    "/api/runtime-spike",
    "/api/auth/get-session",
    "/draft/private.png",
    "/resume",
    "/health",
  ].map((path) => ({
    url: `https://routingprobe.hasaweb.site${path}`,
    status: 404,
    target: "site",
  })),
  { url: "https://unknown.hasaweb.site/", status: 404, target: "site" },
  { url: "https://example.hasaweb.site/", status: 404, target: "site" },
  ...reserved.map((host) => ({
    url: `https://${host}.hasaweb.site/`,
    status: 421,
    target: "site",
  })),
  ...["ab", "-alice", "alice-", "ali_ce", "a".repeat(31)].map((host) => ({
    url: `https://${host}.hasaweb.site/`,
    status: 421,
    target: "site",
  })),
  { url: "https://routingprobe.hasaweb.site./", status: 421, target: "site" },
  {
    url: "https://hasaweb-s3-site.umerthepro2009.workers.dev/",
    status: 421,
    target: "site",
  },
  {
    url: "https://assets.hasaweb.site/routing-probe/asset.txt",
    status: 200,
    noWorker: true,
    marker: "S-3 public asset fixture",
  },
  {
    url: "https://assets.hasaweb.site/routing-probe/missing.txt",
    status: 404,
    noWorker: true,
  },
];
async function request(test) {
  try {
    const response = await fetch(test.url, {
      method: test.method ?? "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      ...(dispatcher ? { dispatcher } : {}),
    });
    const body = await response.text();
    const target = response.headers.get("X-Spike-Target");
    const location = response.headers.get("Location");
    return {
      ...test,
      at: new Date().toISOString(),
      observed: response.status,
      target,
      location,
      bytes: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
      ray: response.headers.get("cf-ray"),
      cacheStatus: response.headers.get("cf-cache-status"),
      setsCookie: response.headers.has("Set-Cookie"),
      pass:
        response.status === test.status &&
        (!test.target || target === test.target) &&
        (!test.location || location === test.location) &&
        (!test.marker || body.includes(test.marker)) &&
        (!test.noWorker || target === null) &&
        !response.headers.has("Set-Cookie"),
    };
  } catch (error) {
    return {
      ...test,
      pass: false,
      error: error.cause?.code ?? error.code ?? error.name,
    };
  }
}
async function certificate(host) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: true,
        ...(publicDNS ? { lookup } : {}),
      },
      () => {
        const cert = socket.getPeerCertificate();
        resolve({
          host,
          authorized: socket.authorized,
          protocol: socket.getProtocol(),
          subjectAltName: cert.subjectaltname,
          issuer: cert.issuer?.CN,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          fingerprint256: cert.fingerprint256,
        });
        socket.end();
      },
    );
    socket.setTimeout(10000, () => {
      socket.destroy();
      resolve({ host, authorized: false, error: "timeout" });
    });
    socket.once("error", (error) =>
      resolve({ host, authorized: false, error: error.code ?? error.name }),
    );
  });
}
const results = [];
for (let index = 0; index < cases.length; index += 6)
  results.push(
    ...(await Promise.all(cases.slice(index, index + 6).map(request))),
  );
const certificates = await Promise.all(
  [
    "hasaweb.site",
    "www.hasaweb.site",
    "routingprobe.hasaweb.site",
    "assets.hasaweb.site",
    "a.b.hasaweb.site",
  ].map(certificate),
);
const records = [];
for (const host of [
  "hasaweb.site",
  "www.hasaweb.site",
  "routingprobe.hasaweb.site",
  "assets.hasaweb.site",
]) {
  try {
    records.push({
      host,
      ipv4: await (publicDNS ? resolver.resolve4(host) : dns.resolve4(host)),
    });
  } catch (error) {
    records.push({ host, error: error.code });
  }
}
let nameservers;
try {
  nameservers = await (publicDNS
    ? resolver.resolveNs("hasaweb.site")
    : dns.resolveNs("hasaweb.site"));
} catch (error) {
  nameservers = { error: error.code };
}
const report = {
  recordedAt: new Date().toISOString(),
  resolver: publicDNS
    ? "1.1.1.1 public recursive DNS, real returned addresses and strict TLS SNI; no simulated hosts or fixed IP overrides"
    : "system DNS",
  method:
    "Actual deployed HTTPS host/path/method requests with normal certificate validation. TLS details come from separate trusted Node TLS handshakes. Header absence does not alone prove asset bypass; use configuration plus controlled asset-window Worker analytics. No --insecure or DNS/Host simulation.",
  results,
  certificates,
  records,
  nameservers,
  pass:
    results.every((result) => result.pass) &&
    certificates.slice(0, 4).every((cert) => cert.authorized) &&
    !certificates[4].authorized,
};
await writeFile(
  `${output}/deployed-routing.json`,
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    pass: report.pass,
    checks: results.length,
    failed: results.filter((result) => !result.pass),
    certificates,
    nameservers,
  }),
);

await dispatcher?.close();
