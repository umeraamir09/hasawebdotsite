import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { freePort } from "../support/ports.mjs";

// Real Chromium cookie enforcement, with intercepted HTTPS responses. No DNS,
// provider credentials, or deployed endpoints participate in this check.
export async function checkBrowserCookies(cookies) {
  const debuggingPort = await freePort();
  const profile = await mkdtemp(join(tmpdir(), "hasaweb-auth-browser-"));
  const browser = spawn(
    process.env.AUTH_SPIKE_CHROMIUM ?? "/opt/google/chrome/chrome",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let socket;
  let nextId = 0;
  const pending = new Map();
  let stderr = "";
  let spawnError;
  browser.on("error", (error) => {
    spawnError = error;
  });
  browser.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-4000);
  });
  try {
    let target;
    for (let i = 0; i < 200; i++) {
      if (spawnError) throw spawnError;
      if (browser.exitCode !== null) throw new Error(stderr);
      try {
        const targets = await (
          await fetch(`http://127.0.0.1:${debuggingPort}/json`)
        ).json();
        target = targets.find((entry) => entry.type === "page");
        if (target) break;
      } catch {}
      await setTimeout(100);
    }
    assert.ok(target, "Chromium did not start");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    function command(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = globalThis.setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Browser command timeout: ${method}`));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    let responseCookies = cookies;
    let interceptionError;
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Fetch.requestPaused") {
        command("Fetch.fulfillRequest", {
          requestId: message.params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "text/html" },
            ...responseCookies.map((value) => ({ name: "Set-Cookie", value })),
          ],
          body: Buffer.from(
            "<!doctype html><title>Auth cookie fixture</title>",
          ).toString("base64"),
        }).catch((error) => {
          interceptionError = error;
        });
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });
    await command("Network.enable");
    const version = await command("Browser.getVersion");
    await command("Page.enable");
    await command("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await command("Page.navigate", {
      url: "https://hasaweb.site/cookie-fixture",
    });
    // Network.getCookies runs after navigation has received the intercepted headers.
    const apex = (
      await command("Network.getCookies", { urls: ["https://hasaweb.site/"] })
    ).cookies;
    assert.ok(apex.some((cookie) => cookie.name.endsWith("session_token")));
    assert.ok(apex.some((cookie) => cookie.name.endsWith("session_data")));
    for (const cookie of apex) {
      assert.equal(cookie.domain, "hasaweb.site");
      assert.equal(cookie.secure, true);
      assert.equal(cookie.httpOnly, true);
      assert.equal(cookie.sameSite, "Lax");
      assert.equal(cookie.path, "/");
    }
    for (const url of [
      "https://alice.hasaweb.site/",
      "https://assets.hasaweb.site/",
      "http://hasaweb.site/",
    ]) {
      assert.equal(
        (await command("Network.getCookies", { urls: [url] })).cookies.length,
        0,
      );
    }
    assert.equal(
      await command("Runtime.evaluate", {
        expression: "document.cookie",
        returnByValue: true,
      }).then((result) => result.result.value),
      "",
    );
    const session = apex.find((cookie) =>
      cookie.name.endsWith("session_token"),
    );
    responseCookies = [
      `${session.name}=attacker; Secure; HttpOnly; SameSite=Lax; Path=/; Domain=hasaweb.site`,
    ];
    await command("Page.navigate", {
      url: "https://alice.hasaweb.site/cookie-fixture",
    });
    const after = (
      await command("Network.getCookies", { urls: ["https://hasaweb.site/"] })
    ).cookies;
    assert.equal(
      after.find((cookie) => cookie.name === session.name).value,
      session.value,
    );
    assert.equal(
      (
        await command("Network.getCookies", {
          urls: ["https://alice.hasaweb.site/"],
        })
      ).cookies.length,
      0,
    );
    if (interceptionError) throw interceptionError;
    return {
      browser: version.product,
      cookieCount: apex.length,
      siblingCookies: 0,
      assetHostCookies: 0,
      httpCookies: 0,
      siblingCookieInjectionRejected: true,
    };
  } finally {
    socket?.close();
    for (const entry of pending.values()) clearTimeout(entry.timer);
    if (browser.exitCode === null && browser.signalCode === null) {
      const exited = new Promise((resolve) => browser.once("exit", resolve));
      browser.kill("SIGTERM");
      await Promise.race([exited, setTimeout(3000, undefined, { ref: false })]);
      if (browser.exitCode === null && browser.signalCode === null)
        browser.kill("SIGKILL");
    }
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}
