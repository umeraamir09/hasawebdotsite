import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function cloudflareToken(wrangler) {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone operator credentials are never cached by Turbo
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const refresh = spawnSync(process.execPath, [wrangler, "whoami"], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    timeout: 60000,
  });
  assert.equal(
    refresh.status,
    0,
    "Cloudflare login refresh failed; run Wrangler whoami to inspect authentication",
  );
  const saved = await readFile(
    join(homedir(), ".config/.wrangler/config/default.toml"),
    "utf8",
  );
  const token = saved.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(token, "Cloudflare login required");
  return token;
}
