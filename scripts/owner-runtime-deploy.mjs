// Isolated experiment only. No routes, production data, or billing changes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const directory = join(root, ".wrangler/owner-runtime-remote");
const evidence = join(
  root,
  process.env.OWNER_RUNTIME_EVIDENCE ?? "specs/2026-10-16-owner-api-runtime",
);
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
await mkdir(directory, { recursive: true });
const action = process.argv[2];
assert.ok(
  ["prepare", "deploy", "cleanup"].includes(action),
  "Use prepare, deploy or cleanup",
);
const names = {
  jobs: "hasaweb-owner-runtime-jobs",
  web: "hasaweb-owner-runtime-web",
};
if (action === "prepare") {
  const databases = JSON.parse(cli(["d1", "list", "--json"]));
  const database = databases.find(
    (db) => db.name === "hasaweb-owner-runtime-spike",
  );
  assert.ok(
    database,
    "Create the isolated hasaweb-owner-runtime-spike D1 database first",
  );
  const origin = "https://hasaweb-owner-runtime-web.umerthepro2009.workers.dev";
  const secretPath = join(directory, "secrets.json");
  await writeFile(
    secretPath,
    JSON.stringify({
      RUNTIME_KEY: randomBytes(32).toString("hex"),
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    }),
    { flag: "wx", mode: 0o600 },
  );
  const base = {
    account_id: "b6f9a87e6702c76c45a8d61744826e0f",
    compatibility_date: "2026-10-14",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    preview_urls: false,
    observability: { enabled: true, head_sampling_rate: 1 },
  };
  await writeFile(
    join(directory, "jobs.json"),
    JSON.stringify(
      {
        ...base,
        name: names.jobs,
        main: join(root, "apps/jobs/integration/owner-runtime.ts"),
        d1_databases: [
          {
            binding: "DB",
            database_name: database.name,
            database_id: database.uuid,
          },
        ],
        vars: {
          APP_ENV: "test",
          APP_ORIGIN: "https://hasaweb.site",
          RUNTIME_ENABLED: "true",
          GITHUB_CLIENT_ID: "fixture",
          GITHUB_CLIENT_SECRET: "fixture",
          GOOGLE_CLIENT_ID: "fixture",
          GOOGLE_CLIENT_SECRET: "fixture",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(directory, "web.json"),
    JSON.stringify(
      {
        ...base,
        name: names.web,
        main: join(root, "apps/web/integration/owner-runtime-gateway.ts"),
        services: [
          {
            binding: "OWNER_API",
            service: names.jobs,
            entrypoint: "RuntimeOwnerApi",
          },
          { binding: "JOBS", service: names.jobs },
        ],
        vars: { RUNTIME_ORIGIN: origin, RUNTIME_ENABLED: "true" },
      },
      null,
      2,
    ),
  );
  for (const file of (await readdir(join(root, "packages/db/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    cli([
      "d1",
      "execute",
      database.name,
      "--remote",
      "-c",
      join(directory, "jobs.json"),
      "--file",
      join(root, "packages/db/migrations", file),
    ]);
  console.log(
    "Prepared isolated configuration and product-schema fixture database",
  );
}
if (action === "deploy") {
  for (const name of ["jobs", "web"]) {
    const config = join(directory, `${name}.json`);
    const data = JSON.parse(await readFile(config, "utf8"));
    assert.equal(data.name, names[name]);
    assert.ok(!data.routes && !data.route);
    const log = cli(["deploy", "-c", config]);
    await writeFile(join(evidence, `deploy-${name}.txt`), log);
    cli(["secret", "bulk", join(directory, "secrets.json"), "-c", config]);
    console.log(`Deployed ${name}; startup retained in deploy-${name}.txt`);
  }
}
if (action === "cleanup") {
  const results = [];
  for (const name of ["web", "jobs"])
    results.push(
      cli(["delete", "-c", join(directory, `${name}.json`), "--force"]),
    );
  results.push(
    cli([
      "d1",
      "delete",
      "hasaweb-owner-runtime-spike",
      "-c",
      join(directory, "jobs.json"),
      "--skip-confirmation",
    ]),
  );
  await writeFile(join(evidence, "cleanup.txt"), results.join("\n"));
  await rm(join(directory, "secrets.json"), { force: true });
  console.log(
    "Deleted both experiment Workers, the isolated D1 database and local experiment secrets",
  );
}
