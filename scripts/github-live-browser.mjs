import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

// Exercise a real browser form. Intercept GitHub before any authorization request
// leaves the browser. Do not print network URLs, cookies, CSRF, or OAuth state.
const profile = await mkdtemp(join(tmpdir(), "hasaweb-github-browser-"));
const browser = spawn(
  "/opt/google/chrome/chrome",
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-port=9246",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
let socket;
let id = 0;
let reachedGitHub = false;
let observedOrigin;
const pending = new Map();
try {
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      target = (await (await fetch("http://127.0.0.1:9246/json")).json()).find(
        (entry) => entry.type === "page",
      );
    } catch {}
    if (target) break;
    await setTimeout(100);
  }
  assert.ok(target, "Chromium startup");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  function command(method, params = {}) {
    const next = ++id;
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        pending.delete(next);
        reject(new Error("browser_timeout"));
      }, 10_000);
      pending.set(next, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  }
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      if (url.hostname === "github.com") {
        reachedGitHub = true;
        command("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          body: Buffer.from(
            "<!doctype html><title>Intercepted OAuth destination</title>",
          ).toString("base64"),
        }).catch(() => {});
      } else {
        observedOrigin = Object.entries(request.headers).find(
          ([name]) => name.toLowerCase() === "origin",
        )?.[1];
        command("Fetch.continueRequest", { requestId }).catch(() => {});
      }
    }
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error("browser_command_failed"));
      else entry.resolve(message.result);
    }
  });
  await command("Page.enable");
  await command("Fetch.enable", {
    patterns: [
      { urlPattern: "http://localhost:3000/authorize/*" },
      { urlPattern: "https://github.com/*" },
    ],
  });
  await command("Page.navigate", { url: "http://localhost:3000" });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const result = await command("Runtime.evaluate", {
      expression: "Boolean(document.querySelector('form'))",
      returnByValue: true,
    });
    if (result.result.value) {
      ready = true;
      break;
    }
    await setTimeout(50);
  }
  assert.ok(ready, "local form loaded");
  await command("Runtime.evaluate", {
    expression: "document.querySelector('form').requestSubmit()",
  });
  for (let i = 0; i < 60 && !reachedGitHub; i++) await setTimeout(100);
  console.log(
    JSON.stringify({
      browser: "Chromium",
      originHeader: observedOrigin,
      reachedInterceptedGitHubAuthorization: reachedGitHub,
    }),
  );
  assert.equal(observedOrigin, "http://localhost:3000");
  assert.ok(reachedGitHub, "browser form must pass local security checks");
} finally {
  socket?.close();
  browser.kill("SIGTERM");
  for (const entry of pending.values()) clearTimeout(entry.timer);
  await setTimeout(300);
  await rm(profile, { recursive: true, force: true });
}
