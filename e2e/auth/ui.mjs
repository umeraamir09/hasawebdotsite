import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { createEvidenceDirectory } from "../support/evidence-directory.mjs";
import { freePort } from "../support/ports.mjs";

// Render the built app in Chromium. Only provider HTTP and consent are fixtures.
// Browser requests to the auth API execute the product handler in workerd/D1.
export async function checkAuthUi({
  root,
  wrangler,
  fixturePort,
  evidenceDirectory,
}) {
  evidenceDirectory ??= await createEvidenceDirectory(root, "auth-ui");
  const require = createRequire(import.meta.url);
  const esbuild = createRequire(require.resolve("wrangler"))("esbuild");
  const helper = await esbuild.build({
    entryPoints: [join(root, "apps/web/integration/auth-recovery-fixture.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const helperCode = helper.outputFiles[0].text;
  const port = await freePort();
  const inspectorPort = await freePort();
  const debuggingPort = await freePort();
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
  const seedSession = spawnSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "apps/web/wrangler.jsonc",
      "--persist-to",
      uiState,
      "--command",
      `
    INSERT INTO user(id,name,email,created_at,updated_at) VALUES('entry-binding-owner','Local binding owner','entry-binding@example.invalid',1,1);
    INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES('entry-binding-session','entry-binding-token','entry-binding-owner',${Date.now() + 3600000},1,1);
  `,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  assert.equal(seedSession.status, 0, seedSession.stdout + seedSession.stderr);
  const profile = await mkdtemp(join(tmpdir(), "hasaweb-auth-ui-"));
  // The built Worker now routes owner requests through the named jobs entry.
  const jobsConfig = join(root, ".wrangler/auth-ui/jobs.json");
  const jobs = JSON.parse(
    await readFile(join(root, "apps/jobs/wrangler.jsonc"), "utf8"),
  );
  jobs.main = join(root, "apps/jobs/src/index.ts");
  jobs.assets.directory = join(root, "apps/jobs/dist/platform");
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
      String(inspectorPort),
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
  const interceptions = new Map();
  let cancelledResponse;
  let cancelledRequest;
  let providerMode = "success";
  let nextFailure = false;
  let loseInitializationResponse = false;
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
    // Phase 42E: the account pages resolve the activation gate per request.
    // With the committed (closed) gate they keep the welcome shell, are never
    // stored and ask not to be indexed; the editor preview document is not
    // registered.
    for (const path of ["/auth/entry", "/editor"]) {
      const shell = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(shell.status, 200, path);
      assert.match(shell.headers.get("cache-control") ?? "", /no-store/, path);
      const html = await shell.text();
      assert.match(
        html,
        /<meta name="robots" content="noindex, nofollow"/,
        path,
      );
      assert.doesNotMatch(html, /Take a look around|setup-guide/, path);
    }
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/editor/preview`)).status,
      404,
    );
    const bindingOrigin = `http://127.0.0.1:${port}`;
    const signature = createHmac(
      "sha256",
      "local-browser-fixture-secret-with-32-characters",
    )
      .update("entry-binding-token")
      .digest("base64");
    const bindingCookie = `hasaweb-local.session_token=${encodeURIComponent(`entry-binding-token.${signature}`)}`;
    const bindingOwner = async () =>
      (
        await fetch(`${bindingOrigin}/api/owner`, {
          headers: { Cookie: bindingCookie },
        })
      ).json();
    assert.equal((await bindingOwner()).portfolio, null);
    const bindingResponse = await fetch(
      `${bindingOrigin}/api/owner/portfolio`,
      {
        method: "POST",
        headers: {
          Cookie: bindingCookie,
          Origin: bindingOrigin,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(bindingResponse.status, 200);
    assert.equal(
      bindingResponse.headers.get("cache-control"),
      "private, no-store",
    );
    const bindingResult = await bindingResponse.json();
    assert.equal(bindingResult.user.id, "entry-binding-owner");
    assert.ok(bindingResult.portfolio.id);
    assert.deepEqual(await bindingOwner(), bindingResult);
    checks.push(
      "built web Worker forwards authenticated initialization through the named jobs binding and persists the same portfolio in D1",
    );
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
          callbackURL: `http://127.0.0.1:${port}/auth/entry`,
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
        `--remote-debugging-port=${debuggingPort}`,
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
          await (await fetch(`http://127.0.0.1:${debuggingPort}/json`)).json()
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
      const interception = interceptions.get(requestId);
      assert.ok(interception, "Cannot fulfill an unknown paused request");
      assert.equal(
        interception.fulfillmentAttempted,
        false,
        "A paused request can only be fulfilled once",
      );
      interception.fulfillmentAttempted = true;
      if (interception.cancelled) {
        interception.measurement.retired = "browser-cancelled";
        return;
      }
      try {
        await command("Fetch.fulfillRequest", {
          requestId,
          responseCode: status,
          responseHeaders: headers,
          body: Buffer.from(body).toString("base64"),
        });
      } catch (error) {
        let protocolError;
        try {
          protocolError = JSON.parse(error.message);
        } catch {}
        if (
          protocolError?.code === -32602 &&
          protocolError.message === "Invalid InterceptionId."
        ) {
          interception.measurement.retired = "interception-retired";
          return;
        }
        throw error;
      }
    }
    async function intercept(params) {
      const { requestId, request } = params;
      const url = new URL(request.url);
      const measurement = {
        host: url.hostname,
        path: url.pathname,
        method: request.method,
      };
      requests.push(measurement);
      interceptions.get(requestId).measurement = measurement;
      if (url.pathname === "/__cancelled-response-fixture") {
        cancelledRequest = interceptions.get(requestId);
        await new Promise((resolve) => {
          cancelledResponse = resolve;
        });
        return fulfill(requestId, 200, [], "cancelled response");
      }
      if (url.hostname !== "hasaweb.site") {
        if (providerMode === "hold")
          return fulfill(
            requestId,
            200,
            [{ name: "Content-Type", value: "text/html" }],
            "<!doctype html><title>Provider consent fixture</title><p>Consent fixture</p>",
          );
        const provider = url.hostname === "github.com" ? "github" : "google";
        const query = new URLSearchParams({
          state: url.searchParams.get("state"),
        });
        if (providerMode === "cancel") query.set("error", "access_denied");
        else
          query.set(
            "code",
            providerMode === "wrong"
              ? "other"
              : providerMode === "failure"
                ? "unknown-fixture"
                : "explicit",
          );
        return fulfill(requestId, 302, [
          {
            name: "Location",
            value: `https://hasaweb.site/api/auth/callback/${provider}?${query}`,
          },
        ]);
      }
      if (url.pathname === "/__recovery-fixture.js")
        return fulfill(
          requestId,
          200,
          [{ name: "Content-Type", value: "text/javascript" }],
          helperCode,
        );
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
        url.pathname.startsWith("/api/auth/") ||
        url.pathname === "/api/owner" ||
        url.pathname.startsWith("/api/owner/") ||
        url.pathname.startsWith("/__fixture/");
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
      if (api)
        Object.assign(measurement, {
          status: response.status,
          reads: Number(response.headers.get("X-Fixture-Rows-Read")),
          writes: Number(response.headers.get("X-Fixture-Rows-Written")),
          queries: Number(response.headers.get("X-Fixture-Queries")),
        });
      if (url.pathname === "/api/owner/entry" && loseInitializationResponse) {
        loseInitializationResponse = false;
        assert.equal(response.status, 200);
        await response.text();
        return fulfill(
          requestId,
          503,
          [{ name: "Content-Type", value: "application/json" }],
          "null",
        );
      }
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
      await fulfill(
        requestId,
        response.status,
        returned,
        await response.arrayBuffer(),
      );
    }
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (
        message.method === "Network.loadingFailed" &&
        message.params.canceled
      ) {
        for (const interception of interceptions.values()) {
          if (interception.networkId === message.params.requestId)
            interception.cancelled = true;
        }
      }
      if (message.method === "Fetch.requestPaused") {
        const interception = {
          requestId: message.params.requestId,
          networkId: message.params.networkId,
          cancelled: false,
          settled: false,
          fulfillmentAttempted: false,
        };
        interceptions.set(message.params.requestId, interception);
        void intercept(message.params)
          .catch((error) => {
            const url = new URL(message.params.request.url);
            interceptError = new Error(
              `${message.params.request.method} ${url.hostname}${url.pathname}: ${error.message}; browser cancelled=${interception.cancelled}`,
              { cause: error },
            );
          })
          .finally(() => {
            interception.settled = true;
            interceptions.delete(message.params.requestId);
          });
      }
      if (message.method === "Runtime.exceptionThrown")
        exceptions.push(message.params.exceptionDetails.text);
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    });
    const evaluate = async (expression) => {
      const response = await command("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (response.exceptionDetails)
        throw new Error(
          response.exceptionDetails.exception?.description ??
            response.exceptionDetails.text,
        );
      return response.result.value;
    };
    async function until(expression) {
      for (let i = 0; i < 150; i++) {
        if (interceptError) throw interceptError;
        if (await evaluate(expression).catch(() => false)) return;
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
        join(evidenceDirectory, `${name}.png`),
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
    await evaluate(`
      window.cancelledFixtureController = new AbortController();
      window.cancelledFixtureResult = 'pending';
      fetch('/__cancelled-response-fixture', {signal: window.cancelledFixtureController.signal})
        .catch(error => { window.cancelledFixtureResult = error.name; });
      true;
    `);
    for (let i = 0; i < 100 && !cancelledResponse; i++) await setTimeout(20);
    assert.ok(
      cancelledResponse,
      "cancellation fixture must pause a browser request",
    );
    await evaluate("window.cancelledFixtureController.abort(); true");
    await until("window.cancelledFixtureResult === 'AbortError'");
    for (let i = 0; i < 100 && !cancelledRequest.cancelled; i++)
      await setTimeout(20);
    assert.equal(
      cancelledRequest.cancelled,
      true,
      "Chromium must report cancellation",
    );
    cancelledResponse();
    for (let i = 0; i < 100 && !cancelledRequest.settled; i++)
      await setTimeout(20);
    assert.equal(cancelledRequest.settled, true);
    assert.equal(interceptError, undefined);
    await assert.rejects(
      fulfill(cancelledRequest.requestId, 200, []),
      /unknown paused request/,
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.provider-button').length"),
      2,
    );
    checks.push(
      "browser-cancelled subrequests settle without invalid late fulfillment or hiding active request failures",
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
    loseInitializationResponse = true;
    await evaluate("document.querySelector('.provider-button').click()");
    await until(
      "location.pathname === '/auth/entry' && document.querySelector('[role=alert]')?.textContent.includes('retry')",
    );
    assert.equal(await evaluate("!!document.querySelector('h1')"), false);
    await evaluate("document.querySelector('.auth-error button').click()");
    await until(
      "location.pathname === '/auth/entry' && document.querySelector('h1')?.textContent.includes('Welcome, explicit.')",
    );
    checks.push(
      "account entry retries a lost successful initialization response before displaying the authenticated owner",
    );
    const githubOwner = await evaluate(
      "fetch('/api/owner', {cache:'no-store'}).then(r=>r.json())",
    );
    assert.ok(githubOwner.portfolio.id);
    await screenshot("editor-entry");
    await evaluate("document.querySelector('button').click()");
    await until(
      "location.pathname === '/sign-in' && document.querySelectorAll('.provider-button').length === 2",
    );
    await evaluate("document.querySelectorAll('.provider-button')[1].click()");
    await until(
      "location.pathname === '/auth/entry' && document.querySelector('h1')?.textContent.includes('Welcome, explicit.')",
    );
    const googleOwner = await evaluate(
      "fetch('/api/owner', {cache:'no-store'}).then(r=>r.json())",
    );
    assert.deepEqual(googleOwner, githubOwner);
    checks.push("sign-out and Google reauthentication reopen the same account");
    for (const provider of ["github", "google"]) {
      const before = requests.filter((request) =>
        request.path.endsWith("/patch"),
      ).length;
      await evaluate("import('/__recovery-fixture.js')");
      await evaluate(
        `void window.recoveryFixture.prepare('${provider}', true).catch(e => { window.recoveryFailure = e.message; })`,
      );
      const accountLink =
        "Array.from(document.querySelectorAll('a')).find(a => a.textContent === 'Open your account' && a.getAttribute('href') === '/auth/entry')";
      await until(
        `location.pathname === '/auth/recovery' && !!(${accountLink})`,
      );
      await command("Page.reload");
      await until(`!!(${accountLink})`);
      assert.equal(
        requests.filter((request) => request.path.endsWith("/patch")).length,
        before,
      );
      await evaluate(`(${accountLink}).click()`);
      await until(
        "location.pathname === '/auth/entry' && document.querySelector('h1')?.textContent.includes('Welcome, explicit.')",
      );
    }
    checks.push(
      "clean recovery and expiry before the first draft read offer account entry across callback reload without draft writes",
    );
    for (const provider of ["github", "google"]) {
      await evaluate("import('/__recovery-fixture.js')");
      await evaluate(
        `void window.recoveryFixture.prepare('${provider}').catch(e => { window.recoveryFailure = e.message; })`,
      );
      await until(
        "location.pathname === '/auth/recovery' && Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Continue preserved edits' && !b.disabled)",
      );
      const continuation = await evaluate(
        "JSON.parse(sessionStorage.getItem('hasaweb-draft-auth-v1'))",
      );
      assert.deepEqual(
        Object.keys(continuation).sort(),
        [
          "context",
          "flow",
          "ownerId",
          "portfolioId",
          "recordId",
          "version",
        ].sort(),
      );
      assert.equal(continuation.ownerId, githubOwner.user.id);
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Continue preserved edits').click()",
      );
      await until(
        `document.querySelector('[role=status]')?.textContent === 'Unsaved input' && document.body.textContent.includes('Unfinished input')`,
      );
      const saved = await evaluate(
        `fetch('/api/owner/draft',{headers:{'X-Expected-Owner-Id':'${githubOwner.user.id}'}}).then(r=>r.json())`,
      );
      assert.equal(saved.draft.profile.name, `Recovered with ${provider}`);
      await screenshot(`recovery-${provider}`);
      const continued = await evaluate(
        "JSON.parse(sessionStorage.getItem('hasaweb-draft-auth-v1'))",
      );
      assert.equal(continued.ownerId, continuation.ownerId);
      assert.notEqual(continued.recordId, continuation.recordId);
      const beforeReplay = requests.filter((request) =>
        request.path.endsWith("/patch"),
      ).length;
      await command("Page.reload");
      await until(
        "Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Continue preserved edits' && !b.disabled)",
      );
      assert.equal(
        requests.filter((request) => request.path.endsWith("/patch")).length,
        beforeReplay,
      );
      assert.deepEqual(
        await evaluate(
          "JSON.parse(sessionStorage.getItem('hasaweb-draft-auth-v1'))",
        ),
        continued,
      );
      await navigate("/editor");
      await until(
        "document.querySelector('h1')?.textContent.includes('Welcome, explicit.')",
      );
    }
    checks.push(
      "GitHub and Google same-tab expired-session recovery explicitly confirm preserved saves and keep raw input; callback replay is safe",
    );
    await evaluate("import('/__recovery-fixture.js')");
    await evaluate(
      "void window.recoveryFixture.prepareReview().catch(e => { window.recoveryFailure = e.message; })",
    );
    await until(
      "location.pathname === '/auth/recovery' && Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Reopen review' && !b.disabled)",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Reopen review').click()",
    );
    await until(
      "document.querySelectorAll('input[type=checkbox]:checked').length === 1",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Apply selected changes').click()",
    );
    await until(
      "document.querySelector('[role=status]')?.textContent === 'Unsaved input'",
    );
    const reviewedSave = await evaluate(
      `fetch('/api/owner/draft',{headers:{'X-Expected-Owner-Id':'${githubOwner.user.id}'}}).then(r=>r.json())`,
    );
    assert.equal(
      reviewedSave.draft.profile.name,
      "Preserved review after auth",
    );
    assert.equal(
      reviewedSave.draft.profile.bio,
      "Newer content before review sign-in",
    );
    checks.push(
      "expiry during conflict review preserves selected decisions through sign-in and saves against the newer draft",
    );
    await navigate("/editor");
    await until(
      "document.querySelector('h1')?.textContent.includes('Welcome, explicit.')",
    );
    await evaluate("import('/__recovery-fixture.js')");
    providerMode = "cancel";
    await evaluate(
      "void window.recoveryFixture.prepare('github').catch(e => { window.recoveryFailure = e.message; })",
    );
    await until(
      "location.pathname === '/auth/recovery/error' && document.body.textContent.includes('cancelled')",
    );
    const interruptedContinuation = await evaluate(
      "sessionStorage.getItem('hasaweb-draft-auth-v1')",
    );
    assert.ok(interruptedContinuation);
    providerMode = "hold";
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Sign in with GitHub').click()",
    );
    await until("location.hostname === 'github.com'");
    const history = await command("Page.getNavigationHistory");
    await command("Page.navigateToHistoryEntry", {
      entryId: history.entries[history.currentIndex - 1].id,
    });
    await until(
      "location.pathname === '/auth/recovery/error' && Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Sign in with GitHub' && !b.disabled)",
    );
    assert.equal(
      await evaluate("sessionStorage.getItem('hasaweb-draft-auth-v1')"),
      interruptedContinuation,
    );
    checks.push(
      "Back from provider consent preserves tab continuation and re-enables recovery sign-in",
    );
    providerMode = "failure";
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Sign in with Google').click()",
    );
    await until(
      `location.pathname === '/auth/recovery/error' && document.body.textContent.includes("Sign-in didn't finish")`,
    );
    assert.equal(
      await evaluate("sessionStorage.getItem('hasaweb-draft-auth-v1')"),
      interruptedContinuation,
    );
    providerMode = "wrong";
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Sign in with GitHub').click()",
    );
    await until(
      "location.pathname === '/auth/recovery' && document.body.textContent.includes('different account or portfolio')",
    );
    assert.equal(
      await evaluate("sessionStorage.getItem('hasaweb-draft-auth-v1')"),
      interruptedContinuation,
    );
    await command("Page.reload");
    await until(
      "document.body.textContent.includes('different account or portfolio')",
    );
    providerMode = "success";
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Sign in with GitHub').click()",
    );
    await until(
      "Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Continue preserved edits' && !b.disabled)",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Continue preserved edits').click()",
    );
    await until(
      "document.querySelector('[role=status]')?.textContent === 'Unsaved input'",
    );
    checks.push(
      "recovery cancellation, token failure, wrong account and reload preserve the continuation until original-account recovery succeeds",
    );
    await evaluate("sessionStorage.removeItem('hasaweb-draft-auth-v1')");
    await command("Page.reload");
    await until(
      "document.body.textContent.includes('No recovery continuation')",
    );
    checks.push(
      "missing continuation falls back to ordinary account entry without provisioning",
    );
    await navigate("/editor");
    await until(
      "document.querySelector('h1')?.textContent.includes('Welcome, explicit.')",
    );

    assert.equal(await evaluate("location.pathname"), "/auth/entry");
    checks.push(
      "direct editor navigation resolves incomplete owners to controlled account entry",
    );
    assert.equal(
      await evaluate(
        "fetch('/__fixture/editor-entry',{method:'POST'}).then(r=>r.status)",
      ),
      200,
    );
    for (const destination of ["/sign-in", "/auth/entry", "/editor"]) {
      await navigate(destination);
      await until(
        "location.pathname === '/editor' && document.querySelector('h1')?.textContent.includes('Welcome, explicit.')",
      );
    }
    await evaluate(
      `fetch('/api/owner/progress',{headers:{'X-Expected-Owner-Id':'${githubOwner.user.id}'}}).then(r=>r.json()).then(p=>fetch('/api/owner/draft/patch',{method:'POST',headers:{'Content-Type':'application/json','X-Expected-Owner-Id':'${githubOwner.user.id}'},body:JSON.stringify({context:'content',revision:p.revision,change:{op:'set',path:['profile','name'],value:''}})}))`,
    );
    await navigate("/sign-in");
    await until(
      "location.pathname === '/editor' && document.querySelector('h1')?.textContent.includes('Welcome, explicit.')",
    );
    checks.push(
      "entered owners return to the editor through sign-in, account entry and direct navigation after required content removal",
    );
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
      requests,
      exceptions,
    };
  } finally {
    cancelledResponse?.();
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
