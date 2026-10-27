// Diagnostic sampling only. Never use inspector measurements for native acceptance.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
export async function s8Profiler(port, output) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target =
    targets.find(
      (item) =>
        item.id?.includes("s8-dispatch-jobs") ||
        item.title?.includes("s8-dispatch-jobs"),
    ) ?? (targets.length === 1 ? targets[0] : undefined);
  assert.ok(
    target?.webSocketDebuggerUrl,
    `Jobs inspector target required: ${JSON.stringify(targets.map(({ id, title }) => ({ id, title })))}`,
  );
  const address = new URL(target.webSocketDebuggerUrl);
  address.hostname = "127.0.0.1";
  const WebSocket = createRequire(require.resolve("wrangler"))("ws");
  const socket = new WebSocket(address, { origin: "http://localhost" });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let sequence = 0;
  const pending = new Map();
  socket.on("message", (data) => {
    const message = JSON.parse(data);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  });
  async function command(method, params = {}) {
    const id = ++sequence;
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Inspector timeout ${method}`));
      }, 10000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
    socket.send(JSON.stringify({ id, method, params }));
    return response;
  }
  await command("Profiler.enable");
  await command("Profiler.setSamplingInterval", { interval: 100 });
  return {
    start: () => command("Profiler.start"),
    async stop(name) {
      const { profile } = await command("Profiler.stop");
      await writeFile(
        join(output, `${name}.cpuprofile`),
        JSON.stringify(profile),
      );
      const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
      const totals = new Map();
      for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
        const frame = nodes.get(profile.samples[i])?.callFrame;
        const name = `${frame?.functionName || "anonymous"}@${frame?.lineNumber}`;
        totals.set(
          name,
          (totals.get(name) ?? 0) + (profile.timeDeltas[i] ?? 0),
        );
      }
      await writeFile(
        join(output, `${name}-profile-summary.json`),
        JSON.stringify(
          {
            diagnostic: true,
            units: "sampled microseconds, including idle; not acceptance CPU",
            functions: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 40),
          },
          null,
          2,
        ),
      );
    },
    close: () => socket.close(),
  };
}
