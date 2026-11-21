// `pnpm example:publish` publishes the entry page's example portfolio
// (Phase 50) to example.hasaweb.site through the running Workers. Locally,
// start `pnpm dev` first; the script reads APP_ORIGIN and BETTER_AUTH_SECRET
// from apps/web/.dev.vars unless they are set in the environment. Production
// runs pass `--remote --config=<production web config>` with the production
// origin and secret in the environment (Phase 52).
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { publishExample } from "./example-portfolio/publish.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const flags = new Map(
  process.argv.slice(2).map((arg) => {
    const [name, value = "true"] = arg.replace(/^--/, "").split("=");
    return [name, value];
  }),
);
const vars = Object.fromEntries(
  (await readFile("apps/web/.dev.vars", "utf8").catch(() => ""))
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]),
);
const remote = flags.has("remote");
const env = process.env;
const origin = env.APP_ORIGIN ?? (remote ? undefined : vars.APP_ORIGIN);
const secret =
  env.BETTER_AUTH_SECRET ?? (remote ? undefined : vars.BETTER_AUTH_SECRET);
if (!origin || !secret) {
  console.error("Set APP_ORIGIN and BETTER_AUTH_SECRET.");
  process.exit(1);
}
// Only the session's own identifiers and timestamps reach SQL here, so values
// are restricted to integers and plain identifier characters.
function literal(value) {
  if (Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value))
    return `'${value}'`;
  throw new Error(`Unexpected SQL value ${value}`);
}
async function sql(query, values = []) {
  let index = 0;
  const command = query.replace(/\?/g, () => literal(values[index++]));
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--config",
      flags.get("config") ?? "apps/web/wrangler.jsonc",
      ...(remote
        ? ["--remote"]
        : ["--local", "--persist-to", ".wrangler/state"]),
      "--command",
      command,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
const { site } = await publishExample({
  origin,
  secret,
  sql,
  log: (message) => console.log(message),
});
console.log(`Example portfolio live at ${site.url}`);
