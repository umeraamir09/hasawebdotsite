import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createEvidenceDirectory } from "./lib/evidence-directory.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const directory = join(root, ".wrangler/private-uploads");
const config = join(directory, "worker.json");
const state = join(directory, "state");
const origin = "http://127.0.0.1:8834";
const secret = randomBytes(32).toString("hex");
const runtimeKey = randomBytes(32).toString("hex");
const tokens = Object.fromEntries(
  [
    "alice",
    "bob",
    "revoked",
    "expired",
    "deleting",
    "missing",
    "portfolio-deleting",
  ].map((id) => [id, randomBytes(24).toString("hex")]),
);
const checks = [];
const orphanIds = new Set();
const evidence = await createEvidenceDirectory(
  root,
  "private-uploads",
  process.env.RUNTIME_EVIDENCE,
);
let child;
let browser;
let logs = "";
function cli(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function cookie(id = "alice") {
  const token = tokens[id];
  return `__Host-hasaweb.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`)}`;
}
async function fixture(path, options = {}) {
  const result = await fetch(`${origin}/__fixture/${path}`, {
    ...options,
    headers: {
      "X-Runtime-Key": runtimeKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(result.status, 200, await result.clone().text());
  return result;
}
async function sql(query, values = []) {
  return (
    await (
      await fixture("sql", {
        method: "POST",
        body: JSON.stringify({ query, values }),
      })
    ).json()
  ).results;
}
const objects = async () => (await fixture("objects")).json();
const allRows = async () =>
  sql(
    "SELECT id,portfolio_id,kind,content_type,bytes,status FROM asset ORDER BY rowid",
  );
async function restoreAlice() {
  await sql("UPDATE user SET deleting_at=NULL WHERE id='upload-alice'");
  await sql(
    "UPDATE portfolio SET status='draft' WHERE id='upload-portfolio-alice'",
  );
  await sql(
    "INSERT OR REPLACE INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    [
      "upload-session-alice",
      tokens.alice,
      "upload-alice",
      Date.now() + 3600000,
      Date.now(),
      Date.now(),
    ],
  );
}
const signatures = {
  "image/jpeg": [255, 216, 255, 224],
  "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
  "image/webp": [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")],
  "application/pdf": [...Buffer.from("%PDF-1.7\n")],
};
function bytes(type = "image/png", length = 128) {
  const result = new Uint8Array(length).fill(42);
  result.set(signatures[type].slice(0, length));
  return result;
}
async function upload(data, type = "image/png", options = {}) {
  const headers = {
    "X-Runtime-Key": runtimeKey,
    Origin: origin,
    "Content-Type": type,
    "X-Asset-Purpose": type === "application/pdf" ? "resume" : "avatar",
    "X-Asset-Bytes": String(data.byteLength),
    "X-Expected-Owner-Id": `upload-${options.owner ?? "alice"}`,
    Cookie: options.owner === null ? "" : cookie(options.owner ?? "alice"),
    ...options.headers,
  };
  if (options.absentSize) delete headers["X-Asset-Bytes"];
  const result = await fetch(`${origin}/api/assets`, {
    method: "PUT",
    headers,
    body: options.networkChunked
      ? (async function* () {
          for (let offset = 0; offset < data.length; offset += 65_536)
            yield data.subarray(offset, offset + 65_536);
        })()
      : data,
    duplex: "half",
    signal: AbortSignal.timeout(40000),
  });
  assert.equal(
    result.status,
    options.status ?? 201,
    `Upload ${type}/${options.headers?.["X-Fixture-Mode"] ?? "normal"} returned ${result.status} ${await result.clone().text()}`,
  );
  assert.equal(
    result.headers.get("Cross-Origin-Resource-Policy"),
    "same-origin",
  );
  if (options.networkChunked)
    assert.equal(result.headers.get("X-Fixture-Content-Length"), "absent");
  if (
    [
      "finalize-before",
      "finalize-after",
      "cleanup-failure",
      "uncertain",
      "revoke",
      "delete",
      "delete-portfolio",
    ].includes(options.headers?.["X-Fixture-Mode"])
  )
    assert.equal(result.headers.get("X-Fixture-Finalize-Intercepted"), "true");
  const body = await result.text();
  return { value: body ? JSON.parse(body) : null, headers: result.headers };
}
async function get(id, { owner = "alice", status = 200, headers = {} } = {}) {
  const result = await fetch(`${origin}/api/assets/${id}`, {
    headers: {
      "X-Runtime-Key": runtimeKey,
      Cookie: owner === null ? "" : cookie(owner),
      ...headers,
    },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(
    result.status,
    status,
    `GET ${id}/${owner} returned ${result.status}`,
  );
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.equal(result.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(
    result.headers.get("Cross-Origin-Resource-Policy"),
    "same-origin",
  );
  return result;
}
async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`Passed ${name}`);
}
try {
  await mkdir(directory, { recursive: true });
  await rm(state, { recursive: true, force: true });
  await writeFile(
    config,
    JSON.stringify({
      name: "private-upload-local",
      main: join(root, "apps/web/integration/uploads-worker.ts"),
      compatibility_date: "2026-10-14",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      d1_databases: [
        {
          binding: "DB",
          database_name: "private-upload",
          database_id: "00000000-0000-0000-0000-000000000018",
          migrations_dir: join(root, "packages/db/migrations"),
        },
      ],
      r2_buckets: [
        { binding: "DRAFT_BUCKET", bucket_name: "private-upload-drafts" },
      ],
      vars: {
        APP_ENV: "test",
        APP_ORIGIN: "https://hasaweb.site",
        RUNTIME_ORIGIN: origin,
        RUNTIME_KEY: runtimeKey,
        BETTER_AUTH_SECRET: secret,
        GITHUB_CLIENT_ID: "fixture",
        GITHUB_CLIENT_SECRET: "fixture",
        GOOGLE_CLIENT_ID: "fixture",
        GOOGLE_CLIENT_SECRET: "fixture",
      },
    }),
  );
  cli([
    "d1",
    "migrations",
    "apply",
    "private-upload",
    "--local",
    "-c",
    config,
    "--persist-to",
    state,
  ]);
  child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "-c",
      config,
      "--persist-to",
      state,
      "--port",
      "8834",
      "--ip",
      "127.0.0.1",
    ],
    {
      cwd: root,
      detached: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      logs = (logs + data).slice(-50000);
    });
  let started = false;
  for (let i = 0; i < 150; i++) {
    try {
      if (
        (
          await fetch(`${origin}/health`, {
            headers: { "X-Runtime-Key": runtimeKey },
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        started = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) throw new Error(logs);
    await delay(200);
  }
  assert.ok(started, logs);
  for (const [id, token] of Object.entries(tokens)) {
    const now = Date.now();
    await sql(
      "INSERT INTO user(id,name,email,email_verified,deleting_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      [
        `upload-${id}`,
        id,
        `${id}@upload.example.test`,
        1,
        id === "deleting" ? now : null,
        now,
        now,
      ],
    );
    await sql(
      "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      [
        `upload-session-${id}`,
        token,
        `upload-${id}`,
        id === "expired" ? 1 : now + 3600000,
        now,
        now,
      ],
    );
    if (id !== "missing")
      await sql(
        "INSERT INTO portfolio(id,user_id,status,draft,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        [
          `upload-portfolio-${id}`,
          `upload-${id}`,
          id === "portfolio-deleting" ? "deleting" : "draft",
          "{}",
          now,
          now,
        ],
      );
  }
  await sql("DELETE FROM session WHERE id='upload-session-revoked'");
  await check(
    "browser File fetch and XMLHttpRequest framing reaches real R2",
    async () => {
      browser = await chromium.launch({
        executablePath:
          process.env.AUTH_SPIKE_CHROMIUM || "/opt/google/chrome/chrome",
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      const context = await browser.newContext({
        extraHTTPHeaders: { "X-Runtime-Key": runtimeKey, Cookie: cookie() },
      });
      const page = await context.newPage();
      await page.goto(`${origin}/__fixture/page`);
      const framing = await page.evaluate(
        async ({ runtimeKey, signature }) => {
          const file = new File(
            [new Uint8Array(signature), new Uint8Array(117)],
            "crop.png",
            { type: "image/png" },
          );
          const headers = {
            "X-Runtime-Key": runtimeKey,
            "X-Expected-Owner-Id": "upload-alice",
            "X-Asset-Purpose": "avatar",
            "X-Asset-Bytes": String(file.size),
            "Content-Type": file.type,
          };
          const result = await fetch("/api/assets", {
            method: "PUT",
            headers,
            body: file,
          });
          const xhr = await new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open("PUT", "/api/assets");
            for (const [key, value] of Object.entries(headers))
              request.setRequestHeader(key, value);
            request.onload = () =>
              resolve({
                status: request.status,
                value: JSON.parse(request.responseText),
                length: request.getResponseHeader("X-Fixture-Content-Length"),
              });
            request.onerror = reject;
            request.send(file);
          });
          return {
            fetch: {
              status: result.status,
              value: await result.json(),
              length: result.headers.get("X-Fixture-Content-Length"),
            },
            xhr,
            bytes: [...new Uint8Array(await file.arrayBuffer())],
          };
        },
        { runtimeKey, signature: signatures["image/png"] },
      );
      for (const transport of [framing.fetch, framing.xhr]) {
        assert.equal(transport.status, 201);
        assert.equal(transport.value.bytes, framing.bytes.length);
        assert.deepEqual(
          new Uint8Array(await (await get(transport.value.id)).arrayBuffer()),
          new Uint8Array(framing.bytes),
        );
      }
      await writeFile(
        join(evidence, "browser-framing.json"),
        JSON.stringify(framing, null, 2),
      );
      await browser.close();
      browser = undefined;
    },
  );
  let preserved;
  await check(
    "each exact format limit and limit plus one with byte equality",
    async () => {
      for (const type of Object.keys(signatures)) {
        const limit = type === "application/pdf" ? 10485760 : 5242880;
        const data = bytes(type, limit);
        const result = await upload(data, type);
        assert.equal(result.value.bytes, limit);
        const read = await get(result.value.id);
        assert.equal(read.headers.get("Content-Type"), type);
        if (type === "application/pdf")
          assert.equal(
            read.headers.get("Content-Disposition"),
            'attachment; filename="resume.pdf"',
          );
        assert.deepEqual(new Uint8Array(await read.arrayBuffer()), data);
        preserved ??= result.value;
        await upload(bytes(type, limit + 1), type, { status: 413 });
        await upload(bytes(type, limit + 1), type, {
          networkChunked: true,
          headers: { "X-Asset-Bytes": String(limit) },
          status: 413,
        });
        await upload(bytes(type, limit + 1), type, {
          headers: {
            "X-Fixture-Mode": "chunked",
            "X-Asset-Bytes": String(limit),
          },
          status: 413,
        });
      }
    },
  );
  await check(
    "split signatures, fallback framing, disguises, truncation and purpose",
    async () => {
      for (const type of Object.keys(signatures)) {
        await upload(bytes(type), type, {
          headers: { "X-Fixture-Mode": "chunked" },
        });
        await upload(
          bytes(
            type,
            (type === "application/pdf"
              ? 8
              : type === "image/jpeg"
                ? 3
                : signatures[type].length) - 1,
          ),
          type,
          { status: 415 },
        );
        await upload(bytes(type), type, {
          headers: {
            "X-Asset-Purpose": type === "application/pdf" ? "avatar" : "resume",
          },
          status: 415,
        });
      }
      await upload(bytes("image/png"), "image/jpeg", { status: 415 });
      await upload(new Uint8Array(128), "image/png", { status: 415 });
      await upload(bytes(), "text/html", { status: 415 });
      await upload(bytes(), "image/png", {
        headers: { "X-Fixture-Mode": "chunked" },
        absentSize: true,
        status: 411,
      });
      await upload(bytes(), "image/png", {
        headers: { "X-Fixture-Mode": "chunked", "X-Asset-Bytes": "127" },
        status: 413,
      });
      await upload(bytes(), "image/png", {
        headers: { "X-Fixture-Mode": "chunked", "X-Asset-Bytes": "129" },
        status: 400,
      });
      await upload(bytes(), "image/png", {
        headers: { "X-Asset-Bytes": "127" },
        status: 400,
      });
      await upload(bytes(), "image/png", {
        headers: { "X-Fixture-Mode": "short" },
        status: 400,
      });
    },
  );
  await check(
    "uncached identities, exact Origin and expected-owner checks",
    async () => {
      for (const owner of [null, "expired", "revoked"])
        await upload(bytes(), "image/png", { owner, status: 401 });
      for (const owner of ["deleting", "missing", "portfolio-deleting"])
        await upload(bytes(), "image/png", { owner, status: 503 });
      await upload(bytes(), "image/png", {
        headers: { Origin: "https://foreign.example" },
        status: 403,
      });
      await upload(bytes(), "image/png", {
        headers: { Origin: "" },
        status: 403,
      });
      await upload(bytes(), "image/png", {
        headers: { "X-Expected-Owner-Id": "upload-bob" },
        status: 409,
      });
      await upload(bytes(), "image/png", {
        headers: { "X-Expected-Owner-Id": "" },
        status: 409,
      });
      for (const owner of [null, "bob", "revoked", "expired", "deleting"])
        await get(preserved.id, { owner, status: 404 });
      await get(preserved.id, {
        headers: { "X-Expected-Owner-Id": "upload-bob" },
        status: 404,
      });
    },
  );
  await check(
    "interruption, idle timeout and early storage failures never become ready",
    async () => {
      for (const [mode, status] of [
        ["interrupt", 503],
        ["stall", 408],
        ["total", 408],
        ["abort", 408],
        ["storage-delay", 408],
        ["storage-stall", 408],
        ["storage-before", 503],
        ["storage-before-stall", 503],
        ["storage-sync", 503],
        ["aborted", 408],
        ["storage-after", 503],
        ["finalize-before", 503],
        ["cleanup-failure", 503],
        ["collision", 409],
      ]) {
        const before = await allRows();
        const result = await upload(bytes(), "image/png", {
          headers: { "X-Fixture-Mode": mode },
          status,
        });
        if (
          [
            "stall",
            "total",
            "abort",
            "storage-before-stall",
            "storage-stall",
            "storage-sync",
            "aborted",
          ].includes(mode)
        )
          assert.equal(
            result.headers.get("X-Fixture-Canceled"),
            "true",
            `${mode} cancels its input stream`,
          );
        const added = (await allRows()).filter(
          (row) => !before.some((previous) => previous.id === row.id),
        );
        assert.equal(added.length, 1);
        assert.equal(added[0].status, "failed");
        await get(added[0].id, { status: 404 });
        if (mode === "cleanup-failure" || mode === "collision")
          orphanIds.add(added[0].id);
        else {
          for (
            let i = 0;
            i < 50 &&
            (await objects()).some((object) =>
              object.key.endsWith(`/${added[0].id}`),
            );
            i++
          )
            await delay(20);
          assert.ok(
            !(await objects()).some((object) =>
              object.key.endsWith(`/${added[0].id}`),
            ),
            `${mode} removes its immutable R2 key`,
          );
        }
        assert.deepEqual(
          new Uint8Array(await (await get(preserved.id)).arrayBuffer()),
          bytes("image/jpeg", 5242880),
        );
      }
    },
  );
  await check(
    "lost finalization response retains successful bytes and metadata",
    async () => {
      const data = bytes();
      const result = await upload(data, "image/png", {
        headers: { "X-Fixture-Mode": "finalize-after" },
      });
      assert.deepEqual(
        new Uint8Array(await (await get(result.value.id)).arrayBuffer()),
        data,
      );
    },
  );
  await check(
    "unavailable reconciliation leaves pending bytes inaccessible",
    async () => {
      const before = await allRows();
      await upload(bytes(), "image/png", {
        headers: { "X-Fixture-Mode": "uncertain" },
        status: 503,
      });
      const row = (await allRows()).find(
        (row) => !before.some((previous) => previous.id === row.id),
      );
      assert.equal(row.status, "pending");
      assert.ok(
        (await objects()).some((object) => object.key.endsWith(`/${row.id}`)),
      );
      await get(row.id, { status: 404 });
    },
  );
  await check(
    "revocation and deletion between storage and finalization deny readiness",
    async () => {
      for (const mode of ["revoke", "delete", "delete-portfolio"]) {
        await restoreAlice();
        const before = await allRows();
        await upload(bytes(), "image/png", {
          headers: { "X-Fixture-Mode": mode },
          status: 401,
        });
        const row = (await allRows()).find(
          (row) => !before.some((previous) => previous.id === row.id),
        );
        assert.equal(row.status, "failed");
        await get(row.id, { status: 404 });
        await get(preserved.id, { status: 404 });
      }
      await restoreAlice();
      assert.equal((await get(preserved.id)).status, 200);
    },
  );
  await check("private GET repeats authorization after R2 lookup", async () => {
    await get(preserved.id, {
      headers: { "X-Fixture-Mode": "get-revoke" },
      status: 404,
    });
    await get(preserved.id, { status: 404 });
    await restoreAlice();
    await get(preserved.id);
  });
  await check(
    "owned ready purpose resolver rejects foreign, wrong-purpose and missing objects",
    async () => {
      const resolve = async (id, purpose) =>
        fetch(`${origin}/__fixture/resolve?id=${id}&purpose=${purpose}`, {
          headers: { "X-Runtime-Key": runtimeKey },
        });
      assert.equal((await resolve(preserved.id, "avatar")).status, 200);
      assert.equal((await resolve(preserved.id, "resume")).status, 404);
      const bob = await upload(bytes(), "image/png", { owner: "bob" });
      assert.equal((await resolve(bob.value.id, "avatar")).status, 404);
      const missing = await upload(bytes());
      await fixture(
        `remove-object?key=${encodeURIComponent(`draft/upload-portfolio-alice/${missing.value.id}`)}`,
      );
      assert.equal((await resolve(missing.value.id, "avatar")).status, 404);
      await get(missing.value.id, { status: 404 });
      await sql("UPDATE asset SET bytes=bytes+1 WHERE id=?", [bob.value.id]);
      await get(bob.value.id, { owner: "bob", status: 404 });
      for (const row of (await allRows()).filter(
        (row) => row.status !== "ready",
      ))
        assert.equal((await resolve(row.id, "avatar")).status, 404);
    },
  );
  await check(
    "immutable replacement allocates new IDs and preserves old success",
    async () => {
      const first = await upload(bytes());
      const second = await upload(bytes());
      assert.notEqual(first.value.id, second.value.id);
      assert.notEqual(first.value.id, preserved.id);
      await upload(bytes(), "image/png", {
        headers: { "X-Fixture-Mode": "storage-after" },
        status: 503,
      });
      assert.equal((await get(preserved.id)).status, 200);
      assert.deepEqual(
        new Uint8Array(await (await get(first.value.id)).arrayBuffer()),
        bytes(),
      );
      await get("00000000-0000-0000-0000-000000000000", { status: 404 });
      await get("not-an-id", { status: 404 });
      const rows = await allRows();
      assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
    },
  );
  await delay(100);
  const retained = await objects();
  const rows = await allRows();
  for (const row of rows.filter((row) => row.status === "failed")) {
    const matching = retained.filter((object) =>
      object.key.endsWith(`/${row.id}`),
    );
    assert.equal(
      matching.length,
      orphanIds.has(row.id) ? 1 : 0,
      `Failed ${row.id} cleanup state`,
    );
  }
  await writeFile(
    join(evidence, "results.json"),
    JSON.stringify(
      { recordedAt: new Date().toISOString(), checks, rows, objects: retained },
      null,
      2,
    ),
  );
  console.log(
    `Passed ${checks.length} private upload groups. Evidence ${evidence}`,
  );
} catch (error) {
  await writeFile(
    join(evidence, "failure.json"),
    JSON.stringify({ checks, failure: error.message, logs }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  if (child && child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    process.kill(-child.pid, "SIGTERM");
    await Promise.race([stopped, delay(5000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid, "SIGKILL");
  }
}
