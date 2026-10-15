import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const args = [
  "--config",
  "apps/web/wrangler.jsonc",
  "--local",
  "--persist-to",
  ".wrangler/state",
];
function wrangler(command) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...command, ...args], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
wrangler(["d1", "migrations", "apply", "hasaweb-local"]);
wrangler(["d1", "execute", "DB", "--file", "scripts/fixtures/runtime.sql"]);
wrangler(["d1", "execute", "DB", "--file", "scripts/fixtures/persistence.sql"]);
for (const [bucket, file] of [
  ["hasaweb-draft-local", "draft"],
  ["hasaweb-sites-local", "site"],
  ["hasaweb-assets-local", "asset"],
]) {
  wrangler([
    "r2",
    "object",
    "put",
    `${bucket}/runtime/${file}.txt`,
    "--file",
    `scripts/fixtures/${file}.txt`,
  ]);
}
