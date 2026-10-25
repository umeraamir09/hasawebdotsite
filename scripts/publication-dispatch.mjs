import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createEvidenceDirectory } from "./lib/evidence-directory.mjs";
import { s8Profiler } from "./lib/s8-profiler.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url),
  wrangler = join(
    dirname(require.resolve("wrangler/package.json")),
    "bin/wrangler.js",
  );
const directory = join(
    root,
    ".wrangler/s8-dispatch",
    `run-${randomBytes(6).toString("hex")}`,
  ),
  state = join(directory, "state");
const evidence = await createEvidenceDirectory(
  root,
  "s8-dispatch",
  process.env.S8_EVIDENCE,
);
const remote = process.argv.includes("--remote");
const remoteState = remote
  ? JSON.parse(
      await readFile(join(root, ".wrangler/s8-provider/state.json"), "utf8"),
    )
  : null;
const runtimeKey = remoteState?.runtimeKey ?? randomBytes(32).toString("hex"),
  secret = remoteState?.secret ?? randomBytes(32).toString("hex"),
  token = randomBytes(24).toString("hex");
const cookie = `__Host-hasaweb.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`)}`;
const origin = remoteState?.origin ?? "http://127.0.0.1:8857";
let child,
  logs = "",
  profiler;
const checks = [],
  runs = [],
  sweeps = [];
function cli(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_ENV: "production",
      WRANGLER_SEND_METRICS: "false",
    },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
async function request(path, options = {}) {
  return fetch(origin + path, {
    ...options,
    headers: {
      "X-Runtime-Key": runtimeKey,
      Connection: "close",
      Cookie: cookie,
      ...options.headers,
    },
    signal: AbortSignal.timeout(60000),
  });
}
async function api(path, body) {
  const response = await request(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  if (path.startsWith("/sweep") && data.counts) sweeps.push(data.counts);
  return data;
}
async function sql(query, values = []) {
  if (remote) {
    const saved = await readFile(
      join(homedir(), ".config/.wrangler/config/default.toml"),
      "utf8",
    );
    const token = saved.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
    assert.ok(token);
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${remoteState.account}/d1/database/${remoteState.database.uuid}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql: query, params: values }),
        signal: AbortSignal.timeout(60000),
      },
    );
    const result = await response.json();
    assert.ok(response.ok && result.success, JSON.stringify(result.errors));
    return result.result[0];
  }
  return (await api("/sql", { sql: query, values })).value;
}
const hash = (data) => createHash("sha256").update(data).digest("hex");
await mkdir(directory, { recursive: true });
const config = {
  compatibility_date: "2026-10-14",
  compatibility_flags: ["nodejs_compat"],
  workers_dev: false,
  d1_databases: [
    {
      binding: "DB",
      database_name: "hasaweb-s8-dispatch-local",
      database_id: "00000000-0000-0000-0000-000000000008",
      migrations_dir: join(root, "packages/db/migrations"),
    },
  ],
  vars: {
    RUNTIME_KEY: runtimeKey,
    APP_ENV: "test",
    APP_ORIGIN: "https://hasaweb.site",
    GITHUB_CLIENT_ID: "fixture",
    GITHUB_CLIENT_SECRET: "fixture",
    GOOGLE_CLIENT_ID: "fixture",
    GOOGLE_CLIENT_SECRET: "fixture",
    BETTER_AUTH_SECRET: secret,
    ASSET_ORIGIN: "https://s8-assets.invalid",
    MEASURE_QUOTAS: process.env.S8_PROFILE ? "false" : "true",
    MANUAL_DISPATCH: "true",
    PUBLICATION_TASK_BATCH: process.env.S8_BATCH ?? "16",
  },
};
const jobs = {
  ...config,
  name: "hasaweb-s8-dispatch-jobs-local",
  main: join(root, "apps/jobs/integration/publication-dispatch-worker.ts"),
  r2_buckets: [
    { binding: "SITES_BUCKET", bucket_name: "s8-sites-local" },
    { binding: "PUBLIC_ASSETS_BUCKET", bucket_name: "s8-assets-local" },
  ],
  services: [
    {
      binding: "PRIVATE_SOURCE",
      service: "hasaweb-s8-dispatch-source-local",
      entrypoint: "PublicationAssets",
    },
    { binding: "SOURCE_FIXTURE", service: "hasaweb-s8-dispatch-source-local" },
  ],
  queues: {
    producers: [
      { binding: "PUBLICATION_QUEUE", queue: "s8-publication-local" },
    ],
    consumers: [
      {
        queue: "s8-publication-local",
        max_batch_size: 1,
        max_batch_timeout: 1,
      },
    ],
  },
};
const web = {
  ...config,
  name: "hasaweb-s8-dispatch-source-local",
  main: join(root, "apps/web/integration/publication-source-worker.ts"),
  r2_buckets: [{ binding: "DRAFT_BUCKET", bucket_name: "s8-draft-local" }],
};
await writeFile(join(directory, "jobs.json"), JSON.stringify(jobs));
await writeFile(join(directory, "web.json"), JSON.stringify(web));
const fixturePath = join(directory, "fixtures.cjs");
await createRequire(require.resolve("wrangler"))("esbuild").build({
  entryPoints: [join(root, "apps/jobs/integration/publication-fixtures.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: fixturePath,
});
const { makeDraft, expected, expectedPages, assetReferences } = await import(
  pathToFileURL(fixturePath)
);
try {
  if (!remote) {
    cli([
      "d1",
      "migrations",
      "apply",
      "hasaweb-s8-dispatch-local",
      "--local",
      "-c",
      join(directory, "jobs.json"),
      "--persist-to",
      state,
    ]);
    child = spawn(
      process.execPath,
      [
        wrangler,
        "dev",
        "-c",
        join(directory, "jobs.json"),
        "-c",
        join(directory, "web.json"),
        "--persist-to",
        state,
        "--ip",
        "127.0.0.1",
        "--port",
        "8857",
        "--inspector-port",
        process.env.S8_PROFILE ? "9237" : "0",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "production",
          WRANGLER_SEND_METRICS: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (data) => {
      logs += data.toString();
      void writeFile(join(evidence, "runtime-live.log"), logs);
    });
    child.stderr.on("data", (data) => {
      logs += data.toString();
      void writeFile(join(evidence, "runtime-live.log"), logs);
    });
    for (let n = 0; ; n++) {
      try {
        if (
          (
            await fetch(`${origin}/health`, {
              headers: { "X-Runtime-Key": runtimeKey },
              signal: AbortSignal.timeout(2000),
            })
          ).ok
        )
          break;
      } catch {}
      if (n >= 60) throw new Error(logs);
      await delay(500);
    }
  }
  if (process.env.S8_PROFILE && !remote)
    profiler = await s8Profiler(9237, evidence);
  const now = Date.now();
  await sql("DELETE FROM publication_transfer");
  await sql("DELETE FROM publication_candidate");
  await sql("DELETE FROM user WHERE id='s8-owner'");
  await sql(
    "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ["s8-owner", "S8 synthetic owner", "s8@example.test", 1, now, now],
  );
  await sql(
    "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ["s8-session", token, "s8-owner", now + 3600000, now, now],
  );
  const initial = makeDraft("small");
  await sql(
    "INSERT INTO portfolio(id,user_id,status,draft,draft_rev,draft_validation_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    [
      "s8-portfolio",
      "s8-owner",
      "draft",
      JSON.stringify(initial),
      0,
      2,
      now,
      now,
    ],
  );
  await sql(
    "INSERT OR REPLACE INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES('s8-fixture','s8-portfolio','held',?)",
    [now],
  );
  const assets = new Map();
  for (const kind of (
    process.env.S8_CASES ??
    "small,mixed,unicode,surrogate,surrogate-boundary,description,deep,dense,hands,cat,face,assets,max"
  ).split(",")) {
    const draft = makeDraft(kind);
    for (const ref of assetReferences(draft)) {
      if (assets.has(ref.id)) continue;
      const size =
        process.env.S8_MAX_ASSETS === "true"
          ? ref.purpose === "resume"
            ? 10485760
            : 5242880
          : 128;
      const data = new Uint8Array(size).fill(42);
      data.set(
        ref.purpose === "resume"
          ? Buffer.from("%PDF-1.7\n")
          : [137, 80, 78, 71, 13, 10, 26, 10],
      );
      const contentType =
        ref.purpose === "resume" ? "application/pdf" : "image/png";
      await sql(
        "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        [
          ref.id,
          "s8-portfolio",
          ref.purpose,
          contentType,
          size,
          "ready",
          now,
          now,
        ],
      );
      const result = await request(
        `/seed-asset?key=${encodeURIComponent(`draft/s8-portfolio/${ref.id}`)}`,
        { method: "PUT", body: data },
      );
      assert.equal(result.status, 200, await result.text());
      assets.set(ref.id, { hash: hash(data), size });
    }
    await sql(
      "UPDATE portfolio SET draft=?,draft_rev=draft_rev+1 WHERE id='s8-portfolio'",
      [JSON.stringify(draft)],
    );
    const revision = (
      await sql("SELECT draft_rev FROM portfolio WHERE id='s8-portfolio'")
    ).results[0].draft_rev;
    const startedAt = new Date().toISOString();
    await profiler?.start();
    const created = await api("/create", { revision }),
      id = created.value.id;
    const run = {
      kind,
      id,
      inputBytes: Buffer.byteLength(JSON.stringify(draft)),
      creation: created.counts,
      invocations: [],
      startedAt,
    };
    runs.push(run);
    if (kind === "small") {
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.name','Next saved revision'),draft_rev=draft_rev+1 WHERE id='s8-portfolio'",
      );
      run.sealedRevisionRace = true;
    }
    let status,
      lastSequence = -1,
      lastProgress = Date.now();
    const expires = Date.now() + 300000;
    for (let n = 0; n < 20000; n++) {
      assert.ok(
        Date.now() < expires,
        "Candidate exceeded five-minute measurement deadline",
      );
      const step = await api(remote ? `/status?id=${id}` : `/advance?id=${id}`);
      if (remote) {
        run.polls = (run.polls ?? 0) + 1;
        run.dispatchCheckpoints = step.value.sequence;
        if (step.value.sequence !== lastSequence) {
          lastSequence = step.value.sequence;
          lastProgress = Date.now();
        } else if (Date.now() - lastProgress > 65000) {
          await api(`/sweep?id=${id}`, {});
          run.recoverySweeps = (run.recoverySweeps ?? 0) + 1;
          lastProgress = Date.now();
        }
        await delay(1000);
      } else run.invocations.push(step.counts);
      status = step.value.status;
      if (status === "failed")
        throw new Error(`Candidate failed: ${step.value.last_error}`);
      if (status === "ready") break;
      if (n === 19999) throw new Error("Dispatcher failed to terminate");
    }
    await profiler?.stop(`${kind}-${runs.length}`);
    const output = await request(`/output?id=${id}`),
      html = await output.text(),
      want = expected(draft, id);
    if (html !== want) {
      await writeFile(join(evidence, `${kind}-actual.html`), html);
      await writeFile(join(evidence, `${kind}-expected.html`), want);
    }
    assert.ok(html === want, `${kind} differs from shared offline renderer`);
    run.pages = [];
    const pages = expectedPages(draft, id);
    for (let ordinal = 0; ordinal < pages.length; ordinal++) {
      const response = await request(`/output?id=${id}&page=${ordinal}`),
        html = await response.text();
      assert.equal(response.status, 200);
      assert.ok(
        html === pages[ordinal].html,
        `${kind} page ${ordinal} mismatch`,
      );
      run.pages.push({
        path: pages[ordinal].path,
        bytes: Buffer.byteLength(html),
        sha256: hash(html),
      });
    }
    const copied = (
      await sql(
        "SELECT asset_id,bytes FROM publication_transfer WHERE candidate_id=? AND complete=1",
        [id],
      )
    ).results;
    assert.equal(
      copied.some((asset) => asset.asset_id === "private-face"),
      draft.profile.faceReveal.enabled,
    );
    for (const asset of copied) {
      const response = await request(`/asset?id=${id}&asset=${asset.asset_id}`),
        bytes = new Uint8Array(await response.arrayBuffer());
      assert.equal(hash(bytes), assets.get(asset.asset_id).hash);
    }
    run.status = status;
    run.finishedAt = new Date().toISOString();
    run.outputBytes = Buffer.byteLength(html);
    run.sha256 = hash(html);
    run.assets = copied;
    const privateRefs = assetReferences(draft);
    run.privateAssetInventory = {
      objects: privateRefs.length,
      bytes: privateRefs.reduce((n, ref) => n + assets.get(ref.id).size, 0),
    };
    const objects = (await api(`/objects?id=${id}`)).value;
    run.retained = Object.fromEntries(
      ["sites", "assets"].map((bucket) => [
        bucket,
        {
          objects: objects[bucket].objects.length,
          bytes: objects[bucket].objects.reduce(
            (total, object) => total + object.size,
            0,
          ),
        },
      ]),
    );
    run.privateWorkingState = (
      await sql(
        "SELECT length(cast(source AS blob)) AS sourceBytes,length(cast(cursor AS blob)) AS cursorBytes,coalesce((SELECT length(cast(value AS blob)) FROM publication_candidate_index WHERE candidate_id=publication_candidate.id),0) AS indexBytes FROM publication_candidate WHERE id=?",
        [id],
      )
    ).results[0];
    {
      run.cleanupStartedAt = new Date().toISOString();
      const cleanupSteps = [];
      assert.equal((await api(`/cleanup?id=${id}`)).value, true);
      for (let n = 0; n < 2000; n++) {
        const step = await api(
          remote ? `/status?id=${id}` : `/advance?id=${id}`,
        );
        if (!remote) cleanupSteps.push(step.counts);
        if (step.value.status === "cleaned") break;
        if (remote) await delay(1000);
        assert.ok(n < 1999);
      }
      run.cleanup = cleanupSteps;
      run.cleanupFinishedAt = new Date().toISOString();
    }
    checks.push(
      `${kind}: output parity, ordered wrappers, complete asset copies and disabled-face isolation`,
    );
    console.log(
      `PASS ${kind}: ${run.inputBytes} input bytes, ${remote ? run.dispatchCheckpoints : run.invocations.length} dispatch checkpoints`,
    );
  }
  assert.equal(
    (
      await sql(
        "SELECT published_version FROM portfolio WHERE id='s8-portfolio'",
      )
    ).results[0].published_version,
    null,
  );
  if (!remote && !process.env.S8_PROFILE) {
    let revision = (
      await sql("SELECT draft_rev FROM portfolio WHERE id='s8-portfolio'")
    ).results[0].draft_rev;
    await sql(
      "UPDATE subdomain_claim SET state='claimed',claimed_at=? WHERE name='s8-fixture'",
      [Date.now()],
    );
    await sql(
      "UPDATE portfolio SET status='published',subdomain='s8-fixture',published_version=7 WHERE id='s8-portfolio'",
    );
    await api("/seed-live", {});
    const id = (await api("/create", { revision })).value.id;
    const lease = (await api(`/claim?id=${id}`)).value;
    assert.equal((await api(`/claim?id=${id}`)).value, null);
    await sql("UPDATE publication_candidate SET lease_until=0 WHERE id=?", [
      id,
    ]);
    const newer = (await api(`/claim?id=${id}`)).value;
    assert.notEqual(newer.lease_token, lease.lease_token);
    assert.equal(
      (await api(`/checkpoint?id=${id}`, { row: lease })).value,
      false,
    );
    await sql("UPDATE publication_candidate SET status='failed' WHERE id=?", [
      id,
    ]);
    assert.equal(
      (await api(`/checkpoint?id=${id}`, { row: newer })).value,
      false,
    );
    const denied = await request(`/source-check?id=${id}`, {
      method: "POST",
      body: JSON.stringify({
        candidateId: id,
        leaseToken: newer.lease_token,
        assetId: "avatar",
        purpose: "avatar",
      }),
    });
    assert.equal(denied.status, 404);
    checks.push(
      "Duplicate delivery, expired lease replacement, terminal-state fencing and private source denial",
    );
    await sql("UPDATE publication_candidate SET lease_until=0 WHERE id=?", [
      id,
    ]);
    await api(`/cleanup?id=${id}`);
    for (let n = 0; n < 1000; n++) {
      if ((await api(`/advance?id=${id}`)).value.status === "cleaned") break;
      assert.ok(n < 999);
    }
    const retryId = (await api("/create", { revision })).value.id;
    let sawWriteFailure = false;
    for (let n = 0; n < 30; n++) {
      const response = await request(`/advance?id=${retryId}`, {
          headers: { "X-S8-Fault": "write-after" },
        }),
        data = await response.json();
      if (response.status === 500) {
        assert.match(data.value.error, /injected_post_write/);
        sawWriteFailure = true;
        break;
      }
      assert.equal(response.status, 200);
    }
    assert.ok(sawWriteFailure);
    assert.ok(
      (await api(`/objects?id=${retryId}`)).value.sites.objects.length > 0,
    );
    await sql("UPDATE publication_candidate SET next_attempt_at=0 WHERE id=?", [
      retryId,
    ]);
    for (let n = 0; n < 20000; n++) {
      const step = await api(`/advance?id=${retryId}`);
      if (step.value.status === "transferring") break;
      assert.ok(n < 19999);
    }
    const ticket = (await api(`/claim?id=${retryId}`)).value;
    await sql(
      "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES('unreachable-owned','s8-portfolio','avatar','image/png',128,'ready',?,?)",
      [Date.now(), Date.now()],
    );
    const unreachable = new Uint8Array(128).fill(42);
    unreachable.set([137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(
      (
        await request(
          `/seed-asset?key=${encodeURIComponent("draft/s8-portfolio/unreachable-owned")}`,
          { method: "PUT", body: unreachable },
        )
      ).status,
      200,
    );
    const sourceBody = {
      candidateId: retryId,
      leaseToken: ticket.lease_token,
      assetId: "avatar",
      purpose: "avatar",
    };
    const source = await request(`/source-check?id=${retryId}`, {
      method: "POST",
      body: JSON.stringify(sourceBody),
    });
    assert.equal(source.status, 200);
    assert.equal(
      hash(new Uint8Array(await source.arrayBuffer())),
      assets.get("avatar").hash,
    );
    for (const override of [
      { purpose: "banner" },
      { candidateId: id },
      { assetId: "unreachable-owned", purpose: "avatar" },
      { leaseToken: randomBytes(16).toString("hex") },
    ]) {
      const response = await request(`/source-check?id=${retryId}`, {
        method: "POST",
        body: JSON.stringify({ ...sourceBody, ...override }),
      });
      assert.equal(response.status, 404);
    }
    await sql("UPDATE user SET deleting_at=? WHERE id='s8-owner'", [
      Date.now(),
    ]);
    assert.equal(
      (
        await request(`/source-check?id=${retryId}`, {
          method: "POST",
          body: JSON.stringify(sourceBody),
        })
      ).status,
      404,
    );
    await sql("UPDATE user SET deleting_at=NULL WHERE id='s8-owner'");
    await sql("UPDATE asset SET status='pending' WHERE id='avatar'");
    assert.equal(
      (
        await request(`/source-check?id=${retryId}`, {
          method: "POST",
          body: JSON.stringify(sourceBody),
        })
      ).status,
      404,
    );
    await sql("UPDATE asset SET status='ready' WHERE id='avatar'");
    await sql("UPDATE asset SET bytes=bytes+1 WHERE id='avatar'");
    assert.equal(
      (
        await request(`/source-check?id=${retryId}`, {
          method: "POST",
          body: JSON.stringify(sourceBody),
        })
      ).status,
      404,
    );
    await sql("UPDATE asset SET bytes=bytes-1 WHERE id='avatar'");
    await sql("UPDATE publication_candidate SET lease_until=0 WHERE id=?", [
      retryId,
    ]);
    checks.push(
      "Authorized private source checks reachability, purpose, lease, readiness, size and persisted deletion",
    );
    const recovery = [];
    for (let n = 0; n < 20000; n++) {
      const step = await api(`/advance?id=${retryId}`);
      recovery.push(step.counts);
      if (step.value.status === "ready") break;
      assert.ok(n < 19999);
    }
    const stored = JSON.parse(
      (await sql("SELECT draft FROM portfolio WHERE id='s8-portfolio'"))
        .results[0].draft,
    );
    assert.equal(
      await (await request(`/output?id=${retryId}`)).text(),
      expected(stored, retryId),
    );
    checks.push(
      "A post-write crash replays output without duplication or truncation",
    );
    assert.equal((await api(`/cleanup?id=${retryId}`)).value, true);
    const cleanup = [];
    for (let n = 0; n < 2000; n++) {
      const step = await api(`/advance?id=${retryId}`);
      cleanup.push(step.counts);
      if (step.value.status === "cleaned") break;
      assert.ok(n < 1999);
    }
    const objects = (await api(`/objects?id=${retryId}`)).value;
    assert.equal(
      objects.sites.objects.length + objects.assets.objects.length,
      0,
    );
    const original = await request(
      `/seed-asset?key=${encodeURIComponent("draft/s8-portfolio/avatar")}`,
    );
    assert.equal(original.status, 200);
    assert.equal(
      hash(new Uint8Array(await original.arrayBuffer())),
      assets.get("avatar").hash,
    );
    assert.equal(
      await (await request(`/live?id=${retryId}`)).text(),
      "<p>Previous complete version</p>",
    );
    checks.push(
      "Candidate cleanup removes written outputs and retains private sources and the previous complete version",
    );
    const faultDraft = makeDraft("small");
    await sql(
      "UPDATE portfolio SET draft=?,draft_rev=draft_rev+1 WHERE id='s8-portfolio'",
      [JSON.stringify(faultDraft)],
    );
    revision = (
      await sql("SELECT draft_rev FROM portfolio WHERE id='s8-portfolio'")
    ).results[0].draft_rev;
    async function finish(id, target = "ready") {
      const counts = [];
      for (let n = 0; n < 2000; n++) {
        const step = await api(`/advance?id=${id}`);
        counts.push(step.counts);
        if (step.value.status === target) return counts;
        assert.notEqual(step.value.status, "failed");
      }
      throw new Error(`Candidate did not reach ${target}`);
    }
    for (const fault of [
      "source-truncated",
      "source-interrupted",
      "source-idle",
      "r2-before",
      "r2-after",
      "checkpoint-before",
      "checkpoint-after",
      "delete-during-copy",
    ]) {
      const faultId = (await api("/create", { revision })).value.id;
      assert.equal((await api("/retains?asset=avatar")).value, true);
      const blocked = await request("/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      assert.equal(blocked.status, 500);
      assert.match((await blocked.json()).value.error, /capacity reached/);
      await finish(faultId, "transferring");
      assert.equal(
        (await api("/retains?asset=unreachable-owned")).value,
        false,
      );
      const failed = await request(`/advance?id=${faultId}`, {
        headers: { "X-S8-Fault": fault },
      });
      assert.equal(failed.status, 500, `${fault} must fail`);
      const failure = await failed.json();
      assert.notEqual(
        (await api(`/status?id=${faultId}`)).value.status,
        "ready",
      );
      if (fault === "delete-during-copy")
        await sql("UPDATE user SET deleting_at=NULL WHERE id='s8-owner'");
      await sql(
        "UPDATE publication_candidate SET next_attempt_at=0,lease_until=0 WHERE id=?",
        [faultId],
      );
      const recovery = await finish(faultId);
      assert.equal(
        await (await request(`/output?id=${faultId}`)).text(),
        expected(faultDraft, faultId),
      );
      for (const asset of assetReferences(faultDraft).filter(
        (asset) => asset.id !== "private-face",
      )) {
        const response = await request(
          `/asset?id=${faultId}&asset=${asset.id}`,
        );
        assert.equal(
          hash(new Uint8Array(await response.arrayBuffer())),
          assets.get(asset.id).hash,
        );
      }
      assert.equal((await api(`/cleanup?id=${faultId}`)).value, true);
      if (fault === "r2-after") {
        const deletion = await request(`/advance?id=${faultId}`, {
          headers: { "X-S8-Fault": "cleanup-delete" },
        });
        assert.equal(deletion.status, 500);
        await sql(
          "UPDATE publication_candidate SET next_attempt_at=0 WHERE id=?",
          [faultId],
        );
      }
      const cleanup = await finish(faultId, "cleaned");
      const state = (
        await sql(
          "SELECT source,owner_id,portfolio_id FROM publication_candidate WHERE id=?",
          [faultId],
        )
      ).results[0];
      assert.deepEqual(state, { source: null, owner_id: "", portfolio_id: "" });
      assert.equal(
        (
          await sql(
            "SELECT count(*) AS n FROM publication_candidate_index WHERE candidate_id=?",
            [faultId],
          )
        ).results[0].n,
        0,
      );
      runs.push({
        kind: `fault-${fault}`,
        failed: [failure.counts],
        invocations: recovery,
        cleanup,
      });
      checks.push(
        `${fault}: bounded failure, exact replay, source retention and cleanup`,
      );
    }
    const failedCleanup = (await api("/create", { revision })).value.id;
    await finish(failedCleanup);
    await api(`/cleanup?id=${failedCleanup}`);
    for (let n = 0; n < 4; n++) {
      const response = await request(`/advance?id=${failedCleanup}`, {
        headers: { "X-S8-Fault": "cleanup-delete" },
      });
      assert.equal(response.status, 500);
      await sql(
        "UPDATE publication_candidate SET next_attempt_at=0 WHERE id=?",
        [failedCleanup],
      );
    }
    await api(`/sweep?id=${failedCleanup}`);
    const failedState = (
      await sql(
        "SELECT status,source,owner_id,portfolio_id,last_error FROM publication_candidate WHERE id=?",
        [failedCleanup],
      )
    ).results[0];
    assert.deepEqual(failedState, {
      status: "failed",
      source: null,
      owner_id: "",
      portfolio_id: "",
      last_error: "cleanup:exhausted",
    });
    assert.equal(
      (await api(`/advance?id=${failedCleanup}`)).value.claimed,
      false,
    );
    assert.equal((await api(`/cleanup?id=${failedCleanup}`)).value, true);
    await finish(failedCleanup, "cleaned");
    checks.push(
      "Exhausted cleanup retains only its output cleanup capability, scrubs source/identity, stops redelivery and supports an explicit retry",
    );
    const capIds = Array.from({ length: 4 }, () => crypto.randomUUID());
    const insertCap = async (ids, source) =>
      sql(
        "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,status,cursor,next_attempt_at,deadline_at,created_at,updated_at) SELECT value,'cap-fixture','cap-fixture',0,?,'failed','[]',0,0,0,0 FROM json_each(?)",
        [source, JSON.stringify(ids)],
      );
    await insertCap(capIds, "{}");
    let capacity = await request("/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision }),
    });
    assert.equal(capacity.status, 500);
    assert.match((await capacity.json()).value.error, /capacity reached/);
    await sql("DELETE FROM publication_candidate WHERE owner_id='cap-fixture'");
    const existing = (
      await sql("SELECT count(*) AS n FROM publication_candidate")
    ).results[0].n;
    await insertCap(
      Array.from({ length: 128 - existing }, () => crypto.randomUUID()),
      null,
    );
    capacity = await request("/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision }),
    });
    assert.equal(capacity.status, 500);
    assert.match((await capacity.json()).value.error, /capacity reached/);
    await sql("DELETE FROM publication_candidate WHERE owner_id='cap-fixture'");
    const raced = await Promise.all(
      [0, 1].map(() =>
        request("/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision }),
        }),
      ),
    );
    assert.deepEqual(
      raced.map((response) => response.status).sort(),
      [200, 500],
    );
    const winner = await raced
      .find((response) => response.status === 200)
      .json();
    await sql("UPDATE publication_candidate SET status='failed' WHERE id=?", [
      winner.value.id,
    ]);
    await api(`/cleanup?id=${winner.value.id}`);
    await finish(winner.value.id, "cleaned");
    checks.push(
      "Atomic admission enforces one source per portfolio, four global sources and 128 retained records under concurrent creation",
    );
    const retained = (await api("/create", { revision })).value.id;
    await finish(retained);
    await sql("UPDATE publication_candidate SET updated_at=? WHERE id=?", [
      Date.now() - 3600001,
      retained,
    ]);
    await api(`/sweep?id=${retained}`);
    assert.equal((await api(`/status?id=${retained}`)).value.status, "failed");
    await sql("UPDATE publication_candidate SET updated_at=0 WHERE id=?", [
      retained,
    ]);
    await api(`/sweep?id=${retained}`);
    await finish(retained, "cleaned");
    await sql(
      "UPDATE publication_candidate SET cleaned_at=?,next_attempt_at=0 WHERE id=?",
      [Date.now() - 86400001, retained],
    );
    for (let n = 0; n < 40; n++) {
      await api(`/sweep?id=${retained}`);
      if ((await api(`/status?id=${retained}`)).value === null) break;
      assert.ok(n < 39);
    }
    checks.push(
      "Ready sources expire, cleaned metadata and owner identifiers are removed, and tombstones physically retire",
    );
    const legacy = (await api("/create", { revision })).value.id;
    await sql(
      "UPDATE publication_candidate SET renderer_version='s8-v2',status='failed',cursor='{\"old_format\":true}' WHERE id=?",
      [legacy],
    );
    assert.equal((await api(`/cleanup?id=${legacy}`)).value, true);
    await finish(legacy, "cleaned");
    const legacyTime = Date.now() - 23 * 3600000;
    await sql(
      "UPDATE publication_candidate SET cleaned_at=NULL,updated_at=?,next_attempt_at=0 WHERE id=?",
      [legacyTime, legacy],
    );
    await api(`/sweep?id=${legacy}`);
    assert.equal(
      (
        await sql("SELECT cleaned_at FROM publication_candidate WHERE id=?", [
          legacy,
        ])
      ).results[0].cleaned_at,
      legacyTime,
    );
    await sql(
      "UPDATE publication_candidate SET cleaned_at=?,next_attempt_at=0 WHERE id=?",
      [legacyTime - 2 * 3600000, legacy],
    );
    await api(`/sweep?id=${legacy}`);
    assert.equal((await api(`/status?id=${legacy}`)).value, null);
    checks.push(
      "Older renderer/cursor cleanup remains supported and legacy tombstone sweeps preserve their original retention age",
    );
    const lostId = (await api("/create", { revision })).value.id;
    const lost = await request(`/advance?id=${lostId}`, {
      headers: { "X-S8-Fault": "queue-after" },
    });
    assert.equal(lost.status, 500);
    assert.ok((await api(`/status?id=${lostId}`)).value.sequence > 0);
    assert.ok((await api(`/sweep?id=${lostId}`)).value.woken > 0);
    await sql(
      "UPDATE publication_candidate SET attempts=3,lease_until=0,next_attempt_at=0 WHERE id=?",
      [lostId],
    );
    const lastAttempt = (await api(`/claim?id=${lostId}`)).value;
    assert.equal(lastAttempt.attempts, 4);
    await api(`/sweep?id=${lostId}`);
    assert.equal((await api(`/status?id=${lostId}`)).value.status, "preparing");
    await sql("UPDATE publication_candidate SET lease_until=0 WHERE id=?", [
      lostId,
    ]);
    await api(`/sweep?id=${lostId}`);
    assert.equal((await api(`/status?id=${lostId}`)).value.status, "failed");
    assert.equal((await api(`/advance?id=${lostId}`)).value.claimed, false);
    checks.push(
      "Lost enqueue acknowledgements recover through sweep and crashed attempts terminate at the persisted limit",
    );
    assert.equal(
      (
        await sql(
          "SELECT published_version FROM portfolio WHERE id='s8-portfolio'",
        )
      ).results[0].published_version,
      7,
    );
    assert.equal(
      (await sql("SELECT state FROM subdomain_claim WHERE name='s8-fixture'"))
        .results[0].state,
      "claimed",
    );
    runs.push({ kind: "recovery-cleanup", invocations: recovery, cleanup });
    await sql("UPDATE publication_candidate SET lease_until=0 WHERE id=?", [
      lostId,
    ]);
    await api(`/cleanup?id=${lostId}`);
    for (let n = 0; n < 1000; n++) {
      if ((await api(`/advance?id=${lostId}`)).value.status === "cleaned")
        break;
      assert.ok(n < 999);
    }
    const deletedId = (await api("/create", { revision })).value.id;
    await sql("DELETE FROM user WHERE id='s8-owner'");
    for (let n = 0; n < 10; n++) {
      await api(`/sweep?id=${retryId}`);
      await sql(
        "UPDATE publication_candidate SET updated_at=0,lease_until=0 WHERE status='failed'",
      );
    }
    const deletedCandidate = (await api(`/status?id=${deletedId}`)).value;
    assert.equal(deletedCandidate.status, "cleaning");
    for (let n = 0; n < 1000; n++) {
      const step = await api(`/advance?id=${deletedId}`);
      if (step.value.status === "cleaned") break;
      assert.ok(n < 999);
    }
    assert.equal(
      (
        await sql(
          "SELECT source,owner_id,portfolio_id FROM publication_candidate WHERE id=?",
          [deletedId],
        )
      ).results[0].source,
      null,
    );
    const deletedObjects = (await api(`/objects?id=${deletedId}`)).value;
    assert.equal(
      deletedObjects.sites.objects.length +
        deletedObjects.assets.objects.length,
      0,
    );
    checks.push(
      "Owner deletion fences retained ready candidates and permits bounded cleanup after owner removal",
    );
  }
  checks.push(
    "Preparation, replay and cleanup preserve the seeded pointer and claim before account deletion",
  );
  console.log(`PASS ${checks.length} S-8 integration groups`);
} catch (error) {
  await writeFile(join(evidence, "failure.txt"), String(error.stack));
  throw error;
} finally {
  profiler?.close();
  child?.kill("SIGTERM");
  await writeFile(join(evidence, "runtime.log"), logs);
  await writeFile(
    join(evidence, "results.json"),
    `${JSON.stringify({ recordedAt: new Date().toISOString(), checks, runs, sweeps, limitations: ["Local workerd counters are not provider CPU proof.", "Separate boundary review and owner completion approval pending."] }, null, 2)}\n`,
  );
  console.log(`Evidence: ${evidence}`);
}
