// Local-only storage check. Requires a completed test:bounded-saves run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const directory = ".wrangler/bounded-owner-local";
const file = join(directory, "capacity.sql");
const now = Date.now();
const sql = `
CREATE TABLE IF NOT EXISTS owner_runtime_fixture(user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,draft TEXT NOT NULL,progress TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
DELETE FROM user WHERE id LIKE 'capacity-%';
WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100)
INSERT INTO user(id,name,email,email_verified,created_at,updated_at) SELECT 'capacity-'||x,'Capacity','capacity-'||x||'@example.test',1,${now},${now} FROM n;
INSERT INTO owner_runtime_fixture(user_id,draft,progress) SELECT id,(SELECT draft FROM owner_runtime_template WHERE name='full'),'{}' FROM user WHERE id LIKE 'capacity-%';
INSERT INTO owner_save_attempt(id,user_id,session_id,base_revision,draft,progress,expires_at,piece_count,string_bytes) SELECT lower(hex(randomblob(16))),user_id,'capacity',0,draft,'{}',${now + 3600000},512,1048576 FROM owner_runtime_fixture WHERE user_id LIKE 'capacity-%';
WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<511)
INSERT INTO owner_save_piece(attempt_id,n,data) SELECT id,x,json_quote(replace(hex(zeroblob(1023)),'0','x')) FROM owner_save_attempt CROSS JOIN n WHERE user_id LIKE 'capacity-%';
SELECT count(*) AS attempts FROM owner_save_attempt WHERE user_id LIKE 'capacity-%';
SELECT count(*) AS pieces FROM owner_save_piece WHERE attempt_id IN (SELECT id FROM owner_save_attempt WHERE user_id LIKE 'capacity-%');
`;
await writeFile(file, sql);
try {
  const result = spawnSync(
    process.execPath,
    [
      join(
        dirname(require.resolve("wrangler/package.json")),
        "bin/wrangler.js",
      ),
      "d1",
      "execute",
      "bounded-owner-local",
      "--local",
      "-c",
      join(directory, "jobs.json"),
      "--persist-to",
      join(directory, "state"),
      "--file",
      file,
      "--json",
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const rows = JSON.parse(result.stdout.slice(result.stdout.indexOf("[\n")));
  const state = join(directory, "state/v3/d1/miniflare-D1DatabaseObject");
  const files = (await readdir(state)).filter(
    (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
  );
  assert.equal(files.length, 1);
  const measured = spawnSync(
    "python3",
    [
      "-c",
      "import sqlite3,sys,json; d=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(json.dumps(dict(pageCount=d.execute('PRAGMA page_count').fetchone()[0],pageSize=d.execute('PRAGMA page_size').fetchone()[0])))",
      join(state, files[0]),
    ],
    { encoding: "utf8" },
  );
  assert.equal(measured.status, 0, measured.stderr);
  const { pageCount, pageSize } = JSON.parse(measured.stdout);
  const bytes = pageCount * pageSize;
  assert.equal(
    rows.flatMap((r) => r.results).find((r) => r.attempts !== undefined)
      .attempts,
    100,
  );
  assert.equal(
    rows.flatMap((r) => r.results).find((r) => r.pieces !== undefined).pieces,
    51200,
  );
  assert.ok(bytes < 500_000_000);
  await writeFile(
    "specs/2026-10-16-free-owner-saves/bounded/storage-capacity.json",
    `${JSON.stringify({ recordedAt: new Date().toISOString(), method: "Local workerd/D1 SQLite page allocation after 100 maximum canonical drafts, 100 maximum staged drafts, and 51,200 string pieces totalling 100 MiB including piece JSON quotes. Includes template tables, indexes and existing free pages. Models storage only; not a deployed CPU or throughput measurement. Synthetic owners are removed afterward.", portfolios: 100, pageCount, pageSize, allocatedBytes: bytes, limitBytes: 500000000, passed: true }, null, 2)}\n`,
  );
  console.log(`PASS local storage allocation: ${bytes} / 500,000,000 bytes`);
} finally {
  await writeFile(file, "DELETE FROM user WHERE id LIKE 'capacity-%';");
  const cleaned = spawnSync(
    process.execPath,
    [
      join(
        dirname(require.resolve("wrangler/package.json")),
        "bin/wrangler.js",
      ),
      "d1",
      "execute",
      "bounded-owner-local",
      "--local",
      "-c",
      join(directory, "jobs.json"),
      "--persist-to",
      join(directory, "state"),
      "--file",
      file,
      "--json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(cleaned.status, 0, cleaned.stdout + cleaned.stderr);
  await rm(file, { force: true });
}
