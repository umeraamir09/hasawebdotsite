import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPublicationPlatform } from "../../scripts/build-publication-platform.mjs";
import { createEvidenceDirectory } from "../support/evidence-directory.mjs";
import { freePort } from "../support/ports.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
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
const commitMode = process.argv.includes("--commit-serving");
const remoteState = remote
  ? JSON.parse(
      await readFile(join(root, ".wrangler/s8-provider/state.json"), "utf8"),
    )
  : null;
const runtimeKey = remoteState?.runtimeKey ?? randomBytes(32).toString("hex"),
  secret = remoteState?.secret ?? randomBytes(32).toString("hex"),
  token = randomBytes(24).toString("hex");
const cookie = `__Host-hasaweb.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`)}`;
const port = await freePort();
const origin = remoteState?.origin ?? `http://127.0.0.1:${port}`;
let child,
  logs = "";
const checks = [],
  runs = [],
  sweeps = [],
  preparedForCommit = [];
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
async function commitPublication(command) {
  const response = await request("/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  return { status: response.status, ...(await response.json()) };
}
function visitor(url, options = {}) {
  return request("/serve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, ...options }),
  });
}
// Phase 49: deleting the account ends public access at once and keeps the
// published address only as an ownerless claim. Its cleanup removes every
// candidate's output, the private uploads and the account rows, waits for
// recent upload activity, and outlives the owner until the end.
async function checkAccountDeletion() {
  const live = preparedForCommit[2];
  const publicUrls = [
    "https://s8-fixture.hasaweb.site/",
    "https://s8-fixture.hasaweb.site/resume",
    "https://s8-fixture.hasaweb.site/sitemap.xml",
    "https://s8-fixture.hasaweb.site/_/github.json",
    "https://s8-fixture.hasaweb.site/_/contact",
    ...live.manifest.files
      .filter((file) => file.path.startsWith("/assets/"))
      .map(
        (file) => `https://s8-assets.invalid/candidate/${live.id}${file.path}`,
      ),
  ];
  assert.equal((await visitor(publicUrls[0])).status, 200);
  const candidates = (
    await sql(
      "SELECT id FROM publication_candidate WHERE portfolio_id='s8-portfolio'",
    )
  ).results.map((row) => row.id);
  assert.ok(candidates.length >= 3, JSON.stringify(candidates));
  const drafts = async () => (await api("/draft-objects")).length;
  const objects = async () => {
    let count = 0;
    for (const candidate of candidates) {
      const found = (await api(`/objects?id=${candidate}`)).value;
      count += found.sites.objects.length + found.assets.objects.length;
    }
    return count;
  };
  assert.ok((await objects()) > 0);
  assert.ok((await drafts()) > 0);
  const deleted = await api("/delete-account", {});
  const deletionId = deleted.value.deletionId;
  assert.match(deletionId, /^[0-9a-f-]{36}$/);
  // The session is gone, so the same cookie cannot repeat or undo it.
  const repeated = await request("/delete-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(repeated.status, 401);
  for (const url of publicUrls) {
    const response = await visitor(url);
    assert.equal(response.status, 404, url);
    assert.match(response.headers.get("Cache-Control"), /no-store/, url);
  }
  assert.deepEqual(
    (
      await sql(
        "SELECT portfolio_id,state FROM subdomain_claim WHERE name='s8-fixture'",
      )
    ).results,
    [{ portfolio_id: null, state: "claimed" }],
  );
  assert.equal(
    (await sql("SELECT count(*) AS n FROM session WHERE user_id='s8-owner'"))
      .results[0].n,
    0,
  );
  // Recent upload activity holds back removal of the private prefix.
  await sql(
    "UPDATE asset SET updated_at=? WHERE id=(SELECT id FROM asset WHERE portfolio_id='s8-portfolio' LIMIT 1)",
    [Date.now()],
  );
  const stages = [];
  let waitedForUploads = false;
  for (let n = 0; n < 500; n++) {
    const before = (
      await sql("SELECT stage FROM account_deletion WHERE id=?", [deletionId])
    ).results[0]?.stage;
    if (before && stages.at(-1) !== before) stages.push(before);
    const step = (await api(`/run-deletion?id=${deletionId}`)).value;
    if (step.stage === "done") break;
    for (const wake of step.woken)
      if (wake.candidateId)
        for (let m = 0; m < 50; m++) {
          const batch = await api(`/advance?id=${wake.candidateId}`);
          if (!batch.value.claimed || batch.value.status === "cleaned") break;
        }
    if (step.stage === false) {
      if (before === "draft" && !waitedForUploads) {
        waitedForUploads = true;
        assert.ok((await drafts()) > 0);
        await sql(
          "UPDATE asset SET created_at=created_at-600000,updated_at=updated_at-600000 WHERE portfolio_id='s8-portfolio'",
        );
      }
      // Skip the five-second wait the queue delay would provide.
      await sql("UPDATE account_deletion SET next_attempt_at=0 WHERE id=?", [
        deletionId,
      ]);
    }
    assert.ok(n < 499, JSON.stringify(stages.slice(-20)));
  }
  assert.ok(waitedForUploads, JSON.stringify(stages));
  for (const stage of [
    "public",
    "purge",
    "verify",
    "candidates",
    "draft",
    "rows",
    "final",
  ])
    assert.ok(stages.includes(stage), stage);
  assert.equal(await objects(), 0);
  assert.equal(await drafts(), 0);
  for (const query of [
    "SELECT count(*) AS n FROM user WHERE id='s8-owner'",
    "SELECT count(*) AS n FROM portfolio WHERE id='s8-portfolio'",
    "SELECT count(*) AS n FROM asset WHERE portfolio_id='s8-portfolio'",
    "SELECT count(*) AS n FROM publish_version WHERE portfolio_id='s8-portfolio'",
    "SELECT count(*) AS n FROM publication_candidate WHERE portfolio_id='s8-portfolio' OR owner_id='s8-owner'",
    "SELECT count(*) AS n FROM account_deletion",
  ])
    assert.equal((await sql(query)).results[0].n, 0, query);
  // The published name stays permanently unavailable to every account.
  assert.deepEqual(
    (
      await sql(
        "SELECT portfolio_id,state FROM subdomain_claim WHERE name='s8-fixture'",
      )
    ).results,
    [{ portfolio_id: null, state: "claimed" }],
  );
  await assert.rejects(
    sql(
      "INSERT INTO subdomain_claim(name,state,held_at) VALUES('s8-fixture','held',?)",
      [Date.now()],
    ),
  );
  for (const url of publicUrls)
    assert.equal((await visitor(url)).status, 404, url);
  checks.push(
    "Account deletion: immediate public and session denial, ownerless published claim, upload quiet wait, complete output, upload and row cleanup",
  );
}
// Phase 46: a served page's <head>, with the sharing tags it advertises.
async function servedHead(url) {
  const response = await visitor(url);
  const html = await response.text();
  // The unavailable page has no explicit <head>; read the whole document.
  const end = html.indexOf("</head>");
  const head = end < 0 ? html : html.slice(0, end + 7);
  const meta = (attribute, key) =>
    new RegExp(`<meta ${attribute}="${key}" content="([^"]*)">`).exec(
      head,
    )?.[1];
  return {
    response,
    html,
    head,
    title: /<title>([^<]*)<\/title>/.exec(head)?.[1],
    canonical: /<link rel="canonical" href="([^"]*)">/.exec(head)?.[1],
    description: meta("name", "description"),
    og: (key) => meta("property", `og:${key}`),
    card: meta("name", "twitter:card"),
  };
}
function assertIndexable(page, url) {
  assert.equal(page.response.status, 200, url);
  assert.equal(page.response.headers.get("X-Robots-Tag"), null, url);
  assert.ok(!/noindex|name="robots"/.test(page.head), url);
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
await buildPublicationPlatform(join(directory, "platform"));
const jobs = {
  assets: {
    directory: join(directory, "platform"),
    binding: "PLATFORM_ASSETS",
    run_worker_first: true,
  },
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
        String(port),
        "--inspector-port",
        "0",
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
  await sql(
    "INSERT INTO contact_recipient(portfolio_id,email,verified_at) VALUES('s8-portfolio','PRIVATE_RECIPIENT@example.test',?)",
    [now],
  );
  const assets = new Map();
  for (const kind of (
    process.env.S8_CASES ??
    "small,mixed,privacy,unicode,surrogate,surrogate-boundary,description,deep,dense,hands,cat,face,cat-face,assets,assets-face,max"
  ).split(",")) {
    const draft = makeDraft(kind);
    if (commitMode && kind === "small") {
      draft.profile.faceReveal.enabled = true;
      // Owner overrides, with characters that must be escaped.
      draft.seo = {
        title: 'Owner "title" <one> & co',
        description: "Shared & described <here>",
        ogImage: { assetId: "sharing-image" },
      };
    }
    if (commitMode && kind === "cat") {
      const projects = draft.components.find(
        (item) => item.type === "projects",
      );
      delete projects.data.entries[0].image;
      // Version 3 removes the case study that version 2 published.
      delete projects.data.entries[0].caseStudy;
    }
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
    if (kind === "small" && !commitMode) {
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
    const getFile = (key, bucket = "sites") =>
      request(`/file?id=${id}&key=${encodeURIComponent(key)}&bucket=${bucket}`);
    const manifestResponse = await getFile(`candidate/${id}/manifest.json`);
    assert.equal(manifestResponse.status, 200);
    const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.format, "hasaweb-candidate-v1");
    assert.equal(manifest.candidateId, id);
    assert.equal(manifest.sourceRevision, revision);
    assert.equal(manifest.rendererVersion, "publication-v8");
    const seal = (
      await sql(
        "SELECT json_extract(value,'$.manifest') AS seal,json_extract(value,'$.contact') AS contact FROM publication_candidate_index WHERE candidate_id=?",
        [id],
      )
    ).results[0];
    // Phase 44: `/_/contact` accepts posts only for a version with a form.
    assert.equal(
      seal.contact,
      draft.components.some(
        (component) =>
          component.type === "contact" &&
          !draft.samples[`components.${component.id}`],
      )
        ? 1
        : null,
    );
    assert.deepEqual(JSON.parse(seal.seal), {
      key: `candidate/${id}/manifest.json`,
      bytes: manifestBytes.length,
      sha256: hash(manifestBytes),
    });
    assert.equal(
      new Set(manifest.files.map((file) => file.key)).size,
      manifest.files.length,
    );
    for (const file of manifest.files) {
      const response = await getFile(file.key, file.bucket);
      assert.equal(response.status, 200, file.key);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.length, file.bytes, file.key);
      assert.equal(hash(bytes), file.sha256, file.key);
      if (file.path === "snapshot.json") {
        const snapshot = JSON.parse(bytes);
        assert.deepEqual(
          Object.keys(snapshot).sort(),
          [
            "schemaVersion",
            "profile",
            "links",
            "components",
            "appearance",
            "seo",
          ].sort(),
        );
        assert.equal(snapshot.profile.name, draft.profile.name);
        assert.ok(!bytes.toString().includes("PRIVATE_RECIPIENT"));
        assert.ok(!bytes.toString().includes("PRIVATE_SAMPLE"));
        assert.ok(!bytes.toString().includes("PRIVATE_EMAIL"));
        assert.equal(
          snapshot.profile.faceReveal.image !== undefined,
          draft.profile.faceReveal.enabled,
        );
        assert.ok(
          snapshot.components.every((component) => !component.data.recipientId),
        );
        assert.ok(
          snapshot.components.every(
            (component) => !draft.samples[`components.${component.id}`],
          ),
        );
      }
      const page = pages.find((page) => page.path === file.path);
      if (page) {
        const document = bytes.toString();
        assert.ok(document.startsWith("<!doctype html><html"));
        assert.ok(document.endsWith("</body></html>"));
        assert.ok(
          document.includes(
            `<main id="portfolio-content" tabindex="-1">${page.html}</main>`,
          ),
        );
        assert.equal((document.match(/<script/g) ?? []).length, 1);
        // Saved appearance is on <html>; the platform script is
        // render-blocking in <head> and never inline.
        assert.ok(
          document.startsWith(
            '<!doctype html><html lang="en" data-theme="leaf" data-font="dm-sans" data-initial-mode="system"><head>',
          ),
        );
        assert.match(
          document,
          /<script src="\/platform\/[a-f0-9]+\.js"><\/script><\/head>/,
        );
        // Every page names its own canonical address and allows indexing.
        assert.ok(
          document.includes(
            `<link rel="canonical" href="https://s8-fixture.hasaweb.site${page.path}">`,
          ),
          page.path,
        );
        assert.ok(!/noindex|name="robots"/.test(document), page.path);
      }
      assert.ok(!/portrait|reference|raw|generator|source-map/.test(file.path));
    }
    const art = manifest.files.filter((file) => file.path.endsWith(".webp"));
    assert.equal(art.length, kind === "cat" || kind === "cat-face" ? 2 : 0);
    assert.equal(
      manifest.files.filter((file) => file.path.endsWith(".ttf")).length,
      1,
    );
    for (const path of ["/404", "/robots.txt", "/sitemap.xml", "snapshot.json"])
      assert.ok(
        manifest.files.some((file) => file.path === path),
        path,
      );
    run.manifest = {
      files: manifest.files.length,
      bytes: manifestBytes.length,
      sha256: hash(manifestBytes),
    };
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
    if (commitMode) {
      preparedForCommit.push({ id, html: pages[0].html, manifest, copied });
      const publicUrl = "https://s8-fixture.hasaweb.site/";
      const command = (candidate, expectedVersion, expectedStatus) => ({
        portfolioId: "s8-portfolio",
        candidateId: candidate.id,
        expectedVersion,
        expectedStatus,
      });
      if (preparedForCommit.length === 1) {
        assert.equal((await visitor(publicUrl)).status, 404);
        assert.equal(
          (
            await visitor(
              `https://s8-assets.invalid/candidate/${id}/assets/avatar`,
            )
          ).status,
          404,
        );
        await sql("INSERT INTO reserved_subdomain(name) VALUES('s8-fixture')");
        const unavailable = await commitPublication(
          command(preparedForCommit[0], null, "draft"),
        );
        assert.equal(unavailable.status, 409);
        assert.equal(unavailable.value.code, "unavailable_address");
        assert.deepEqual(
          (
            await sql(
              "SELECT status,published_version FROM portfolio WHERE id='s8-portfolio'",
            )
          ).results[0],
          { status: "draft", published_version: null },
        );
        assert.equal(
          (
            await sql(
              "SELECT state FROM subdomain_claim WHERE name='s8-fixture'",
            )
          ).results[0].state,
          "held",
        );
        assert.equal(
          (
            await sql(
              "SELECT count(*) AS n FROM publish_version WHERE portfolio_id='s8-portfolio'",
            )
          ).results[0].n,
          0,
        );
        await sql("DELETE FROM reserved_subdomain WHERE name='s8-fixture'");
        await sql(
          "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('s8-other','Other owner','other@example.test',1,?,?)",
          [Date.now(), Date.now()],
        );
        await sql(
          "INSERT INTO portfolio(id,user_id,status,draft,created_at,updated_at) VALUES('s8-other-portfolio','s8-other','draft','{}',?,?)",
          [Date.now(), Date.now()],
        );
        await sql(
          "DELETE FROM subdomain_claim WHERE name='s8-fixture' AND state='held'",
        );
        await sql(
          "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES('s8-fixture','s8-other-portfolio','held',?)",
          [Date.now()],
        );
        const wrongHolder = await commitPublication(
          command(preparedForCommit[0], null, "draft"),
        );
        assert.equal(wrongHolder.status, 409);
        assert.equal(wrongHolder.value.code, "unavailable_address");
        assert.equal(
          (
            await sql(
              "SELECT portfolio_id,state FROM subdomain_claim WHERE name='s8-fixture'",
            )
          ).results[0].portfolio_id,
          "s8-other-portfolio",
        );
        assert.equal(
          (
            await sql(
              "SELECT published_version FROM portfolio WHERE id='s8-portfolio'",
            )
          ).results[0].published_version,
          null,
        );
        await sql(
          "DELETE FROM subdomain_claim WHERE name='s8-fixture' AND state='held'",
        );
        await sql(
          "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES('s8-fixture','s8-portfolio','held',?)",
          [Date.now()],
        );
        const concurrent = await Promise.all([
          commitPublication(command(preparedForCommit[0], null, "draft")),
          commitPublication(command(preparedForCommit[0], null, "draft")),
        ]);
        for (const committed of concurrent) {
          assert.equal(committed.status, 200, JSON.stringify(committed));
          assert.equal(committed.value.version, 1);
        }
        assert.deepEqual(
          concurrent.map((result) => result.value.replayed).sort(),
          [false, true],
        );
        assert.equal(
          (
            await sql(
              "SELECT state FROM subdomain_claim WHERE name='s8-fixture'",
            )
          ).results[0].state,
          "claimed",
        );
        // Phase 46: served metadata matches the owner's published overrides.
        const home = await servedHead(publicUrl);
        assertIndexable(home, publicUrl);
        assert.equal(
          home.title,
          "Owner &quot;title&quot; &lt;one&gt; &amp; co",
        );
        assert.equal(home.og("title"), home.title);
        assert.equal(home.description, "Shared &amp; described &lt;here&gt;");
        assert.equal(home.og("description"), home.description);
        assert.equal(home.canonical, publicUrl);
        assert.equal(home.og("url"), publicUrl);
        assert.equal(home.og("type"), "website");
        const sharingUrl = `https://s8-assets.invalid/candidate/${id}/assets/sharing-image`;
        assert.equal(home.og("image"), sharingUrl);
        assert.equal(home.card, "summary_large_image");
        assert.equal((await visitor(sharingUrl)).status, 200);
        const robots = await visitor(
          "https://s8-fixture.hasaweb.site/robots.txt",
        );
        assert.equal(
          await robots.text(),
          "User-agent: *\nAllow: /\nSitemap: https://s8-fixture.hasaweb.site/sitemap.xml\n",
        );
        assert.equal(
          await (
            await visitor("https://s8-fixture.hasaweb.site/sitemap.xml")
          ).text(),
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://s8-fixture.hasaweb.site/</loc></url></urlset>',
        );
        const oldPage = await visitor(publicUrl);
        assert.equal(oldPage.status, 200);
        assert.ok((await oldPage.text()).includes(preparedForCommit[0].html));
        assert.equal(oldPage.headers.get("Cache-Control"), "no-store");
        const platform = manifest.files.find((file) =>
          file.path.endsWith(".css"),
        );
        assert.ok(platform);
        assert.equal(
          (await visitor(`https://s8-fixture.hasaweb.site${platform.path}`))
            .status,
          200,
          platform.path,
        );
        const asset = manifest.files.find((file) =>
          file.path.startsWith("/assets/"),
        );
        assert.ok(asset);
        const assetUrl = `https://s8-assets.invalid/candidate/${id}${asset.path}`;
        const file = await visitor(assetUrl);
        assert.equal(file.status, 200);
        assert.equal(file.headers.get("Cache-Control"), "no-store");
        assert.equal((await visitor(assetUrl, { method: "HEAD" })).status, 200);
        assert.equal(
          (await visitor(assetUrl, { ifNoneMatch: file.headers.get("ETag") }))
            .status,
          304,
        );
        assert.equal((await visitor(`${assetUrl}?variant=warm`)).status, 200);
        for (const url of [
          `https://s8-assets.invalid/candidate/${id}/snapshot.json`,
          `https://s8-fixture.hasaweb.site/_/github.json`,
          `https://s8-fixture.hasaweb.site/api/assets/avatar`,
          `https://unknown.hasaweb.site/`,
          `https://www.hasaweb.site/`,
        ])
          assert.equal((await visitor(url)).status, 404, url);
        const changedCommand = await commitPublication(
          command(preparedForCommit[0], 1, "published"),
        );
        assert.equal(changedCommand.status, 409);
        assert.equal(changedCommand.value.code, "command_conflict");
      } else if (preparedForCommit.length === 2) {
        const first = preparedForCommit[0];
        const stale = await commitPublication(
          command(preparedForCommit[1], null, "draft"),
        );
        assert.equal(stale.status, 409);
        assert.equal(stale.value.code, "stale_publication");
        const raced = await Promise.all([
          ...Array.from({ length: 8 }, () => visitor(publicUrl)),
          commitPublication(command(preparedForCommit[1], 1, "published")),
        ]);
        const committed = raced.at(-1);
        assert.equal(committed.status, 200, JSON.stringify(committed));
        assert.equal(committed.value.version, 2);
        for (const response of raced.slice(0, -1)) {
          assert.equal(response.status, 200);
          const body = await response.text();
          assert.ok(
            body.includes(first.html) ||
              body.includes(preparedForCommit[1].html),
          );
        }
        const newPage = await visitor(publicUrl);
        assert.equal(newPage.status, 200);
        assert.ok((await newPage.text()).includes(preparedForCommit[1].html));
        // Phase 46: without overrides, metadata comes from the profile, and
        // case studies and the resume name the portfolio in their titles.
        const cardUrl = `https://s8-assets.invalid/candidate/${id}/assets/sharing-card`;
        const description = "I build &lt;tools&gt; &amp; interfaces. 😀";
        for (const [path, title] of [
          ["/", "عمر Example"],
          ["/projects/project", "Project · عمر Example"],
          ["/resume", "Resume · عمر Example"],
        ]) {
          const url = `https://s8-fixture.hasaweb.site${path}`;
          const page = await servedHead(url);
          assertIndexable(page, url);
          assert.equal(page.title, title, path);
          assert.equal(page.og("title"), title, path);
          assert.equal(page.description, description, path);
          assert.equal(page.canonical, url, path);
          assert.equal(page.og("url"), url, path);
          assert.equal(page.og("image"), cardUrl, path);
          assert.equal(
            page.og("image:alt"),
            "عمر Example&#39;s portfolio profile",
            path,
          );
        }
        // The generated profile card is a 1200x630 PNG public asset.
        const card = await visitor(cardUrl);
        assert.equal(card.status, 200);
        assert.equal(card.headers.get("Content-Type"), "image/png");
        const cardBytes = Buffer.from(await card.arrayBuffer());
        assert.deepEqual(
          [cardBytes.readUInt32BE(16), cardBytes.readUInt32BE(20)],
          [1200, 630],
        );
        assert.equal(
          await (
            await visitor("https://s8-fixture.hasaweb.site/sitemap.xml")
          ).text(),
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://s8-fixture.hasaweb.site/</loc></url><url><loc>https://s8-fixture.hasaweb.site/projects/project</loc></url><url><loc>https://s8-fixture.hasaweb.site/resume</loc></url></urlset>',
        );
        // The replaced sharing image is no longer public.
        assert.equal(
          (
            await visitor(
              `https://s8-assets.invalid/candidate/${preparedForCommit[0].id}/assets/sharing-image`,
            )
          ).status,
          404,
        );
        for (const file of manifest.files) {
          if (file.path === "snapshot.json") continue;
          const url = file.path.startsWith("/assets/")
            ? `https://s8-assets.invalid/candidate/${id}${file.path}`
            : `https://s8-fixture.hasaweb.site${file.path}`;
          const response = await visitor(url);
          assert.equal(
            response.status,
            file.path === "/404" ? 404 : 200,
            file.path,
          );
          assert.equal(
            response.headers.get("Content-Type"),
            file.contentType,
            file.path,
          );
        }
        const oldPlatform = first.manifest.files.find((file) =>
          file.path.endsWith(".css"),
        );
        const oldAsset = first.manifest.files.find((file) =>
          file.path.startsWith("/assets/"),
        );
        assert.equal(
          (await visitor(`https://s8-fixture.hasaweb.site${oldPlatform.path}`))
            .status,
          200,
        );
        assert.equal(
          (
            await visitor(
              `https://s8-assets.invalid/candidate/${first.id}${oldAsset.path}`,
            )
          ).status,
          200,
        );
        const removedFaceUrl = `https://s8-assets.invalid/candidate/${first.id}/assets/private-face`;
        assert.equal((await visitor(removedFaceUrl)).status, 404);
        assert.equal(
          (await visitor(`${removedFaceUrl}?variant=warm`)).status,
          404,
        );
        const replay = await commitPublication(command(first, null, "draft"));
        assert.equal(replay.status, 200);
        assert.equal(replay.value.replayed, true);
        assert.equal(replay.value.version, 1);
        assert.equal(
          (
            await sql(
              "SELECT published_version FROM portfolio WHERE id='s8-portfolio'",
            )
          ).results[0].published_version,
          2,
        );
      } else if (preparedForCommit.length === 3) {
        // Phase 48: the owner's Unpublish ends every public route at once,
        // keeps the claim and draft, and its cleanup deletes public objects.
        const first = preparedForCommit[0];
        const oldAsset = first.manifest.files.find((file) =>
          file.path.startsWith("/assets/"),
        );
        const oldAssetUrl = `https://s8-assets.invalid/candidate/${first.id}${oldAsset.path}`;
        const live = preparedForCommit[1];
        const liveAssets = live.manifest.files
          .filter((file) => file.path.startsWith("/assets/"))
          .map(
            (file) =>
              `https://s8-assets.invalid/candidate/${live.id}${file.path}`,
          );
        const livePages = live.manifest.files
          .filter(
            (file) =>
              // Private files such as snapshot.json have no visitor route.
              file.path.startsWith("/") &&
              !file.path.startsWith("/assets/") &&
              !file.path.startsWith("/platform/") &&
              !file.path.startsWith("/portfolio-platform/"),
          )
          .map((file) => `https://s8-fixture.hasaweb.site${file.path}`);
        assert.ok(
          livePages.includes("https://s8-fixture.hasaweb.site/resume"),
          JSON.stringify(livePages),
        );
        assert.ok(
          livePages.some((url) => url.includes("/projects/")),
          JSON.stringify(livePages),
        );
        for (const url of [
          publicUrl,
          ...livePages.filter((url) => !url.endsWith("/404")),
          ...liveAssets,
        ])
          assert.equal((await visitor(url)).status, 200, url);
        const draftBefore = (
          await sql(
            "SELECT draft,draft_rev FROM portfolio WHERE id='s8-portfolio'",
          )
        ).results[0];
        const unpublishResponse = await request("/unpublish", {
          method: "POST",
        });
        const unpublished = await unpublishResponse.json();
        assert.equal(
          unpublishResponse.status,
          200,
          JSON.stringify(unpublished),
        );
        assert.deepEqual(unpublished.value.site, {
          portfolioId: "s8-portfolio",
          status: "unpublished",
          url: "https://s8-fixture.hasaweb.site",
          withdrawal: { retrying: false },
        });
        const withdrawalId = unpublished.value.woken[0].withdrawalId;
        // A repeated request is the same unpublish, not a second cleanup.
        const repeated = await (
          await request("/unpublish", { method: "POST" })
        ).json();
        assert.equal(repeated.value.woken[0].withdrawalId, withdrawalId);
        assert.equal(
          (
            await sql(
              "SELECT count(*) AS n FROM publication_withdrawal WHERE portfolio_id='s8-portfolio'",
            )
          ).results[0].n,
          1,
        );
        for (const url of [
          publicUrl,
          ...livePages,
          ...liveAssets,
          ...liveAssets.map((url) => `${url}?variant=warm`),
          ...liveAssets.map((url) => `${url}/view`),
          oldAssetUrl,
          "https://s8-fixture.hasaweb.site/_/github.json",
          "https://s8-fixture.hasaweb.site/_/contact",
        ]) {
          const response = await visitor(url);
          assert.equal(response.status, 404, url);
          assert.match(response.headers.get("Cache-Control"), /no-store/, url);
          assert.ok(!(await response.text()).includes("Case study"), url);
        }
        const kept = (
          await sql(
            "SELECT p.status,p.subdomain,p.published_version,p.draft,p.draft_rev,c.state FROM portfolio p JOIN subdomain_claim c ON c.portfolio_id=p.id WHERE p.id='s8-portfolio'",
          )
        ).results[0];
        assert.deepEqual(
          {
            status: kept.status,
            subdomain: kept.subdomain,
            version: kept.published_version,
            state: kept.state,
            draft: kept.draft,
            rev: kept.draft_rev,
          },
          {
            status: "unpublished",
            subdomain: "s8-fixture",
            version: 2,
            state: "claimed",
            draft: draftBefore.draft,
            rev: draftBefore.draft_rev,
          },
        );
        // No other portfolio can take the withdrawn address.
        await assert.rejects(
          sql(
            "INSERT INTO subdomain_claim(name,state,held_at) VALUES('s8-fixture','held',?)",
            [Date.now()],
          ),
        );
        await assert.rejects(
          sql("DELETE FROM subdomain_claim WHERE name='s8-fixture'"),
        );
        const publicObjects = async () => {
          let count = 0;
          for (const candidate of preparedForCommit.slice(0, 2))
            count += (await api(`/objects?id=${candidate.id}`)).value.assets
              .objects.length;
          return count;
        };
        assert.ok((await publicObjects()) > 0);
        for (let n = 0; n < 100; n++) {
          await api(`/withdraw-unpublished?id=${withdrawalId}`);
          if (
            (
              await sql(
                "SELECT completed_at FROM publication_withdrawal WHERE id=?",
                [withdrawalId],
              )
            ).results[0].completed_at
          )
            break;
        }
        assert.ok(
          (
            await sql(
              "SELECT completed_at FROM publication_withdrawal WHERE id=?",
              [withdrawalId],
            )
          ).results[0].completed_at,
        );
        assert.equal(await publicObjects(), 0);
        // Private page output stays for the retained versions; nothing serves it.
        assert.ok(
          (await api(`/objects?id=${live.id}`)).value.sites.objects.length > 0,
        );
        const committed = await commitPublication(
          command(preparedForCommit[2], 2, "unpublished"),
        );
        assert.equal(committed.status, 200, JSON.stringify(committed));
        assert.equal(committed.value.version, 3);
        assert.equal(committed.value.address, "s8-fixture");
        assert.equal(
          (
            await sql(
              "SELECT state FROM subdomain_claim WHERE name='s8-fixture'",
            )
          ).results[0].state,
          "claimed",
        );
        assert.equal((await visitor(publicUrl)).status, 200);
        // Phase 46: the removed case study stops serving its content and
        // metadata, and leaves the sitemap. The unavailable page is noindex.
        const removedCase = await servedHead(
          "https://s8-fixture.hasaweb.site/projects/project",
        );
        assert.equal(removedCase.response.status, 404);
        assert.equal(
          removedCase.response.headers.get("X-Robots-Tag"),
          "noindex",
        );
        assert.ok(
          removedCase.head.includes('<meta name="robots" content="noindex">'),
        );
        assert.equal(removedCase.title, "Page unavailable");
        assert.equal(removedCase.canonical, undefined);
        assert.ok(!removedCase.html.includes("Case study"));
        assert.ok(!removedCase.html.includes("og:"));
        const sitemap = await (
          await visitor("https://s8-fixture.hasaweb.site/sitemap.xml")
        ).text();
        assert.ok(!sitemap.includes("/projects/"), sitemap);
        // Version 3 has its own card; version 2's no longer serves.
        assert.equal(
          (
            await visitor(
              `https://s8-assets.invalid/candidate/${preparedForCommit[1].id}/assets/sharing-card`,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await visitor(
              `https://s8-assets.invalid/candidate/${id}/assets/sharing-card`,
            )
          ).status,
          200,
        );
        assert.ok(
          sitemap.includes("https://s8-fixture.hasaweb.site/resume</loc>"),
        );
        const removedAsset = preparedForCommit[1].manifest.files.find(
          (file) => file.path === "/assets/project-image",
        );
        assert.ok(removedAsset);
        const removedUrl = `https://s8-assets.invalid/candidate/${preparedForCommit[1].id}${removedAsset.path}`;
        assert.equal((await visitor(removedUrl)).status, 404);
        assert.equal((await visitor(`${removedUrl}?variant=warm`)).status, 404);
        assert.equal(
          (await visitor(removedUrl, { method: "HEAD" })).status,
          404,
        );
      }
    } else {
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
      `${kind}: complete document/manifest/hash parity, sanitized snapshot, selected art, ordered wrappers, complete asset copies and disabled-face isolation`,
    );
    console.log(
      `PASS ${kind}: ${run.inputBytes} input bytes, ${remote ? run.dispatchCheckpoints : run.invocations.length} dispatch checkpoints`,
    );
  }
  // biome-ignore format: Keep the existing S-8 suite's layout stable.
  if (commitMode) {
    assert.equal(preparedForCommit.length, 3);
    if (!remote) {
      const revision = (await sql("SELECT draft_rev FROM portfolio WHERE id='s8-portfolio'")).results[0].draft_rev;
      const staleId = (await api("/create", { revision })).value.id;
      for (let n=0; n<1000; n++) {
        await api(`/advance?id=${staleId}`);
        if ((await api(`/status?id=${staleId}`)).value.status === "ready") break;
      }
      assert.equal((await api(`/status?id=${staleId}`)).value.status, "ready");
      await sql("UPDATE portfolio SET draft_rev=draft_rev+1 WHERE id='s8-portfolio'");
      const staleRevision = await commitPublication({ portfolioId: "s8-portfolio", candidateId: staleId, expectedVersion: 3, expectedStatus: "published" });
      assert.equal(staleRevision.status, 409);
      assert.equal(staleRevision.value.code, "revision_conflict");
      assert.equal((await sql("SELECT published_version FROM portfolio WHERE id='s8-portfolio'")).results[0].published_version, 3);
      assert.equal((await sql("SELECT state FROM subdomain_claim WHERE name='s8-fixture'")).results[0].state, "claimed");
      assert.equal((await visitor("https://s8-fixture.hasaweb.site/")).status, 200);
      await api(`/cleanup?id=${staleId}`, {});
      for (let n=0; n<1000; n++) {
        await api(`/advance?id=${staleId}`);
        if ((await api(`/status?id=${staleId}`)).value.status === "cleaned") break;
      }
      assert.equal((await api(`/status?id=${staleId}`)).value.status, "cleaned");
      await checkAccountDeletion();
    }
    checks.push("First claim, failure rollback, complete version serving, stale and delayed retries, retained dependencies, privacy, no-store query policy and republish after unpublish");
  } else {
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
    // Each new output stage must replay safely after an R2 write succeeds but
    // its invocation fails. The previous live pointer and object stay intact.
    for (const stage of [
      "platform",
      "snapshot",
      "pages",
      "manifest",
      "manifest-assembly",
    ]) {
      const candidate = (await api("/create", { revision })).value.id;
      for (let n = 0; n < 1000; n++) {
        const row = (await api(`/status?id=${candidate}`)).value;
        const cursor = JSON.parse(row.cursor);
        if (row.status === "transferring" && cursor.stage === stage) break;
        await api(`/advance?id=${candidate}`);
        assert.ok(n < 999, stage);
      }
      const failed = await request(`/advance?id=${candidate}`, {
        headers: { "X-S8-Fault": "r2-after" },
      });
      assert.equal(failed.status, 500, stage);
      assert.notEqual(
        (await api(`/status?id=${candidate}`)).value.status,
        "ready",
      );
      await sql(
        "UPDATE publication_candidate SET next_attempt_at=0 WHERE id=?",
        [candidate],
      );
      await finish(candidate);
      if (stage === "platform") {
        await sql(
          "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) VALUES(?, 's8-portfolio',8,'superseded','publication-v1',?,?,?)",
          [candidate, candidate, Date.now(), Date.now()],
        );
        assert.equal((await api(`/cleanup?id=${candidate}`)).value, false);
        await sql("UPDATE publication_candidate SET updated_at=0 WHERE id=?", [
          candidate,
        ]);
        await api(`/sweep?id=${candidate}`);
        assert.equal(
          (await api(`/status?id=${candidate}`)).value.status,
          "ready",
        );
        assert.equal(
          (
            await sql(
              "SELECT source,facts FROM publication_candidate WHERE id=?",
              [candidate],
            )
          ).results[0].source,
          null,
        );
        assert.equal((await api("/retains?asset=avatar")).value, true);
        const next = (await api("/create", { revision })).value.id;
        await sql(
          "UPDATE publication_candidate SET status='failed' WHERE id=?",
          [next],
        );
        assert.equal((await api(`/cleanup?id=${next}`)).value, true);
        await finish(next, "cleaned");
        await sql("DELETE FROM publish_version WHERE id=?", [candidate]);
      }
      assert.equal((await api(`/cleanup?id=${candidate}`)).value, true);
      await finish(candidate, "cleaned");
      const removed = (await api(`/objects?id=${candidate}`)).value;
      assert.equal(
        removed.sites.objects.length + removed.assets.objects.length,
        0,
      );
      assert.equal(
        await (await request(`/live?id=${candidate}`)).text(),
        "<p>Previous complete version</p>",
      );
      checks.push(
        `Finalization ${stage} replays a post-write failure, cleans candidate output and preserves retained versions`,
      );
    }
    const changed = (await api("/create", { revision })).value.id;
    for (let n = 0; n < 1000; n++) {
      const row = (await api(`/status?id=${changed}`)).value;
      if (JSON.parse(row.cursor).stage === "seal") break;
      await api(`/advance?id=${changed}`);
      assert.ok(n < 999);
    }
    await sql("UPDATE asset SET status='failed' WHERE id='avatar'");
    assert.equal((await request(`/advance?id=${changed}`)).status, 500);
    assert.notEqual((await api(`/status?id=${changed}`)).value.status, "ready");
    await sql("UPDATE asset SET status='ready' WHERE id='avatar'");
    await sql("UPDATE publication_candidate SET next_attempt_at=0 WHERE id=?", [
      changed,
    ]);
    await finish(changed);
    assert.equal((await api(`/cleanup?id=${changed}`)).value, true);
    await finish(changed, "cleaned");
    checks.push(
      "Sealing atomically rechecks asset readiness after copying and hashing",
    );
    const revoked = (await api("/create", { revision })).value.id;
    for (let n = 0; n < 1000; n++) {
      const row = (await api(`/status?id=${revoked}`)).value;
      if (JSON.parse(row.cursor).stage === "seal") break;
      await api(`/advance?id=${revoked}`);
      assert.ok(n < 999);
    }
    const recipient = (
      await sql(
        "SELECT verified_at FROM contact_recipient WHERE portfolio_id='s8-portfolio'",
      )
    ).results[0];
    await sql(
      "UPDATE contact_recipient SET verified_at=NULL WHERE portfolio_id='s8-portfolio'",
    );
    assert.equal((await request(`/advance?id=${revoked}`)).status, 500);
    assert.notEqual((await api(`/status?id=${revoked}`)).value.status, "ready");
    await sql(
      "UPDATE contact_recipient SET verified_at=? WHERE portfolio_id='s8-portfolio'",
      [recipient.verified_at],
    );
    await sql("UPDATE publication_candidate SET next_attempt_at=0 WHERE id=?", [
      revoked,
    ]);
    await finish(revoked);
    assert.equal((await api(`/cleanup?id=${revoked}`)).value, true);
    await finish(revoked, "cleaned");
    checks.push(
      "A changed mutable verification fact prevents the ready checkpoint",
    );

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
    // Retained current versions must not consume preparation/cleanup slots.
    const retainedIds = Array.from({ length: 128 }, () => crypto.randomUUID());
    const retainedJson = JSON.stringify(retainedIds);
    await sql(
      "INSERT INTO user(id,name,email,created_at,updated_at) SELECT value,'Retained capacity fixture',value || '@example.test',1,1 FROM json_each(?)",
      [retainedJson],
    );
    await sql(
      "INSERT INTO portfolio(id,user_id,status,published_version,draft,created_at,updated_at) SELECT value,value,'published',1,'{}',1,1 FROM json_each(?)",
      [retainedJson],
    );
    await sql(
      "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,status,cursor,next_attempt_at,deadline_at,created_at,updated_at) SELECT value,value,value,0,'{}','ready','[]',0,0,0,0 FROM json_each(?)",
      [retainedJson],
    );
    await sql(
      "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) SELECT value,value,1,'live','publication-v1',value,1,1 FROM json_each(?)",
      [retainedJson],
    );
    const pendingCount = async () =>
      (await sql("SELECT count(*) AS n FROM publication_candidate_pending"))
        .results[0].n;
    const pendingBefore = await pendingCount();
    assert.ok(pendingBefore < 128);
    const afterRetention = (await api("/create", { revision })).value.id;
    await finish(afterRetention);
    assert.equal(await pendingCount(), pendingBefore + 1);
    // Referencing a complete candidate releases its slot in the same transaction.
    await sql(
      "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) VALUES(?,'s8-portfolio',9,'superseded','publication-v1',?,1,1)",
      [afterRetention, afterRetention],
    );
    assert.equal(await pendingCount(), pendingBefore);
    assert.equal((await api(`/cleanup?id=${afterRetention}`)).value, false);
    await api(`/sweep?id=${afterRetention}`);
    assert.equal(
      (await api(`/status?id=${afterRetention}`)).value.status,
      "ready",
    );
    const afterRelease = (await api("/create", { revision })).value.id;
    await sql("UPDATE publication_candidate SET status='failed' WHERE id=?", [
      afterRelease,
    ]);
    await api(`/cleanup?id=${afterRelease}`);
    await finish(afterRelease, "cleaned");
    await sql("DELETE FROM publish_version WHERE id=?", [afterRetention]);
    assert.equal(await pendingCount(), pendingBefore + 2);
    await api(`/cleanup?id=${afterRetention}`);
    await finish(afterRetention, "cleaned");
    for (const id of [retainedIds[0], retainedIds[127]]) {
      assert.equal((await api(`/cleanup?id=${id}`)).value, false);
      await api(`/sweep?id=${id}`);
      assert.equal((await api(`/status?id=${id}`)).value.status, "ready");
    }
    checks.push(
      "128 retained current portfolios permit complete preparation and subsequent admission; references release slots atomically, prevent cleanup/expiry and return deleted versions to cleanup accounting",
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
    const sourceRace = await Promise.all(
      [0, 1].map(() =>
        request("/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision }),
        }),
      ),
    );
    assert.deepEqual(
      sourceRace.map((response) => response.status).sort(),
      [200, 500],
    );
    assert.ok((await pendingCount()) < 127);
    const sourceWinner = await sourceRace
      .find((response) => response.status === 200)
      .json();
    await sql("UPDATE publication_candidate SET status='failed' WHERE id=?", [
      sourceWinner.value.id,
    ]);
    await api(`/cleanup?id=${sourceWinner.value.id}`);
    await finish(sourceWinner.value.id, "cleaned");
    const existing = (
      await sql("SELECT count(*) AS n FROM publication_candidate_pending")
    ).results[0].n;
    await insertCap(
      Array.from({ length: 127 - existing }, () => crypto.randomUUID()),
      null,
    );
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
    assert.equal(await pendingCount(), 128);
    await sql("UPDATE publication_candidate SET status='failed' WHERE id=?", [
      winner.value.id,
    ]);
    await api(`/cleanup?id=${winner.value.id}`);
    await finish(winner.value.id, "cleaned");
    // No source remains here: only the pending row limit can deny admission.
    assert.equal(
      (
        await sql(
          "SELECT count(*) AS n FROM publication_candidate WHERE source IS NOT NULL",
        )
      ).results[0].n,
      0,
    );
    assert.equal(await pendingCount(), 128);
    capacity = await request("/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision }),
    });
    assert.equal(capacity.status, 500);
    assert.match((await capacity.json()).value.error, /capacity reached/);
    checks.push(
      "With 128 retained versions, atomic admission still enforces one source per portfolio, four global sources and 128 pending candidates including cleanup tombstones; one concurrent request wins the final slot",
    );
    await sql("DELETE FROM publication_candidate WHERE owner_id='cap-fixture'");
    // Cascaded version deletion must restore orphan cleanup accounting even if
    // that temporarily exceeds admission capacity. No cleanup ticket is lost.
    await sql("DELETE FROM user WHERE id IN (SELECT value FROM json_each(?))", [
      retainedJson,
    ]);
    assert.ok((await pendingCount()) > 128);
    capacity = await request("/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision }),
    });
    assert.equal(capacity.status, 500);
    assert.match((await capacity.json()).value.error, /capacity reached/);
    await sql(
      "DELETE FROM publication_candidate WHERE id IN (SELECT value FROM json_each(?))",
      [retainedJson],
    );
    assert.equal(await pendingCount(), existing + 1);
    checks.push(
      "Owner deletion returns retained candidates to pending cleanup above the admission limit, blocks new work until slots retire and cascades pending rows on physical candidate deletion",
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
  }
  console.log(`PASS ${checks.length} S-8 integration groups`);
} catch (error) {
  await writeFile(join(evidence, "failure.txt"), String(error.stack));
  throw error;
} finally {
  child?.kill("SIGTERM");
  await writeFile(join(evidence, "runtime.log"), logs);
  await writeFile(
    join(evidence, "results.json"),
    `${JSON.stringify({ recordedAt: new Date().toISOString(), checks, runs, sweeps, limitations: ["Local workerd counters are not provider CPU proof.", "Separate boundary review and owner completion approval pending."] }, null, 2)}\n`,
  );
  console.log(`Evidence: ${evidence}`);
}
