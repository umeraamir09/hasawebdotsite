import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { writeJsonEvidence } from "./lib/write-json-evidence.mjs";

// Run appearance-catalog-review.mjs --serve first. This checks the review only.
const origin = "http://127.0.0.1:8791";
const catalog = JSON.parse(
  await readFile(
    new URL("../packages/theme/catalog.json", import.meta.url),
    "utf8",
  ),
);
const profile = await mkdtemp(join(tmpdir(), "hasaweb-catalog-"));
const browser = spawn(
  process.env.AUTH_SPIKE_CHROMIUM ?? "/opt/google/chrome/chrome",
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-port=9251",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
let socket;
const errors = [];
const requests = new Set();
let sequence = 0;
const pending = new Map();
try {
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      target = (await (await fetch("http://127.0.0.1:9251/json")).json()).find(
        (entry) => entry.type === "page",
      );
      if (target) break;
    } catch {}
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
    if (message.method === "Network.requestWillBeSent")
      requests.add(message.params.request.url);
    if (message.method === "Network.loadingFailed")
      errors.push(message.params.errorText);
    const item = pending.get(message.id);
    if (item) {
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    }
  });
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
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
      JSON.stringify(result.exceptionDetails),
    );
    return result.result.value;
  }
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Network.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await command("Page.navigate", { url: origin });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await evaluate(
        `document.querySelectorAll('#matrix .mini').length === ${catalog.themes.length * 2}`,
      )
    )
      break;
    await delay(100);
  }
  assert.equal(
    await evaluate("document.querySelectorAll('#matrix .mini').length"),
    catalog.themes.length * 2,
  );
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('#theme option')].map(option => option.value)",
    ),
    catalog.themes.map((theme) => theme.id),
  );
  let combinations = 0;
  for (const width of [360, 768, 1280]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const theme of catalog.themes)
      for (const font of catalog.fonts)
        for (const mode of ["light", "dark", "system"]) {
          const result = await evaluate(`(async () => {
        for (const [id, value] of Object.entries(${JSON.stringify({ theme: theme.id, font: font.id, mode })})) document.getElementById(id).value = value;
        document.getElementById('mode').dispatchEvent(new Event('change'));
        await document.fonts.ready;
        await Promise.all([...document.images].filter(image => image.hasAttribute('src')).map(image => image.decode()));
        return { mode: getComputedStyle(document.getElementById('preview')).colorScheme, family: getComputedStyle(document.getElementById('preview')).fontFamily, tokens: Object.fromEntries(Object.keys(${JSON.stringify(theme.light)}).map(key => [key, document.getElementById('preview').style.getPropertyValue('--' + key)])), overflow: document.documentElement.scrollWidth > innerWidth, images: [...document.images].filter(image => image.hasAttribute('src')).every(image => image.complete && image.naturalWidth > 0), fonts: document.fonts.check('400 16px "${font.family}"') };
      })()`);
          assert.equal(result.mode, mode === "system" ? "light" : mode);
          assert.ok(result.family.includes(font.family));
          assert.deepEqual(
            result.tokens,
            theme[mode === "system" ? "light" : mode],
          );
          assert.equal(
            result.overflow,
            false,
            `${width}/${theme.id}/${font.id}/${mode}`,
          );
          assert.equal(result.images, true);
          assert.equal(result.fonts, true);
          combinations++;
        }
  }
  await evaluate(
    "document.getElementById('mode').value='system'; document.getElementById('mode').dispatchEvent(new Event('change'))",
  );
  await command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await delay(100);
  assert.equal(
    await evaluate(
      "getComputedStyle(document.getElementById('preview')).colorScheme",
    ),
    "dark",
  );
  await evaluate(
    "document.getElementById('alternate').click(); document.getElementById('sample-action').click()",
  );
  assert.equal(
    await evaluate("document.getElementById('avatar-initials').textContent"),
    "A",
  );
  assert.ok(
    (
      await evaluate("document.getElementById('action-feedback').textContent")
    ).includes("No message is sent"),
  );
  await evaluate("document.getElementById('theme').focus()");
  await command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  assert.equal(await evaluate("document.activeElement.id"), "font");
  assert.equal(
    await evaluate("getComputedStyle(document.activeElement).outlineStyle"),
    "solid",
  );
  for (const [name, width, theme, font, mode] of [
    ["desktop", 1280, "leaf", "dm-sans", "light"],
    ["mobile", 360, "strawberry", "lora", "dark"],
    ["matcha", 1280, "matcha", "dm-sans", "light"],
    ["coffee", 1280, "coffee", "manrope", "dark"],
  ]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      `for (const [id,value] of Object.entries(${JSON.stringify({ theme, font, mode })})) document.getElementById(id).value=value; document.getElementById('alternate').checked=false; document.getElementById('mode').dispatchEvent(new Event('change'));`,
    );
    await evaluate("document.fonts.ready");
    await delay(100);
    const { cssContentSize } = await command("Page.getLayoutMetrics");
    const screenshot = await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: cssContentSize.height, scale: 1 },
    });
    await writeFile(
      new URL(
        `../specs/2026-10-17-appearance-catalog/review-${name}.png`,
        import.meta.url,
      ),
      Buffer.from(screenshot.data, "base64"),
    );
  }
  assert.equal((await fetch(`${origin}/.env.github-spike.local`)).status, 404);
  assert.ok(
    [...requests].every((url) => url.startsWith(origin)),
    "Review requests must stay local",
  );
  assert.deepEqual(errors, []);
  const evidence = {
    browser: (await command("Browser.getVersion")).product,
    combinations,
    themes: catalog.themes.map((theme) => theme.id),
    paletteSpecimens: catalog.themes.length * 2,
    semanticTokensMatchCatalog: true,
    widths: [360, 768, 1280],
    systemPreferenceChanges: true,
    localAssetsOnly: true,
    keyboardFocus: true,
    alternateAvatarSpecimen: true,
    browserErrors: errors,
    requests: [...requests],
  };
  await writeJsonEvidence(
    new URL(
      "../specs/2026-10-17-appearance-catalog/browser-results.json",
      import.meta.url,
    ),
    evidence,
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  socket?.close();
  browser.kill("SIGTERM");
  await new Promise((resolve) => browser.once("exit", resolve));
  await rm(profile, { recursive: true, force: true });
}
