import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function openChromium(port = 9252) {
  const profile = await mkdtemp(join(tmpdir(), "hasaweb-avatar-"));
  const browser = spawn(
    process.env.AUTH_SPIKE_CHROMIUM ?? "/opt/google/chrome/chrome",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let launchError;
  browser.on("error", (error) => {
    launchError = error;
  });
  const exit = new Promise((resolve) => browser.once("exit", resolve));
  let socket;
  const pending = new Map();
  const listeners = new Map();
  const errors = [];
  let sequence = 0;
  async function close() {
    socket?.close();
    if (browser.exitCode === null && !launchError) {
      browser.kill("SIGTERM");
      await exit;
    }
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("Browser closed"));
    }
    await rm(profile, { recursive: true, force: true });
  }
  try {
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      try {
        target = (
          await (await fetch(`http://127.0.0.1:${port}/json`)).json()
        ).find((item) => item.type === "page");
      } catch {}
      if (target) break;
      await delay(100);
    }
    assert.ok(target, "Chromium must start");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Runtime.exceptionThrown")
        errors.push(message.params.exceptionDetails.text);
      for (const listener of listeners.get(message.method) ?? [])
        listener(message.params);
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    });
    function command(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 30000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evaluate(expression) {
      const result = await command("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      assert.ok(
        !result.exceptionDetails,
        result.exceptionDetails?.exception?.description ??
          result.exceptionDetails?.text,
      );
      return result.result.value;
    }
    async function until(expression) {
      for (let attempt = 0; attempt < 300; attempt++) {
        if (await evaluate(expression)) return;
        await delay(50);
      }
      throw new Error(`Condition timed out: ${expression}`);
    }
    function on(method, listener) {
      listeners.set(method, [...(listeners.get(method) ?? []), listener]);
    }
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Network.enable");
    return { command, evaluate, until, on, errors, close };
  } catch (error) {
    await close();
    throw error;
  }
}
