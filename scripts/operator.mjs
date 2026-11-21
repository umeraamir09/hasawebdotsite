// `pnpm ops <command> [--flags]`: Phase 51 operator controls (no product UI).
// Locally they run against `.wrangler/state`; pass `--remote` and
// `--config=<production web config>` for production (Phase 52). See
// README.md#operator-scripts for every command.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  OperatorError,
  operatorCommands,
  purgeHosts,
  sqlLiteral,
} from "./operator/commands.mjs";
import {
  OwnerSessionError,
  publishRevision,
  withOwnerSession,
} from "./operator/owner-session.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(
  rest.map((arg) => {
    const [name, ...value] = arg.replace(/^--/, "").split("=");
    return [name, value.length ? value.join("=") : "true"];
  }),
);
const remote = flags.remote === "true";
const env = process.env;

function wrangler(query) {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--json",
      "--config",
      flags.config ?? "apps/web/wrangler.jsonc",
      ...(remote
        ? ["--remote"]
        : ["--local", "--persist-to", ".wrangler/state"]),
      "--command",
      query,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout)[0];
}
async function sql(query, values = []) {
  let index = 0;
  return wrangler(query.replace(/\?/g, () => sqlLiteral(values[index++])))
    .results;
}

const commands = operatorCommands({ sql });
const runs = {
  find: () => commands.find(flags),
  "abuse-report": () => commands.abuseReport(flags),
  suspend: () => commands.suspend(flags),
  unsuspend: () => commands.unsuspend(flags),
  outbox: () =>
    commands.outbox({
      portfolio: flags.portfolio,
      status: flags.status,
      limit: flags.limit,
    }),
  "email-lookup": () => commands.emailLookup(flags),
  "audit-cleanup": () => commands.auditCleanup(),
  "d1-size": () => {
    // Remote D1 reports its size with every query; local D1 does not.
    const bytes = wrangler("SELECT 1").meta?.size_after;
    if (bytes === undefined)
      return { bytes: null, note: "this D1 does not report its size" };
    return { bytes, alert: bytes >= 350_000_000 };
  },
  purge: async () => {
    const row = await commands.find(flags);
    if (!row.subdomain)
      throw new OperatorError("The portfolio was never published");
    if (!remote) return { skipped: "local runs have no edge cache" };
    return purgeHosts({
      zoneId: env.CLOUDFLARE_ZONE_ID,
      token: env.CLOUDFLARE_CACHE_PURGE_TOKEN,
      address: row.subdomain,
    });
  },
  rerender: async () => {
    const plan = await commands.rerenderPlan(flags);
    const vars = Object.fromEntries(
      (await readFile("apps/web/.dev.vars", "utf8").catch(() => ""))
        .split("\n")
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [
          line.slice(0, line.indexOf("=")),
          line.slice(line.indexOf("=") + 1),
        ]),
    );
    const origin = env.APP_ORIGIN ?? (remote ? undefined : vars.APP_ORIGIN);
    const secret =
      env.BETTER_AUTH_SECRET ?? (remote ? undefined : vars.BETTER_AUTH_SECRET);
    if (!origin || !secret)
      throw new OperatorError("Set APP_ORIGIN and BETTER_AUTH_SECRET");
    const { operation, site } = await withOwnerSession(
      {
        origin,
        secret,
        sql,
        owner: plan.accountId,
        label: "operator-rerender",
      },
      (call) => publishRevision(call, plan),
    );
    return { ...plan, version: operation.version ?? null, site };
  },
};

const run = runs[command];
if (!run) {
  console.error(
    `Usage: pnpm ops <${Object.keys(runs).join("|")}> [--address=|--account=|--portfolio=] [flags]`,
  );
  process.exit(1);
}
try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  if (!(error instanceof OperatorError || error instanceof OwnerSessionError))
    throw error;
  console.error(error.message);
  process.exit(1);
}
