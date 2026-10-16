import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

// Render the built app in Chromium. Only provider HTTP and consent are fixtures.
// Browser requests to the auth API execute the product handler in workerd/D1.
export async function checkAuthUi({ root, wrangler, fixturePort }) {
  const port = 8812;
  const uiState = join(root, ".wrangler/auth-ui/state");
  await rm(uiState, { recursive: true, force: true });
  const migrate = spawnSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "migrations",
      "apply",
      "hasaweb-local",
      "--local",
      "--config",
      "apps/web/wrangler.jsonc",
      "--persist-to",
      uiState,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);
  const profile = await mkdtemp(join(tmpdir(), "hasaweb-auth-ui-"));
  // The built Worker now routes owner requests through the named jobs entry.
  const jobsConfig = join(root, ".wrangler/auth-ui/jobs.json");
  const jobs = JSON.parse(
    await readFile(join(root, "apps/jobs/wrangler.jsonc"), "utf8"),
  );
  jobs.main = join(root, "apps/jobs/src/index.ts");
  jobs.d1_databases[0].migrations_dir = join(root, "packages/db/migrations");
  jobs.vars = {
    APP_ENV: "local",
    APP_ORIGIN: `http://127.0.0.1:${port}`,
    BETTER_AUTH_SECRET: "local-browser-fixture-secret-with-32-characters",
    GITHUB_CLIENT_ID: "fixture-github",
    GITHUB_CLIENT_SECRET: "fixture-secret",
    GOOGLE_CLIENT_ID: "fixture-google",
    GOOGLE_CLIENT_SECRET: "fixture-secret",
  };
  await writeFile(jobsConfig, JSON.stringify(jobs));
  const server = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--config",
      "apps/web/wrangler.jsonc",
      "--config",
      jobsConfig,
      "--persist-to",
      uiState,
      "--port",
      String(port),
      "--inspector-port",
      "9248",
      "--ip",
      "127.0.0.1",
      "--var",
      `APP_ORIGIN:http://127.0.0.1:${port}`,
      "--var",
      "BETTER_AUTH_SECRET:local-browser-fixture-secret-with-32-characters",
      "--var",
      "GITHUB_CLIENT_ID:fixture-github",
      "--var",
      "GITHUB_CLIENT_SECRET:fixture-secret",
      "--var",
      "GOOGLE_CLIENT_ID:fixture-google",
      "--var",
      "GOOGLE_CLIENT_SECRET:fixture-secret",
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
    },
  );
  let serverLogs = "";
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (data) => {
      serverLogs = (serverLogs + data).slice(-4000);
    });
  let browser;
  let socket;
  const pending = new Map();
  let nextId = 0;
  const checks = [];
  let interceptError;
  let providerMode = "success";
  let nextFailure = false;
  let held;
  let holdSignIn = false;
  let signInCalls = 0;
  const exceptions = [];
  const requests = [];
  try {
    for (let i = 0; i < 300; i++) {
      if (server.exitCode !== null) throw new Error(serverLogs);
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
      } catch {}
      await setTimeout(100);
    }
    // Exercise the actual web/auth adapters, named owner binding and local cookies.
    const signedOut = await fetch(`http://127.0.0.1:${port}/api/owner`);
    assert.equal(signedOut.status, 401);
    assert.equal(signedOut.headers.get("cache-control"), "private, no-store");
    const signIn = await fetch(
      `http://127.0.0.1:${port}/api/auth/sign-in/social`,
      {
        method: "POST",
        headers: {
          Origin: `http://127.0.0.1:${port}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "github",
          callbackURL: `http://127.0.0.1:${port}/editor`,
          errorCallbackURL: `http://127.0.0.1:${port}/sign-in?provider=github`,
        }),
      },
    );
    assert.equal(signIn.status, 200);
    assert.ok(
      signIn.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith("hasaweb-local.")),
    );
    const providerURL = new URL((await signIn.json()).url);
    assert.equal(
      providerURL.searchParams.get("redirect_uri"),
      `http://127.0.0.1:${port}/api/auth/callback/github`,
    );
    checks.push(
      "built web/auth adapters and named owner binding reach the real handlers",
    );
    browser = spawn(
      process.env.AUTH_SPIKE_CHROMIUM ?? "/opt/google/chrome/chrome",
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
    let browserError;
    browser.on("error", (error) => {
      browserError = error;
    });
    let target;
    for (let i = 0; i < 200; i++) {
      if (browserError) throw browserError;
      try {
        target = (
          await (await fetch("http://127.0.0.1:9246/json")).json()
        ).find((item) => item.type === "page");
        if (target) break;
      } catch {}
      await setTimeout(100);
    }
    assert.ok(target, "Chromium must start");
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
          reject(new Error(`CDP timeout: ${method}`));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    async function fulfill(requestId, status, headers, body = "") {
      await command("Fetch.fulfillRequest", {
        requestId,
        responseCode: status,
        responseHeaders: headers,
        body: Buffer.from(body).toString("base64"),
      });
    }
    async function intercept(params) {
      const { requestId, request } = params;
      const url = new URL(request.url);
      requests.push({
        host: url.hostname,
        path: url.pathname,
        method: request.method,
      });
      if (url.hostname !== "hasaweb.site") {
        const provider = url.hostname === "github.com" ? "github" : "google";
        const query = new URLSearchParams({
          state: url.searchParams.get("state"),
        });
        if (providerMode === "cancel") query.set("error", "access_denied");
        else query.set("code", "explicit");
        return fulfill(requestId, 302, [
          {
            name: "Location",
            value: `https://hasaweb.site/api/auth/callback/${provider}?${query}`,
          },
        ]);
      }
      if (url.pathname === "/api/auth/sign-in/social") {
        signInCalls++;
        if (holdSignIn)
          await new Promise((resolve) => {
            held = resolve;
          });
        if (nextFailure) {
          nextFailure = false;
          return fulfill(
            requestId,
            503,
            [{ name: "Content-Type", value: "application/json" }],
            "{}",
          );
        }
      }
      const api =
        url.pathname.startsWith("/api/auth/") || url.pathname === "/api/owner";
      const headers = new Headers(request.headers);
      // CDP's paused-request headers may omit Cookie. Read Chromium's scoped
      // jar rather than manufacturing cookies or accepting a caller's user ID.
      if (api) {
        const { cookies } = await command("Network.getCookies", {
          urls: [url.href],
        });
        headers.set(
          "Cookie",
          cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
        );
      }
      headers.delete("host");
      headers.delete("accept-encoding");
      const response = await fetch(
        `http://127.0.0.1:${api ? fixturePort : port}${url.pathname}${url.search}`,
        {
          method: request.method,
          headers,
          ...(request.postData ? { body: request.postData } : {}),
          redirect: "manual",
        },
      );
      const returned = [];
      response.headers.forEach((value, name) => {
        if (
          ![
            "set-cookie",
            "content-encoding",
            "content-length",
            "transfer-encoding",
          ].includes(name)
        )
          returned.push({ name, value });
      });
      for (const value of response.headers.getSetCookie())
        returned.push({ name: "Set-Cookie", value });
      await command("Fetch.fulfillRequest", {
        requestId,
        responseCode: response.status,
        responseHeaders: returned,
        body: Buffer.from(await response.arrayBuffer()).toString("base64"),
      });
    }
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Fetch.requestPaused")
        void intercept(message.params).catch((error) => {
          interceptError = error;
        });
      if (message.method === "Runtime.exceptionThrown")
        exceptions.push(message.params.exceptionDetails.text);
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    });
    const evaluate = async (expression) =>
      (
        await command("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        })
      ).result.value;
    async function until(expression) {
      for (let i = 0; i < 150; i++) {
        if (interceptError) throw interceptError;
        if (await evaluate(expression)) return;
        await setTimeout(100);
      }
      const state = await evaluate(
        "({path:location.pathname,error:new URLSearchParams(location.search).get('error'),text:document.body.innerText})",
      );
      await screenshot("browser-failure");
      throw new Error(
        `Browser condition failed: ${expression}; ${JSON.stringify({ state, requests })}`,
      );
    }
    async function navigate(path) {
      await command("Page.navigate", { url: `https://hasaweb.site${path}` });
      await until("document.readyState === 'complete'");
    }
    async function screenshot(name) {
      await evaluate("document.fonts.ready.then(()=>true)");
      const result = await command("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
      });
      await writeFile(
        join(root, `specs/2026-10-15-sign-in/${name}.png`),
        Buffer.from(result.data, "base64"),
      );
    }
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Network.enable");
    await command("Fetch.enable", {
      patterns: [
        { urlPattern: "https://hasaweb.site/*" },
        { urlPattern: "https://github.com/*" },
        { urlPattern: "https://accounts.google.com/*" },
      ],
    });
    await command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate("/sign-in");
    await until(
      "document.querySelectorAll('.provider-button').length === 2 && document.fonts.status === 'loaded'",
    );
    await until(
      "Array.from(document.images).filter(i=>getComputedStyle(i).display !== 'none').every(i=>i.complete && i.naturalWidth>0)",
    );
    await screenshot("sign-in-desktop");
    const desktop = await evaluate(
      "({overflow:document.documentElement.scrollWidth>innerWidth,visual:document.querySelector('.auth-visual').getBoundingClientRect().toJSON(),fonts:[...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight})),icons:Array.from(document.querySelectorAll('.provider-button img')).map(i=>({src:i.getAttribute('src'),w:i.getBoundingClientRect().width,h:i.getBoundingClientRect().height}))})",
    );
    assert.equal(desktop.overflow, false);
    assert.equal(desktop.visual.width, 576);
    assert.equal(desktop.icons.length, 5);
    for (const icon of desktop.icons) {
      assert.ok(icon.w > 0 && icon.h > 0);
    }
    checks.push(
      "desktop follows Figma artwork, typography, 576px visual and provider assets",
    );
    for (const width of [360, 390, 768]) {
      await command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 840,
        deviceScaleFactor: 1,
        mobile: true,
      });
      assert.equal(
        await evaluate("document.documentElement.scrollWidth > innerWidth"),
        false,
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('.auth-visual')).display",
        ),
        "none",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.assembly-mobile').getBoundingClientRect().height",
        ),
        180,
      );
      if (width === 360) await screenshot("sign-in-mobile");
    }
    checks.push(
      "360px, 390px and 768px layouts have no overflow and show the mobile artwork",
    );
    await command("Page.navigate", {
      url: "https://hasaweb.site/sign-in?error=access_denied",
    });
    await until(
      "document.querySelector('[role=alert]')?.textContent.includes('cancelled')",
    );
    await screenshot("sign-in-cancelled");
    checks.push("cancelled callbacks show a safe retry path");
    nextFailure = true;
    holdSignIn = true;
    await evaluate(
      "document.querySelector('.provider-button').click();document.querySelector('.provider-button').click()",
    );
    await until(
      "Array.from(document.querySelectorAll('.provider-button')).every(b=>b.disabled) && document.querySelector('[role=status]').textContent.includes('Connecting')",
    );
    assert.equal(signInCalls, 1);
    await screenshot("sign-in-connecting");
    holdSignIn = false;
    held();
    await until(
      "document.querySelector('[role=alert]')?.textContent.includes('connection') && !document.querySelector('.provider-button').disabled",
    );
    checks.push(
      "pending status is announced, duplicate requests are blocked, and a failed start re-enables retry",
    );
    // Keyboard Enter starts Google sign-in, with a cancelled consent fixture.
    providerMode = "cancel";
    await command("Page.bringToFront");
    await evaluate("document.querySelectorAll('.provider-button')[1].focus()");
    assert.equal(
      await evaluate(
        "document.activeElement === document.querySelectorAll('.provider-button')[1]",
      ),
      true,
    );
    await command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: "\r",
      unmodifiedText: "\r",
    });
    await command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await until(
      "location.search.includes('error=access_denied') && document.querySelector('[role=alert]')?.textContent.includes('cancelled')",
    );
    checks.push(
      "keyboard provider activation and cancelled provider consent return to retry",
    );
    providerMode = "success";
    await evaluate("document.querySelector('.provider-button').click()");
    await until(
      "location.pathname === '/editor' && document.querySelector('h1')?.textContent.includes('Welcome, explicit.')",
    );
    checks.push(
      "GitHub OAuth callback opens the authenticated editor for the existing owner",
    );
    const githubOwner = await evaluate(
      "fetch('/api/owner', {cache:'no-store'}).then(r=>r.json())",
    );
    await screenshot("editor-entry");
    await evaluate("document.querySelector('button').click()");
    await until(
      "location.pathname === '/sign-in' && document.querySelectorAll('.provider-button').length === 2",
    );
    await evaluate("document.querySelectorAll('.provider-button')[1].click()");
    await until(
      "location.pathname === '/editor' && document.querySelector('h1')?.textContent.includes('Welcome, explicit.')",
    );
    const googleOwner = await evaluate(
      "fetch('/api/owner', {cache:'no-store'}).then(r=>r.json())",
    );
    assert.deepEqual(googleOwner, githubOwner);
    checks.push("sign-out and Google reauthentication reopen the same account");
    await evaluate("document.querySelector('button').click()");
    await until("location.pathname === '/sign-in'");
    await navigate("/editor");
    await until(
      "location.pathname === '/sign-in' && location.search.includes('session_expired')",
    );
    assert.equal(
      await evaluate(
        "document.body.textContent.includes('Welcome, explicit.')",
      ),
      false,
    );
    checks.push(
      "signed-out editor navigation redirects without rendering private owner identity",
    );
    assert.deepEqual(exceptions, []);
    return {
      browser: (await command("Browser.getVersion")).product,
      checks,
      desktop,
      exceptions,
    };
  } finally {
    held?.();
    socket?.close();
    for (const item of pending.values()) clearTimeout(item.timer);
    for (const [child, group] of [
      [browser, false],
      [server, true],
    ]) {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        if (group) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
        await Promise.race([
          exited,
          setTimeout(3000, undefined, { ref: false }),
        ]);
        if (child.exitCode === null && child.signalCode === null) {
          if (group) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        }
      }
    }
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    await rm(uiState, { recursive: true, force: true });
  }
}
