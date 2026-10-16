import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const output = process.argv[2] ?? ".wrangler/s2-production/tail.json";
const child = spawn(
  process.execPath,
  [
    join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js"),
    "tail",
    process.argv[3] ?? "hasaweb-s2-spike",
    "--format",
    "json",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const events = [];
let saved = Promise.resolve();
function snapshot() {
  saved = saved.then(async () => {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(
      output,
      `${JSON.stringify({ recordedAt: new Date().toISOString(), method: "Cloudflare real-time tail. Only measurement fields retained. Tail can sample; CPU and wall time come from the provider, never client timers.", events }, null, 2)}\n`,
    );
  });
  return saved;
}
let buffer = "";
let depth = 0;
let quoted = false;
let escaped = false;
let collecting = false;
child.stdout.on("data", (data) => {
  for (const char of data.toString()) {
    if (!collecting) {
      if (char !== "{") continue;
      collecting = true;
    }
    buffer += char;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        try {
          const event = JSON.parse(buffer);
          // Retain only measurements. Raw tail events may contain credentials.
          const row = {
            at: event.eventTimestamp,
            outcome: event.outcome,
            cpuTime: event.cpuTime,
            wallTime: event.wallTime,
            url: event.event?.request?.url,
            status: event.event?.response?.status,
            script: event.scriptName,
            version: event.scriptVersion?.id,
          };
          events.push(row);
          if (events.length % 10 === 0) void snapshot();
          if (events.length === 1)
            console.log(
              JSON.stringify({
                firstEvent: row,
                hasCpu: typeof row.cpuTime === "number",
              }),
            );
        } catch {
          /* Wrangler diagnostic, not a trace event. */
        }
        buffer = "";
        collecting = false;
      }
    }
  }
});
child.stderr.on("data", () => {});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  await saved;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ recordedAt: new Date().toISOString(), method: "Cloudflare real-time tail. Whitelisted fields only; request headers, cookies, tokens and console logs discarded. Tail can sample; compare counts with client requests. cpuTime/wallTime are provider measurements if present, never inferred.", events }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ captured: events.length, output }));
}
process.on("SIGINT", () => {
  void stop();
});
process.on("SIGTERM", () => {
  void stop();
});
child.on("exit", () => {
  void stop();
});
console.log(
  "Tail collector starting; only sanitized measurement fields will be saved.",
);
