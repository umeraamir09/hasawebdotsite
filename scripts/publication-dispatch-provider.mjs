// Creates only isolated, synthetic measurement resources. Never enables product publication.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareToken } from "./lib/cloudflare-token.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)),
  directory = join(root, ".wrangler/s8-provider"),
  statePath = join(directory, "state.json");
const action = process.argv[2];
assert.ok(
  [
    "prepare",
    "deploy",
    "cpu",
    "cleanup",
    "schema",
    "inspect",
    "verify-cleanup",
  ].includes(action),
);
const require = createRequire(import.meta.url),
  wrangler = join(
    dirname(require.resolve("wrangler/package.json")),
    "bin/wrangler.js",
  );
const token = await cloudflareToken(wrangler);
const account = "b6f9a87e6702c76c45a8d61744826e0f";
async function raw(path, init = {}) {
  return fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(60000),
  });
}
async function api(path, init = {}) {
  const response = await raw(`/accounts/${account}${path}`, init);
  const body = await response.json();
  assert.ok(response.ok && body.success, JSON.stringify(body.errors));
  return body.result;
}
function cli(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
const save = async (state) =>
  writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
await mkdir(directory, { recursive: true });
if (action === "prepare") {
  let exists = false;
  try {
    await readFile(statePath);
    exists = true;
  } catch {}
  assert.ok(
    !exists,
    "Owned resource state already exists; reuse deploy or cleanup",
  );
  const suffix = randomBytes(3).toString("hex"),
    prefix = `hasaweb-s8-${suffix}`;
  const state = {
    createdAt: new Date().toISOString(),
    account,
    prefix,
    jobs: `${prefix}-jobs`,
    source: `${prefix}-source`,
    buckets: {
      draft: `${prefix}-draft`,
      sites: `${prefix}-sites`,
      assets: `${prefix}-assets`,
    },
    queue: `${prefix}-queue`,
    runtimeKey: randomBytes(32).toString("hex"),
    secret: randomBytes(32).toString("hex"),
    resources: [],
  };
  await save(state);
  try {
    state.plan = (await api("/subscriptions")).map((x) => ({
      name: x.rate_plan?.public_name ?? x.rate_plan?.name ?? x.rate_plan?.id,
      status: x.state,
    }));
  } catch (error) {
    state.planReadError = error.message;
  }
  const db = await api("/d1/database", {
    method: "POST",
    body: JSON.stringify({ name: `${prefix}-db` }),
  });
  state.database = db;
  state.resources.push({ type: "d1", id: db.uuid });
  await save(state);
  for (const name of Object.values(state.buckets)) {
    await api("/r2/buckets", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    state.resources.push({ type: "r2", name });
    await save(state);
  }
  const queue = await api("/queues", {
    method: "POST",
    body: JSON.stringify({ queue_name: state.queue }),
  });
  state.queueId = queue.queue_id;
  state.resources.push({ type: "queue", id: queue.queue_id });
  await save(state);
  state.bucketPrivacy = [];
  for (const name of Object.values(state.buckets)) {
    const managed = await api(`/r2/buckets/${name}/domains/managed`),
      custom = await api(`/r2/buckets/${name}/domains/custom`);
    assert.equal(managed.enabled, false);
    assert.equal(custom.domains?.length ?? custom.length ?? 0, 0);
    state.bucketPrivacy.push({ name, managedPublic: false, customDomains: 0 });
  }
  const subdomain = await api("/workers/subdomain");
  state.origin = `https://${state.jobs}.${subdomain.subdomain}.workers.dev`;
  await save(state);
  console.log(
    JSON.stringify({
      prepared: state.prefix,
      bucketPrivacy: state.bucketPrivacy,
      plan: state.plan ?? null,
    }),
  );
}
if (action === "deploy") {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.control ??= `${state.prefix}-control`;
  state.origin = state.origin.replace(state.jobs, state.control);
  const mode = process.argv.includes("--quota") ? "quota" : "native",
    batch = process.env.S8_BATCH ?? "16";
  const base = {
    account_id: account,
    compatibility_date: "2026-10-14",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    preview_urls: false,
    observability: { enabled: true, head_sampling_rate: 1 },
    d1_databases: [
      {
        binding: "DB",
        database_name: state.database.name,
        database_id: state.database.uuid,
        migrations_dir: join(root, "packages/db/migrations"),
      },
    ],
    vars: {
      APP_ENV: "test",
      APP_ORIGIN: "https://hasaweb.site",
      GITHUB_CLIENT_ID: "fixture",
      GITHUB_CLIENT_SECRET: "fixture",
      GOOGLE_CLIENT_ID: "fixture",
      GOOGLE_CLIENT_SECRET: "fixture",
      ASSET_ORIGIN: "https://s8-assets.invalid",
      MEASURE_QUOTAS: mode === "quota" ? "true" : "false",
      MANUAL_DISPATCH: "false",
      PUBLICATION_TASK_BATCH: batch,
    },
  };
  const configs = {
    source: {
      ...base,
      name: state.source,
      main: join(root, "apps/web/integration/publication-source-worker.ts"),
      r2_buckets: [
        { binding: "DRAFT_BUCKET", bucket_name: state.buckets.draft },
      ],
    },
    jobs: {
      ...base,
      name: state.jobs,
      main: join(root, "apps/jobs/integration/publication-dispatch-worker.ts"),
      r2_buckets: [
        { binding: "SITES_BUCKET", bucket_name: state.buckets.sites },
        { binding: "PUBLIC_ASSETS_BUCKET", bucket_name: state.buckets.assets },
      ],
      services: [
        {
          binding: "PRIVATE_SOURCE",
          service: state.source,
          entrypoint: "PublicationAssets",
        },
        { binding: "SOURCE_FIXTURE", service: state.source },
      ],
      queues: {
        producers: [{ binding: "PUBLICATION_QUEUE", queue: state.queue }],
        consumers: [
          {
            queue: state.queue,
            max_batch_size: 1,
            max_batch_timeout: 1,
            max_retries: 3,
            max_concurrency: 2,
          },
        ],
      },
    },
  };
  if (process.argv.includes("--full-source")) {
    state.fullSource ??= `${state.prefix}-full-source`;
    configs.fullSource = {
      ...configs.source,
      name: state.fullSource,
      main: join(root, "apps/web/worker.ts"),
      workers_dev: false,
      assets: {
        directory: join(root, "apps/web/.open-next/assets"),
        binding: "ASSETS",
      },
    };
    configs.jobs.services[0].service = state.fullSource;
    configs.fullSource.services = [];
  }
  configs.control = {
    ...configs.jobs,
    name: state.control,
    queues: { producers: configs.jobs.queues.producers },
  };
  configs.jobs.main = join(
    root,
    "apps/jobs/integration/publication-consumer-worker.ts",
  );
  configs.jobs.workers_dev = false;
  const secrets = join(directory, "secrets.json");
  await writeFile(
    secrets,
    JSON.stringify({
      RUNTIME_KEY: state.runtimeKey,
      BETTER_AUTH_SECRET: state.secret,
    }),
    { mode: 0o600 },
  );
  await save(state);
  for (const name of [
    "source",
    ...(configs.fullSource ? ["fullSource"] : []),
    "jobs",
    "control",
  ]) {
    const config = configs[name];
    const path = join(directory, `${name}.json`);
    await writeFile(path, JSON.stringify(config, null, 2));
    if (name === "source")
      cli([
        "d1",
        "migrations",
        "apply",
        state.database.name,
        "--remote",
        "-c",
        path,
      ]);
    const output = cli(["deploy", "-c", path]);
    await writeFile(join(directory, `${mode}-${name}-deploy.txt`), output);
    cli(["secret", "bulk", secrets, "-c", path]);
  }
  state.mode = mode;
  state.batch = batch;
  state.deployedAt = new Date().toISOString();
  await save(state);
  console.log(
    JSON.stringify({
      deployed: state.prefix,
      mode,
      batch,
      origin: state.origin,
    }),
  );
}
if (action === "cpu") {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const start = process.argv[3] ?? state.deployedAt,
    end = process.argv[4] ?? new Date().toISOString();
  const query = `query($account:String!,$start:Time!,$end:Time!,$script:String!){viewer{accounts(filter:{accountTag:$account}){workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$start,datetime_leq:$end,scriptName:$script}){dimensions{scriptName status coloCode scriptVersion}sum{requests errors}quantiles{cpuTimeP50 cpuTimeP95 cpuTimeP99}}}}}`;
  const results = [];
  for (const script of [
    state.jobs,
    state.source,
    state.fullSource,
    state.control,
  ].filter(Boolean)) {
    const response = await raw("/graphql", {
      method: "POST",
      body: JSON.stringify({
        query,
        variables: { account, start, end, script },
      }),
    });
    const body = await response.json();
    results.push({ script, status: response.status, ...body });
  }
  const path = join(directory, `cpu-${Date.now()}.json`);
  await writeFile(
    path,
    JSON.stringify(
      { start, end, mode: state.mode, batch: state.batch, results },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      evidence: path,
      errors: results.map((x) => x.errors ?? null),
    }),
  );
}
if (action === "cleanup") {
  const state = JSON.parse(await readFile(statePath, "utf8")),
    receipts = [];
  if (state.queueId) {
    const consumers = await api(`/queues/${state.queueId}/consumers`);
    for (const consumer of consumers) {
      await api(`/queues/${state.queueId}/consumers/${consumer.consumer_id}`, {
        method: "DELETE",
      });
    }
  }
  for (const name of [
    state.control,
    state.jobs,
    state.fullSource,
    state.source,
  ].filter(Boolean)) {
    const response = await raw(
      `/accounts/${account}/workers/scripts/${name}?force=true`,
      { method: "DELETE" },
    );
    assert.ok(
      response.ok || response.status === 404,
      `${response.status}: ${await response.text()}`,
    );
    receipts.push({ type: "worker", name, status: response.status });
  }
  if (state.queueId) {
    await api(`/queues/${state.queueId}`, { method: "DELETE" });
    receipts.push({ type: "queue", id: state.queueId });
  }
  for (const name of Object.values(state.buckets)) {
    for (let n = 0; n < 10000; n++) {
      const list = await api(`/r2/buckets/${name}/objects?limit=100`);
      const objects = list.objects ?? list;
      assert.ok(
        Array.isArray(objects),
        "Object-list response unsupported; preserve resources for explicit cleanup",
      );
      if (!objects.length) break;
      for (const object of objects) {
        const key = object.key ?? object.name;
        assert.ok(key);
        await api(`/r2/buckets/${name}/objects/${encodeURIComponent(key)}`, {
          method: "DELETE",
        });
      }
    }
    await api(`/r2/buckets/${name}`, { method: "DELETE" });
    receipts.push({ type: "r2", name });
  }
  await api(`/d1/database/${state.database.uuid}`, { method: "DELETE" });
  receipts.push({ type: "d1", id: state.database.uuid });
  state.cleanedAt = new Date().toISOString();
  state.cleanup = receipts;
  await save(state);
  console.log(JSON.stringify({ cleaned: state.prefix, receipts }));
}

if (action === "schema") {
  const query = `{__type(name:"AccountWorkersInvocationsAdaptiveFilter_InputObject"){inputFields{name}}}`;
  const response = await raw("/graphql", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
  const result = await response.json();
  await writeFile(
    join(directory, "analytics-schema.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const settings = await api(`/workers/scripts/${state.jobs}/settings`);
  console.log(
    JSON.stringify({
      usageModel: settings.usage_model,
      limits: settings.limits,
    }),
  );
}

if (action === "inspect") {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const queue = await api(`/queues/${state.queueId}`);
  const objectProbe = await raw(
    `/accounts/${account}/r2/buckets/${state.buckets.sites}/objects?limit=1`,
  );
  console.log(JSON.stringify({ objectListStatus: objectProbe.status }));
  const database = await api(`/d1/database/${state.database.uuid}`);
  const settings = await api(`/workers/scripts/${state.jobs}/settings`);
  const result = {
    recordedAt: new Date().toISOString(),
    queue,
    database,
    usageModel: settings.usage_model,
    limits: settings.limits,
    bucketPrivacy: state.bucketPrivacy,
    subscriptionRead: state.plan ?? state.planReadError,
  };
  const path = join(directory, `inspection-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      evidence: path,
      queueSettings: queue.settings,
      usageModel: settings.usage_model,
      databaseBytes: database.file_size,
    }),
  );
}

if (action === "verify-cleanup") {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.ok(state.cleanedAt, "Finish owned-resource cleanup first");
  const paths = [
    ...[state.control, state.jobs, state.fullSource, state.source]
      .filter(Boolean)
      .map((name) => `/workers/scripts/${name}`),
    `/queues/${state.queueId}`,
    ...Object.values(state.buckets).map((name) => `/r2/buckets/${name}`),
    `/d1/database/${state.database.uuid}`,
  ];
  const absent = [];
  for (const path of paths) {
    const response = await raw(`/accounts/${account}${path}`);
    assert.equal(response.status, 404, `Resource remains: ${path}`);
    absent.push({ path, status: response.status });
  }
  const result = {
    prefix: state.prefix,
    cleanedAt: state.cleanedAt,
    verifiedAt: new Date().toISOString(),
    receipts: state.cleanup,
    absent,
  };
  await writeFile(
    join(directory, "cleanup-receipt.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({ verifiedAbsent: absent.length, prefix: state.prefix }),
  );
}
