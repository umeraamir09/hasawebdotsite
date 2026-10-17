import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { openChromium } from "./lib/chromium.mjs";
import { writeJsonEvidence } from "./lib/write-json-evidence.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:3000";
const path = "/catalog/avatar-decorations";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const sharp = require("sharp");
const browser = await openChromium();
const { command, evaluate, until } = browser;
const results = [];
const buttons = 'document.querySelectorAll("[data-review-variant] button")';
const imagesReady =
  '[...document.querySelectorAll("button img")].every(image => image.complete && image.naturalWidth > 0 && image.dataset.imageState === "loaded")';
const held = [];
let holdPortraits = true;
const requests = new Set();
browser.on("Network.requestWillBeSent", ({ request }) =>
  requests.add(request.url),
);
browser.on("Fetch.requestPaused", (event) => {
  if (holdPortraits) held.push(event.requestId);
  else void command("Fetch.continueRequest", { requestId: event.requestId });
});
const bounds = `() => [...document.querySelectorAll('[data-decoration]')].map(frame => {
  const button=frame.querySelector('button'), rect=button.getBoundingClientRect(), wrapper=frame.parentElement.parentElement.getBoundingClientRect();
  return {variant:frame.dataset.decoration,x:rect.x,y:rect.y,width:rect.width,height:rect.height,wrapper:{x:wrapper.x,y:wrapper.y,width:wrapper.width,height:wrapper.height}};
})`;
try {
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await command("Fetch.enable", {
    patterns: [
      {
        urlPattern: "*/assets/ed716e56-02ad-4f30-a9e8-803c79346a83.png",
        requestStage: "Request",
      },
      {
        urlPattern: "*/assets/umer-avatar-photo.webp",
        requestStage: "Request",
      },
    ],
  });
  await command("Page.navigate", { url: origin + path });
  await until(
    `${buttons}.length === 2 && document.querySelectorAll('button .image-skeleton[data-image-state="loading"]').length === 4`,
  );
  await until(
    'getComputedStyle(document.querySelector("[data-decoration=cat] button")).width === "124px"',
  );
  await evaluate("document.fonts.ready.then(() => true)");
  const before = await evaluate(`(${bounds})()`);
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector("button img")).opacity',
    ),
    "0",
  );
  holdPortraits = false;
  await Promise.all(
    held
      .splice(0)
      .map((requestId) => command("Fetch.continueRequest", { requestId })),
  );
  await command("Fetch.disable");
  await until(imagesReady);
  assert.deepEqual(await evaluate(`(${bounds})()`), before);
  assert.equal(
    await evaluate(
      'document.querySelectorAll("button .image-skeleton").length',
    ),
    0,
  );
  results.push(
    "delayed portraits show skeletons and load with no layout shift",
  );

  const catMetadata = await evaluate(`(async () => {
    const image=document.querySelector('[data-decoration="cat"] picture img'); await image.decode();const rect=image.getBoundingClientRect();
    return {source:image.currentSrc,width:image.naturalWidth,height:image.naturalHeight,filter:getComputedStyle(image).filter,region:{left:Math.ceil(rect.x),top:Math.ceil(rect.y),width:Math.floor(rect.width)-2,height:Math.floor(rect.height)-2}};
  })()`);
  assert.ok(catMetadata.source.endsWith("avatar-ginger-cat-clean-loop.webp"));
  assert.equal(catMetadata.width, 212);
  assert.equal(catMetadata.height, 220);
  assert.equal(catMetadata.filter, "none");
  // Canvas drawImage intentionally returns the default frame of animated images.
  // Observe compositor frames without clicks, DOM changes or forced screenshots.
  const paintedFrames = [];
  let recording = false;
  let started;
  browser.on("Page.screencastFrame", (event) => {
    if (recording)
      paintedFrames.push({
        time: performance.now() - started,
        bytes: Buffer.from(event.data, "base64"),
      });
    void command("Page.screencastFrameAck", { sessionId: event.sessionId });
  });
  await command("Page.bringToFront");
  started = performance.now();
  recording = true;
  await command("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await delay(7940);
  recording = false;
  await command("Page.stopScreencast");
  const hashes = [new Set(), new Set()];
  for (const frame of paintedFrames) {
    const pixels = await sharp(frame.bytes)
      .extract(catMetadata.region)
      .raw()
      .toBuffer();
    hashes[Math.min(1, Math.floor(frame.time / 3920))].add(
      createHash("sha256").update(pixels).digest("hex"),
    );
  }
  catMetadata.distinctFrames = hashes.map((set) => set.size);
  catMetadata.observedCompositorFrames = paintedFrames.length;
  assert.ok(
    catMetadata.distinctFrames.every((count) => count > 4),
    JSON.stringify(catMetadata),
  );
  results.push(
    "cat compositor changes through two complete loops without clicks, DOM changes, forced screenshots or a live filter",
  );

  const handAnimations = await evaluate(`(() => {
    const root=document.querySelector('[data-decoration="hands"]');return root.getAnimations({subtree:true}).map(animation=>({name:animation.animationName,duration:animation.effect.getTiming().duration,iterations:animation.effect.getTiming().iterations===Infinity?'infinite':animation.effect.getTiming().iterations}));
  })()`);
  for (const name of [
    "curled-pose",
    "palm-pose",
    "nails-pose",
    "hand-flourish",
    "right-hand-flourish",
    "heart-float",
    "sparkle-twinkle",
  ])
    assert.ok(
      handAnimations.some(
        (animation) =>
          animation.name.includes(name) &&
          animation.duration === 6000 &&
          animation.iterations === "infinite",
      ),
      name,
    );
  results.push(
    "hands retain all seven six-second keyframe families, including poses, hearts and sparkles",
  );

  for (const variant of ["cat", "hands"]) {
    for (const pressed of [true, false]) {
      const test = await evaluate(`(async () => {
        const button=document.querySelector('[data-decoration="${variant}"] button');const outgoing=button.querySelector('img[aria-hidden="false"]');const incoming=button.querySelector('img[aria-hidden="true"]');const before=outgoing.getBoundingClientRect();button.click();await new Promise(requestAnimationFrame);const wipe=outgoing.getAnimations()[0];if(!wipe)return null;wipe.pause();wipe.currentTime=310;await new Promise(requestAnimationFrame);const rect=outgoing.getBoundingClientRect();const topLeft=document.elementFromPoint(rect.x+rect.width*.25,rect.y+rect.height*.25);const bottomRight=document.elementFromPoint(rect.x+rect.width*.75,rect.y+rect.height*.75);const result={pressed:button.getAttribute('aria-pressed'),disabled:button.getAttribute('aria-disabled'),incoming:incoming.alt,outgoing:outgoing.alt,hidden:outgoing.getAttribute('aria-hidden'),topLeft:topLeft?.getAttribute('alt'),bottomRight:bottomRight?.getAttribute('alt'),before:{x:before.x,y:before.y,width:before.width,height:before.height},during:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};button.click();result.afterGuard=button.getAttribute('aria-pressed');wipe.play();return result;
      })()`);
      assert.ok(test, `${variant} wipe exists`);
      assert.equal(test.pressed, String(pressed));
      assert.equal(test.disabled, "true");
      assert.equal(test.afterGuard, String(pressed));
      assert.equal(test.hidden, "true");
      assert.equal(test.topLeft, test.incoming);
      assert.equal(test.bottomRight, test.outgoing);
      assert.deepEqual(test.before, test.during);
      await until(
        `document.querySelector('[data-decoration="${variant}"] button').dataset.erasing === 'false'`,
      );
      assert.equal(
        await evaluate(
          `getComputedStyle(document.querySelector('[data-decoration="${variant}"] button img[aria-hidden="true"]')).visibility`,
        ),
        "hidden",
      );
    }
  }
  results.push(
    "both variants wipe top-left to bottom-right in both directions, preserve image bounds and hidden states, and guard in-progress clicks",
  );

  const responsive = [];
  for (const width of [360, 768, 1280]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const measured = await evaluate(`(${bounds})()`);
    assert.equal(
      await evaluate("document.documentElement.scrollWidth > innerWidth"),
      false,
    );
    for (const rect of measured) {
      assert.equal(rect.width, width <= 760 ? 104 : 124);
      assert.equal(rect.width, rect.height);
      assert.ok(rect.x >= rect.wrapper.x && rect.y >= rect.wrapper.y);
      assert.ok(rect.x + rect.width <= rect.wrapper.x + rect.wrapper.width);
      assert.ok(rect.y + rect.height <= rect.wrapper.y + rect.wrapper.height);
    }
    responsive.push({ width, bounds: measured });
  }
  await command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await until(
    "document.querySelector('[data-decoration=cat] picture img').currentSrc.endsWith('avatar-ginger-cat-clean-still.webp')",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[data-decoration=hands]').getAnimations({subtree:true}).length",
    ),
    0,
  );
  for (const variant of ["cat", "hands"]) {
    await evaluate(
      `document.querySelector('[data-decoration="${variant}"] button').focus()`,
    );
    for (const [key, code, number, pressed] of [
      ["Enter", "Enter", 13, true],
      [" ", "Space", 32, false],
    ]) {
      await command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code,
        text: key === "Enter" ? "\r" : " ",
        unmodifiedText: key === "Enter" ? "\r" : " ",
        windowsVirtualKeyCode: number,
      });
      await command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode: number,
      });
      await until(
        `document.querySelector('[data-decoration="${variant}"] button').getAttribute('aria-pressed') === '${pressed}'`,
      );
      assert.equal(
        await evaluate(
          `document.querySelector('[data-decoration="${variant}"] button').dataset.erasing`,
        ),
        "false",
      );
    }
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('[data-decoration="${variant}"] button')).outlineStyle`,
      ),
      "solid",
    );
  }
  results.push(
    "responsive 104/124 px portraits, reduced-motion still/hands behavior, Enter/Space and visible keyboard focus",
  );
  await command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await evaluate(
    "document.querySelector('[data-decoration=cat] button').click()",
  );
  await command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await until(
    "document.querySelector('[data-decoration=cat] button').dataset.erasing === 'false'",
  );
  results.push(
    "changing reduced motion during a wipe releases the source toggle guard",
  );

  for (const [name, width] of [
    ["desktop", 1280],
    ["mobile", 360],
  ]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const { cssContentSize } = await command("Page.getLayoutMetrics");
    const screenshot = await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: cssContentSize.height, scale: 1 },
    });
    await writeFile(
      new URL(
        `../specs/2026-10-17-avatar-decoration-import/${name}.png`,
        import.meta.url,
      ),
      Buffer.from(screenshot.data, "base64"),
    );
  }
  // Cached remount exercises the loader's ref-as-prop handling.
  await command("Page.navigate", { url: origin + path });
  await until(imagesReady);
  results.push("cached images become loaded after remount");
  await command("Network.setCacheDisabled", { cacheDisabled: true });
  await command("Network.setBlockedURLs", {
    urls: ["*/assets/umer-avatar-photo.webp"],
  });
  await command("Page.navigate", { url: origin + path });
  await until(
    'document.querySelectorAll("button .image-skeleton[data-image-state=error]").length === 2',
  );
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector("button img[data-image-state=error]")).opacity',
    ),
    "0",
  );
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector("button .image-skeleton"),"::after").animationName',
    ),
    "none",
  );
  results.push(
    "failed portraits retain their skeleton and reduced motion disables shimmer",
  );
  assert.deepEqual(browser.errors, []);
  assert.ok(
    [...requests].every((url) => url.startsWith(origin)),
    "Component resources stay on the host origin",
  );
  const report = {
    browser: (await command("Browser.getVersion")).product,
    origin,
    results,
    cat: catMetadata,
    handAnimations,
    responsive,
    browserErrors: browser.errors,
    sourceManifest: JSON.parse(
      await readFile(
        new URL(
          "../specs/2026-10-17-avatar-decoration-import/source-manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).sourceCommit,
  };
  await writeJsonEvidence(
    new URL(
      "../specs/2026-10-17-avatar-decoration-import/browser-results.json",
      import.meta.url,
    ),
    report,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
