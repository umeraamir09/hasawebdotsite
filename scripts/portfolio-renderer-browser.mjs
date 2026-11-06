import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createEvidenceDirectory } from "./lib/evidence-directory.mjs";
import { writeJsonEvidence } from "./lib/write-json-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("wrangler"))("esbuild");
const output = join(root, ".wrangler/portfolio-renderer");
const evidence = await createEvidenceDirectory(
  root,
  "renderer",
  process.env.RENDERER_EVIDENCE,
);
await mkdir(output, { recursive: true });
await mkdir(evidence, { recursive: true });
const resources = new Map();
const platformManifest = JSON.parse(
  await readFile(
    join(root, "packages/components/static/manifest.json"),
    "utf8",
  ),
);
function resource(bytes, suffix, type) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = `/platform/${hash.slice(0, 20)}.${suffix}`;
  resources.set(path, { bytes, type, hash });
  return path;
}
async function bundle(entry, platform, format) {
  const result = await esbuild.build({
    entryPoints: [join(root, entry)],
    bundle: true,
    platform,
    format,
    target: "es2022",
    minify: true,
    write: false,
    logLevel: "error",
  });
  return result.outputFiles[0].contents;
}
const cssResult = await esbuild.build({
  entryPoints: [join(root, "packages/components/static/portfolio.css")],
  bundle: true,
  write: false,
  logLevel: "error",
  external: ["/portfolio-platform/*"],
});
const cssUrl = resource(
  cssResult.outputFiles[0].contents,
  "css",
  "text/css; charset=utf-8",
);
const hostCss = resource(
  Buffer.from("iframe{border:0;display:block;width:100%}"),
  "css",
  "text/css; charset=utf-8",
);
const siteBytes = await bundle(
  "scripts/fixtures/portfolio-site.ts",
  "browser",
  "iife",
);
const scriptUrl = resource(siteBytes, "js", "text/javascript; charset=utf-8");
const previewScript = resource(
  await bundle(
    "scripts/fixtures/portfolio-renderer-browser.ts",
    "browser",
    "esm",
  ),
  "js",
  "text/javascript; charset=utf-8",
);
const hostScript = resource(
  await bundle("scripts/fixtures/portfolio-renderer-host.ts", "browser", "esm"),
  "js",
  "text/javascript; charset=utf-8",
);
const serverModule = join(output, "fixture-server.cjs");
await esbuild.build({
  entryPoints: [join(root, "scripts/fixtures/portfolio-renderer-server.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  nodePaths: [join(root, "packages/render/node_modules")],
  outfile: serverModule,
  logLevel: "error",
});
const { createFixtures } = require(serverModule);
let fixtures;
let decorations;
let policy;
let origin;
const requests = [];
const failures = [];
const checks = [];
const mime = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};
const media = {
  "avatar.png":
    "apps/web/public/assets/ed716e56-02ad-4f30-a9e8-803c79346a83.png",
  "banner.png": "apps/web/public/auth/assembly-desktop.png",
};
function authorized(request) {
  return request.headers.cookie
    ?.split(";")
    .some((part) => part.trim() === "renderer-session=fixture-owner-a");
}
function shell(script, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Private renderer fixture</title><link rel="stylesheet" href="${cssUrl}"><link rel="stylesheet" href="${hostCss}"><script type="module" src="${script}"></script></head><body>${body}</body></html>`;
}
async function handle(request, response) {
  const url = new URL(request.url, origin);
  requests.push({ method: request.method, path: url.pathname });
  if (url.pathname.startsWith("/private/") && !authorized(request)) {
    response.writeHead(404, {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Type": "text/plain",
    });
    response.end("Not found");
    return;
  }
  const resourceFile = resources.get(url.pathname);
  if (resourceFile) {
    response.writeHead(200, {
      "Content-Type": resourceFile.type,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    response.end(resourceFile.bytes);
    return;
  }
  if (url.pathname.startsWith("/portfolio-platform/")) {
    const entry = Object.entries(platformManifest).find(
      ([, path]) => path === url.pathname,
    );
    if (entry) {
      const filename = entry[0];
      const source = join(root, "packages/components/static", filename);
      response.writeHead(200, {
        "Content-Type": mime[filename.slice(filename.lastIndexOf("."))],
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      response.end(await readFile(source));
      return;
    }
  }
  if (/^\/(private|published)\/assets\//.test(url.pathname)) {
    const filename = url.pathname.split("/").at(-1);
    const source = media[filename];
    if (source) {
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      });
      response.end(await readFile(join(root, source)));
      return;
    }
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end("Image unavailable");
    return;
  }
  const fixture = fixtures[url.searchParams.get("fixture") ?? "complete"];
  if (!fixture) {
    response.writeHead(404);
    response.end("Unknown fixture");
    return;
  }
  const context = url.pathname.startsWith("/private/") ? "preview" : "public";
  const headers = Object.fromEntries(
    policy.portfolioHeaders(context, {
      assetOrigins: [origin],
      ...(context === "preview" ? { parentOrigin: origin } : {}),
    }),
  );
  if (url.pathname === "/private/model") {
    response.writeHead(200, { ...headers, "Content-Type": "application/json" });
    response.end(JSON.stringify(fixture.model));
    return;
  }
  if (url.pathname === "/private/preview") {
    response.writeHead(200, headers);
    response.end(shell(previewScript, '<div id="preview-root"></div>'));
    return;
  }
  if (url.pathname === "/private/host") {
    headers["content-security-policy"] = `${headers[
      "content-security-policy"
    ].replace("connect-src 'none'", "connect-src 'self'")}; frame-src 'self'`;
    response.writeHead(200, headers);
    response.end(
      shell(
        hostScript,
        '<p>Private fixture preview</p><iframe title="Portfolio preview" src="/private/preview" width="100%" height="1000" style="border:0;display:block;width:100%"></iframe>',
      ),
    );
    return;
  }
  if (url.pathname === "/decorations") {
    response.writeHead(200, headers);
    response.end(decorations);
    return;
  }
  if (url.pathname === "/published") {
    response.writeHead(200, headers);
    response.end(fixture.html);
    return;
  }
  const unavailable = policy.unavailableResponse();
  response.writeHead(
    unavailable.status,
    Object.fromEntries(unavailable.headers),
  );
  response.end(await unavailable.text());
}
const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    failures.push(error.message);
    response.writeHead(500);
    response.end("Fixture failure");
  });
});
await new Promise((resolve) =>
  server.listen(
    process.argv.includes("--serve") ? 8794 : 0,
    "127.0.0.1",
    resolve,
  ),
);
origin = `http://127.0.0.1:${server.address().port}`;
({ fixtures, policy, decorations } = createFixtures(origin, {
  cssUrl,
  scriptUrl,
}));
if (process.argv.includes("--serve")) {
  console.log(
    `Renderer fixture at ${origin}/published. Private routes require the fixture-owner-a session cookie.`,
  );
} else {
  let browser;
  try {
    for (const path of [
      "/private/host",
      "/private/preview",
      "/private/model",
      "/private/assets/avatar.png",
    ]) {
      for (const cookie of [undefined, "renderer-session=fixture-owner-b"]) {
        const response = await fetch(
          origin + path,
          cookie ? { headers: { cookie } } : {},
        );
        assert.equal(response.status, 404, `deny ${path}`);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.ok(!(await response.text()).includes("Mira"));
      }
    }
    const privateResponse = await fetch(`${origin}/private/model`, {
      headers: { cookie: "renderer-session=fixture-owner-a" },
    });
    assert.equal(privateResponse.status, 200);
    assert.match(privateResponse.headers.get("x-robots-tag"), /noindex/);
    assert.match(privateResponse.headers.get("cache-control"), /no-store/);
    const privatePayload = await privateResponse.text();
    for (const secret of [
      "secret-recipient-record",
      "private-address-candidate",
      "private-face",
      "private-resume",
      "includePrivate",
      "case-study body",
    ])
      assert.ok(!privatePayload.includes(secret), secret);
    checks.push({
      check:
        "private fixture host, model and assets deny signed-out and other-owner sessions; display projection omits private configuration",
      passed: true,
    });
    const unavailable = await fetch(`${origin}/unavailable`);
    assert.equal(unavailable.status, 404);
    assert.match(await unavailable.text(), /unavailable/i);
    const publicResponse = await fetch(`${origin}/published`);
    assert.equal(publicResponse.status, 200);
    for (const name of [
      "content-security-policy",
      "x-content-type-options",
      "referrer-policy",
      "permissions-policy",
    ])
      assert.ok(publicResponse.headers.has(name), name);
    const csp = publicResponse.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.ok(!csp.includes("'unsafe-eval'"));
    assert.ok(!fixtures.complete.html.includes("secret-recipient-record"));
    assert.ok(!fixtures.complete.html.includes("react-dom"));
    for (const [filename, path] of Object.entries(platformManifest)) {
      const bytes = await readFile(
        join(root, "packages/components/static", filename),
      );
      const hash = createHash("sha256").update(bytes).digest("hex");
      assert.ok(path.includes(hash.slice(0, 16)), filename);
      const response = await fetch(origin + path);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    assert.ok(!new TextDecoder().decode(siteBytes).includes("react-dom"));
    assert.ok(
      siteBytes.byteLength < 16384,
      "small public script excludes React",
    );
    await writeFile(
      join(evidence, "complete-snapshot.html"),
      fixtures.complete.html,
    );
    checks.push({
      check:
        "public document has strict headers, generic unavailable state and a standalone vanilla script",
      passed: true,
      scriptBytes: siteBytes.byteLength,
      headers: Object.fromEntries(publicResponse.headers),
    });
    browser = await chromium.launch({
      executablePath:
        process.env.AUTH_SPIKE_CHROMIUM ?? "/opt/google/chrome/chrome",
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    await context.addCookies([
      { name: "renderer-session", value: "fixture-owner-a", url: origin },
    ]);
    const previewPage = await context.newPage();
    const publicPage = await context.newPage();
    const errors = [];
    for (const page of [previewPage, publicPage])
      page.on("pageerror", (error) => errors.push(error.message));
    const regressionFailures = [];
    const avatarGeometry = [];
    for (const width of [360, 768, 1280]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      for (const state of ["loading", "ready", "unavailable"]) {
        for (const path of ["/published", "/decorations"]) {
          let releaseImage;
          const held = new Promise((resolve) => {
            releaseImage = resolve;
          });
          await publicPage.route(
            "**/published/assets/avatar.png",
            async (route) => {
              await held;
              if (state === "unavailable") await route.fulfill({ status: 404 });
              else await route.continue();
            },
          );
          try {
            await publicPage.goto(origin + path, {
              waitUntil: "domcontentloaded",
            });
            await publicPage.locator(".pf-image-avatar img").first().waitFor();
            if (state !== "loading") releaseImage();
            await publicPage.waitForFunction(
              (state) =>
                [...document.querySelectorAll(".pf-image-avatar")].every(
                  (slot) => slot.dataset.assetState === state,
                ),
              state,
            );
            const geometry = await publicPage
              .locator(".pf-avatar-frame")
              .evaluateAll((frames) =>
                frames.map((frame) => {
                  const portrait = frame.querySelector(
                    ".pf-avatar-portraitButton",
                  );
                  const image = frame.querySelector(".pf-image-avatar img");
                  const slot = image.parentElement;
                  const outer = portrait.getBoundingClientRect();
                  const rect = image.getBoundingClientRect();
                  return {
                    decoration: frame.dataset.decoration,
                    state: slot.dataset.assetState,
                    width: rect.width,
                    height: rect.height,
                    offsetX: rect.x - outer.x,
                    offsetY: rect.y - outer.y,
                    slotRadius: getComputedStyle(slot).borderRadius,
                    visibility: getComputedStyle(image).visibility,
                    opacity: getComputedStyle(image).opacity,
                    status: slot.querySelector('[role="status"]').textContent,
                  };
                }),
              );
            avatarGeometry.push({ width, path, state, geometry });
            for (const item of geometry) {
              const label = `${item.decoration} ${state} actual avatar image at ${width}px`;
              try {
                const inset = item.decoration === "cat" ? 0 : 6;
                const expectedSize = (width <= 760 ? 104 : 124) - inset * 2;
                assert.equal(item.width, expectedSize, `${label}: width`);
                assert.equal(item.height, expectedSize, `${label}: height`);
                assert.equal(
                  item.offsetX,
                  inset,
                  `${label}: horizontal source offset`,
                );
                assert.equal(
                  item.offsetY,
                  inset,
                  `${label}: vertical source offset`,
                );
                assert.equal(
                  item.slotRadius,
                  "0px",
                  `${label}: only the portrait clips corners`,
                );
                if (state === "loading") {
                  assert.equal(item.opacity, "0");
                  assert.equal(item.status, "Image loading");
                } else if (state === "unavailable") {
                  assert.equal(item.visibility, "hidden");
                  assert.equal(item.status, "Image unavailable");
                } else {
                  assert.equal(item.visibility, "visible");
                  assert.equal(item.opacity, "1");
                  assert.equal(item.status, "");
                }
              } catch (error) {
                regressionFailures.push(error);
              }
            }
          } catch (error) {
            const slots = await publicPage
              .locator(".pf-image-avatar")
              .evaluateAll((elements) =>
                elements.map((slot) => ({
                  state: slot.dataset.assetState,
                  complete: slot.querySelector("img")?.complete,
                  naturalWidth: slot.querySelector("img")?.naturalWidth,
                })),
              );
            throw new Error(
              `${path} avatar ${state} at ${width}px: ${error.message}; slots=${JSON.stringify(slots)}`,
              { cause: error },
            );
          } finally {
            releaseImage();
            await publicPage.unrouteAll({ behavior: "wait" });
            await publicPage.waitForFunction(() =>
              [...document.querySelectorAll(".pf-image-avatar img")].every(
                (image) => image.complete,
              ),
            );
          }
        }
      }
      checks.push({
        check:
          "actual none/cat/hands image bounds, source offsets and loading/error geometry",
        width,
        passed: regressionFailures.length === 0,
      });
    }
    const themeActions = [];
    for (const host of ["published", "preview"]) {
      try {
        await publicPage.evaluate(() => localStorage.clear());
        const page = host === "published" ? publicPage : previewPage;
        await page.goto(
          `${origin}/${host === "published" ? "published" : "private/host"}`,
        );
        const target =
          host === "published"
            ? page
            : page
                .frames()
                .find((candidate) =>
                  candidate.url().includes("/private/preview"),
                );
        assert.ok(target, "private iframe loaded for theme action regression");
        await target.waitForFunction(() =>
          document.querySelector("[data-theme-toggle]"),
        );
        for (const [key, mode, name] of [
          [null, "light", "Dark mode"],
          ["Enter", "dark", "Light mode"],
          ["Space", "light", "Dark mode"],
        ]) {
          const button = target.locator("[data-theme-toggle]");
          if (key) {
            await button.focus();
            await page.keyboard.press(key);
          }
          const snapshot = await button.ariaSnapshot();
          const pressed = await button.getAttribute("aria-pressed");
          const actualMode = await target.evaluate(
            () => document.documentElement.dataset.colorMode,
          );
          themeActions.push({ host, key, mode: actualMode, snapshot, pressed });
          try {
            assert.equal(
              actualMode,
              mode,
              `${host} theme after ${key ?? "load"}`,
            );
            assert.equal(
              await target.getByRole("button", { name, exact: true }).count(),
              1,
            );
            assert.equal(
              pressed,
              null,
              `${host} ${name} action must not expose a pressed state`,
            );
            assert.doesNotMatch(snapshot, /\[pressed/);
          } catch (error) {
            regressionFailures.push(error);
          }
        }
        checks.push({
          check:
            "theme action accessible name without pressed state before and after Enter/Space",
          host,
          passed: themeActions
            .filter((item) => item.host === host)
            .every((item) => item.pressed === null),
        });
      } catch (error) {
        regressionFailures.push(error);
      }
    }
    await writeJsonEvidence(
      pathToFileURL(join(evidence, "acceptance-regressions.json")),
      {
        avatarGeometry,
        themeActions,
        failures: regressionFailures.map((error) => error.message),
      },
    );
    if (regressionFailures.length)
      throw new AggregateError(
        regressionFailures,
        `Phase 16 acceptance regressions: ${regressionFailures.map((error) => error.message).join("; ")}`,
      );
    const semantic = () => {
      const content = document.querySelector("main");
      return {
        text: content.textContent,
        sections: [...content.querySelectorAll("[data-component]")].map(
          (element) => [
            element.dataset.component,
            element.dataset.componentId ?? "",
          ],
        ),
        links: [...content.querySelectorAll("a")].map((element) => [
          element.textContent,
          element.getAttribute("href"),
          element.getAttribute("rel"),
        ]),
        images: [...content.querySelectorAll("img")].map((element) => [
          element.alt,
          element.src.split("/").at(-1),
          element.clientWidth,
          element.clientHeight,
        ]),
        boxes: [...content.querySelectorAll("[data-component]")].map(
          (element) => {
            const rect = element.getBoundingClientRect();
            return {
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          },
        ),
        background: getComputedStyle(document.documentElement).backgroundColor,
        font: getComputedStyle(content).fontFamily,
        overflow: document.documentElement.scrollWidth > innerWidth,
        xss: window.fixtureXss === true,
      };
    };
    for (const width of [360, 768, 1280]) {
      for (const name of ["complete", "incomplete", "empty", "long"]) {
        await previewPage.setViewportSize({ width, height: 1000 });
        await publicPage.setViewportSize({ width, height: 1000 });
        await previewPage.goto(`${origin}/private/host?fixture=${name}`);
        const frame = previewPage
          .frames()
          .find((candidate) => candidate.url().includes("/private/preview"));
        assert.ok(frame, "private iframe loaded");
        await frame.waitForFunction(
          (name) => document.querySelector("h1")?.textContent === name,
          fixtures[name].model.profile.name || "Name not added",
        );
        await publicPage.goto(`${origin}/published?fixture=${name}`);
        for (const target of [frame, publicPage]) {
          await target.evaluate(() => document.fonts.ready);
          assert.equal(
            await target.evaluate(() => document.fonts.check('16px "DM Sans"')),
            true,
          );
          await target.waitForFunction(() =>
            [...document.querySelectorAll("img")].every(
              (image) => image.complete,
            ),
          );
          await target.waitForFunction(
            () => !document.querySelector('[data-asset-state="loading"]'),
          );
        }
        const preview = await frame.evaluate(semantic);
        const published = await publicPage.evaluate(semantic);
        assert.deepEqual(preview, published, `${name} parity at ${width}`);
        assert.equal(
          preview.overflow,
          false,
          `${name} horizontal overflow at ${width}`,
        );
        assert.equal(preview.xss, false);
        if (name === "complete") {
          assert.deepEqual(
            preview.sections.map((entry) => entry[0]),
            [
              "profile",
              "text",
              "projects",
              "skills",
              "work-experience",
              "text",
              "social-links",
              "github",
              "contact",
              "resume",
            ],
          );
          assert.ok(preview.text.includes("🧑🏽‍💻 اردو café"));
          assert.ok(preview.text.includes("Image unavailable"));
          assert.ok(
            preview.links.some(
              (entry) => entry[1] === "mailto:hello@example.test",
            ),
          );
          for (const [, href, rel] of preview.links) {
            // Case-study cards link to a same-site generated page path.
            if (href.startsWith("/")) {
              assert.match(href, /^\/projects\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
              continue;
            }
            assert.match(href, /^(https?:|mailto:)/);
            assert.ok(rel.includes("noopener"));
          }
        }
        if (
          (width === 360 && ["complete", "incomplete"].includes(name)) ||
          (width === 1280 && name === "complete")
        ) {
          await previewPage.locator("iframe").evaluate(
            (element, height) => {
              element.height = String(height);
            },
            await frame.evaluate(() => document.documentElement.scrollHeight),
          );
          await frame.locator(".pf-portfolio").screenshot({
            path: join(evidence, `${name}-${width}-preview.png`),
          });
          await publicPage.locator(".pf-portfolio").screenshot({
            path: join(evidence, `${name}-${width}-snapshot.png`),
          });
        }
        checks.push({
          check: "browser preview and static snapshot parity",
          fixture: name,
          width,
          passed: true,
          components: preview.sections.map((entry) => entry[0]),
          noHorizontalOverflow: true,
        });
      }
    }
    await previewPage.setViewportSize({ width: 390, height: 1000 });
    await previewPage.goto(`${origin}/private/host?fixture=complete`);
    const frame = previewPage
      .frames()
      .find((candidate) => candidate.url().includes("/private/preview"));
    await frame.waitForFunction(
      () => document.querySelector("h1")?.textContent === "Mira Sen",
    );
    assert.equal(await frame.evaluate(() => innerWidth), 390);
    const original = await frame.locator("main").innerText();
    const malformed = {
      ...fixtures.complete.model,
      recipientId: "must-reject",
    };
    for (const payload of [
      {
        protocol: 1,
        kind: "begin",
        channel: "wrong-channel",
        sequence: 999,
        bytes: 10,
      },
      {
        protocol: 1,
        kind: "begin",
        channel: "phase16-fixture",
        sequence: 0,
        bytes: 10,
      },
    ])
      await previewPage.evaluate(
        (payload) =>
          document
            .querySelector("iframe")
            .contentWindow.postMessage(payload, location.origin),
        payload,
      );
    await frame.evaluate(() =>
      window.postMessage(
        {
          protocol: 1,
          kind: "begin",
          channel: "phase16-fixture",
          sequence: 999,
          bytes: 10,
        },
        location.origin,
      ),
    );
    for (const model of [
      malformed,
      {
        ...fixtures.complete.model,
        profile: {
          ...fixtures.complete.model.profile,
          avatar: {
            state: "ready",
            url: "https://untrusted.test/leak",
            alt: "Untrusted",
          },
        },
      },
    ]) {
      await previewPage.evaluate(
        (model) => window.rendererBridge.request(async () => model),
        model,
      );
      await previewPage.waitForFunction(
        () => window.rendererState?.kind === "rejected",
      );
      assert.equal(await frame.locator("main").innerText(), original);
    }
    await previewPage.evaluate(
      (model) => window.rendererBridge.request(async () => model),
      fixtures.empty.model,
    );
    await frame.waitForFunction(
      () => document.querySelector("h1")?.textContent === "Name not added",
    );
    checks.push({
      check:
        "390px iframe and preview bridge source/channel/sequence/schema/asset-origin rejection with valid update",
      passed: true,
    });
    await publicPage.goto(`${origin}/published`);
    const toggle = publicPage.locator("[data-theme-toggle]");
    await toggle.focus();
    assert.equal(
      await toggle.evaluate((element) => element.matches(":focus-visible")),
      true,
    );
    assert.notEqual(
      await toggle.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
      "none",
    );
    const beforeTheme = await publicPage.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    );
    await publicPage.keyboard.press("Enter");
    const afterTheme = await publicPage.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    );
    assert.notEqual(beforeTheme, afterTheme);
    await publicPage.reload();
    assert.equal(
      await publicPage.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
      afterTheme,
    );
    await publicPage.locator("[data-theme-toggle]").focus();
    await publicPage.keyboard.press("Space");
    assert.equal(
      await publicPage.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
      beforeTheme,
    );
    await publicPage.reload();
    assert.equal(
      await publicPage.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
      beforeTheme,
    );
    await publicPage.evaluate(() => {
      localStorage.clear();
    });
    await publicPage.reload();
    await publicPage.locator(".pf-skip").focus();
    await publicPage.keyboard.press("Enter");
    assert.equal(
      await publicPage.evaluate(() => document.activeElement?.id),
      "portfolio-content",
    );
    const axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
    await publicPage.evaluate(axe);
    const accessibility = await publicPage.evaluate(async () => {
      const results = await window.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
      });
      return results.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        nodes: nodes.map((node) => node.target),
      }));
    });
    assert.deepEqual(accessibility, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    checks.push({
      check:
        "native Enter/Space theme toggle, visible focus, skip link, theme persistence and axe WCAG AA",
      passed: true,
      accessibility,
    });
    await publicPage.evaluate(() => {
      localStorage.clear();
    });
    await publicPage.reload();
    await publicPage.emulateMedia({ colorScheme: "dark" });
    await publicPage.waitForFunction(
      () => document.documentElement.dataset.colorMode === "dark",
    );
    await publicPage.emulateMedia({ colorScheme: "light" });
    await publicPage.waitForFunction(
      () => document.documentElement.dataset.colorMode === "light",
    );
    await frame.locator("[data-theme-toggle]").focus();
    await previewPage.keyboard.press("Enter");
    assert.equal(
      await frame.evaluate(() => document.documentElement.dataset.colorMode),
      "dark",
    );
    await previewPage.keyboard.press("Space");
    assert.equal(
      await frame.evaluate(() => document.documentElement.dataset.colorMode),
      "light",
    );
    checks.push({
      check:
        "system color changes and native keyboard theme controls in the private iframe",
      passed: true,
    });
    await publicPage.evaluate(() => {
      window.policyViolations = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        window.policyViolations.push(event.effectiveDirective),
      );
      const script = document.createElement("script");
      script.textContent = "window.fixtureXss=true";
      document.body.append(script);
    });
    await publicPage.waitForFunction(() => window.policyViolations.length > 0);
    assert.equal(
      await publicPage.evaluate(() => window.fixtureXss === true),
      false,
    );
    checks.push({
      check: "CSP blocks inserted inline scripts in static output",
      passed: true,
      directives: await publicPage.evaluate(() => window.policyViolations),
    });
    let releaseImage;
    const imageHeld = new Promise((resolve) => {
      releaseImage = resolve;
    });
    await publicPage.route("**/published/assets/avatar.png", async (route) => {
      await imageHeld;
      await route.continue();
    });
    await publicPage.goto(`${origin}/published`, {
      waitUntil: "domcontentloaded",
    });
    const portrait = publicPage.locator(
      '[data-component="profile"] .pf-image-avatar',
    );
    await portrait.locator("img").waitFor();
    const loadingBox = await portrait.boundingBox();
    assert.equal(await portrait.getAttribute("data-asset-state"), "loading");
    releaseImage();
    await portrait.waitFor({ state: "visible" });
    await publicPage.waitForFunction(
      () =>
        document.querySelector(".pf-image-avatar")?.dataset.assetState ===
        "ready",
    );
    assert.deepEqual(await portrait.boundingBox(), loadingBox);
    await publicPage.unroute("**/published/assets/avatar.png");
    checks.push({
      check:
        "delayed owner portrait keeps reserved geometry through loading and readiness",
      passed: true,
      geometry: loadingBox,
    });
    for (const width of [360, 768, 1280]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await publicPage.evaluate(() => {
        localStorage.clear();
        delete document.documentElement.dataset.colorMode;
      });
      await publicPage.goto(`${origin}/decorations`);
      await publicPage.waitForFunction(() =>
        [...document.querySelectorAll("img")].every((image) => image.complete),
      );
      const geometry = await publicPage.evaluate(() =>
        [...document.querySelectorAll("[data-review-variant]")].map(
          (specimen) => {
            const portrait = specimen.querySelector(
              ".pf-avatar-portraitButton",
            );
            const frame = specimen.querySelector("[data-decoration]");
            const envelope = specimen
              .querySelector(".pf-avatar-envelope")
              .getBoundingClientRect();
            const rect = portrait.getBoundingClientRect();
            return {
              decoration: frame.dataset.decoration,
              width: rect.width,
              height: rect.height,
              radius: getComputedStyle(portrait).borderRadius,
              insideEnvelope:
                rect.x >= envelope.x &&
                rect.right <= envelope.right &&
                rect.y >= envelope.y &&
                rect.bottom <= envelope.bottom,
            };
          },
        ),
      );
      for (const item of geometry) {
        assert.equal(item.width, width <= 760 ? 104 : 124);
        assert.equal(item.height, item.width);
        assert.equal(
          item.radius,
          item.decoration === "cat"
            ? width <= 760
              ? "20px"
              : "24px"
            : width <= 760
              ? "26px"
              : "30px",
        );
        assert.equal(item.insideEnvelope, true);
      }
      assert.ok(
        await publicPage
          .locator('[data-decoration="cat"] picture img')
          .evaluate((image) => image.currentSrc.includes("still")),
      );
      const reduced = await publicPage
        .locator('[data-decoration="hands"] .pf-avatar-hand')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName);
      assert.equal(reduced, "none");
      await publicPage.emulateMedia({ reducedMotion: "no-preference" });
      await publicPage.waitForFunction(() =>
        document
          .querySelector('[data-decoration="cat"] picture img')
          .currentSrc.includes("loop"),
      );
      const families = await publicPage
        .locator('[data-decoration="hands"]')
        .evaluate((element) =>
          [...element.querySelectorAll("*")]
            .map((child) => getComputedStyle(child).animationName)
            .filter((name) => name !== "none"),
        );
      assert.ok(families.length >= 8, "source hand animation families active");
      await publicPage.emulateMedia({ reducedMotion: "reduce" });
      await publicPage.waitForFunction(() =>
        document
          .querySelector('[data-decoration="cat"] picture img')
          .currentSrc.includes("still"),
      );
      await publicPage.emulateMedia({ colorScheme: "dark" });
      const darkAvatar = await publicPage
        .locator(".pf-avatar-portraitButton")
        .first()
        .evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          border: getComputedStyle(element).borderTopColor,
        }));
      assert.equal(darkAvatar.background, "rgb(34, 42, 30)");
      await publicPage.emulateMedia({ colorScheme: "light" });
      if (width === 360 || width === 1280)
        await publicPage
          .locator(".pf-portfolio")
          .screenshot({ path: join(evidence, `decorations-${width}.png`) });
      checks.push({
        check:
          "owner-data cat/hands source geometry and changing reduced motion",
        passed: true,
        width,
        geometry,
        activeAnimationElements: families.length,
      });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    await context.close();
    await writeJsonEvidence(
      pathToFileURL(join(evidence, "browser-results.json")),
      {
        recordedAt: new Date().toISOString(),
        browser: await browser.version(),
        checks,
        fixtureBoundary:
          "Isolated fixture sessions prove harness gating only. Product authorization/route integration remains Phase 17/39/42E.",
        assets: [...resources].map(([path, asset]) => ({
          path,
          sha256: asset.hash,
          bytes: asset.bytes.byteLength,
        })),
        requests,
      },
    );
    console.log(
      `Passed ${checks.length} renderer browser groups. Evidence at ${evidence}`,
    );
  } catch (error) {
    await writeJsonEvidence(
      pathToFileURL(join(evidence, `partial-${Date.now()}.json`)),
      { checks, failures, error: error.message },
    );
    throw error;
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
