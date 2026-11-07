import assert from "node:assert/strict";
import { join } from "node:path";

// Phase 38: the shared Face Reveal and visitor playback behavior. The same
// interaction script runs against the published document (markup plus the
// standalone platform script) and the private preview (React markup plus
// mountPreview's installSite), and the recorded traces must be equal.

const FIXTURES = [
  "reveal-none",
  "reveal-cat",
  "reveal-hands",
  "playback-cat",
  "playback-hands",
];

// Observable avatar state inside one document.
export function snapshot(target) {
  return target.evaluate(() => {
    const frame = document.querySelector(".pf-avatar-frame");
    const reveal = frame.querySelector(":scope > button[data-face-reveal]");
    const playback = frame.querySelector(":scope > [data-avatar-playback]");
    const cat = frame.querySelector(".pf-avatar-catDecoration img");
    const nails = frame.querySelector(".pf-avatar-nails");
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height].map(Math.round);
    };
    const layer = (name) => {
      const slot = reveal?.querySelector(`.pf-avatar-${name}`);
      if (!slot) return null;
      const image = slot.querySelector("img");
      return {
        visible: getComputedStyle(slot).visibility,
        box: box(slot),
        image: box(image),
        src: new URL(image.src).pathname,
      };
    };
    const running = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === "running" &&
          frame.contains(animation.effect?.target ?? null),
      )
      .map((animation) => animation.animationName ?? "unnamed");
    return {
      decoration: frame.dataset.decoration,
      playback: frame.dataset.playback ?? null,
      reveal: reveal
        ? {
            label: reveal.getAttribute("aria-label"),
            photo: reveal.dataset.photo,
            erasing: reveal.dataset.erasing,
            box: box(reveal),
            cue: !!frame.querySelector(":scope > .pf-avatar-revealCue"),
            illustration: layer("illustration"),
            photoLayer: layer("photo"),
          }
        : null,
      cue: !!frame.querySelector(".pf-avatar-revealCue"),
      secondImage: !!frame.querySelector(".pf-image-face"),
      control: playback
        ? {
            hidden: playback.hidden,
            name: playback.innerText.trim(),
          }
        : null,
      cat: cat
        ? new URL(cat.currentSrc).pathname.split("-").slice(-1)[0]
        : null,
      // Sampled only when still; mid-animation values depend on timing.
      nailsOpacity:
        nails && !running.length ? getComputedStyle(nails).opacity : null,
      running: [...new Set(running)].sort(),
    };
  });
}

// Every keyframe family of the source six-second hands sequence.
const HAND_ANIMATIONS = [
  "curled-pose",
  "hand-flourish",
  "heart-float",
  "nails-pose",
  "palm-pose",
  "right-hand-flourish",
  "sparkle-twinkle",
];
const handsRun = (running) =>
  HAND_ANIMATIONS.every((name) => running.includes(name));

const settled = (target) =>
  target.waitForFunction(() => {
    const reveal = document.querySelector("button[data-face-reveal]");
    return !reveal || reveal.dataset.erasing === "false";
  });
// The cat picture re-selects its source asynchronously after a change.
const catIs = (target, kind) =>
  target.waitForFunction((kind) => {
    const image = document.querySelector(".pf-avatar-catDecoration img");
    return !image || image.currentSrc.includes(kind);
  }, kind);

// Emulates the preference and waits until the document has evaluated it and
// delivered its change events (they run in the next rendering steps).
async function motion(page, target, value) {
  await page.emulateMedia({ reducedMotion: value });
  await target.waitForFunction(
    (reduce) =>
      matchMedia("(prefers-reduced-motion: reduce)").matches === reduce,
    value === "reduce",
  );
  await target.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

// One complete visitor session. `page` owns keyboard and media emulation;
// `target` is the document (the page itself or the preview frame).
export async function exercise(page, target) {
  const trace = [];
  const record = async (step) =>
    trace.push({ step, ...(await snapshot(target)) });
  const frame = target.locator(".pf-avatar-frame");
  const reveal = frame.locator(":scope > button[data-face-reveal]");
  const playback = frame.locator(":scope > [data-avatar-playback]");
  const hasReveal = (await reveal.count()) === 1;
  const hasCat = (await target.locator(".pf-avatar-catDecoration").count()) > 0;
  await motion(page, target, "no-preference");
  if (hasCat) await catIs(target, "loop");
  await record("initial");

  if (hasReveal) {
    // Pointer activation: the label changes at once and the wipe runs over
    // stable image boxes.
    await reveal.click();
    const wiping = await snapshot(target);
    assert.equal(wiping.reveal.erasing, "true", "wipe starts");
    assert.ok(wiping.running.includes("portrait-erase"), "wipe animates");
    trace.push({
      step: "wipe started",
      label: wiping.reveal.label,
      photo: wiping.reveal.photo,
      boxes: [wiping.reveal.illustration.box, wiping.reveal.photoLayer.box],
    });
    await settled(target);
    await record("revealed");
    // Keyboard: Enter returns to the avatar, Space reveals again.
    // Keyboard modality: blur, then focus after a key press.
    await reveal.evaluate((element) => element.blur());
    await page.keyboard.press("Shift");
    await reveal.focus();
    trace.push({
      step: "focus",
      focusVisible: await reveal.evaluate((element) =>
        element.matches(":focus-visible"),
      ),
      frameOutline: await frame.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
    });
    await page.keyboard.press("Enter");
    await settled(target);
    await record("enter");
    await page.keyboard.press("Space");
    await settled(target);
    await record("space");
    // A second activation during the wipe is ignored (source guard).
    await reveal.click();
    await reveal.click();
    await settled(target);
    await record("guarded double activation");
  }

  if ((await playback.count()) === 1) {
    // Pause: stills, no running animation, portrait untouched.
    await playback.click();
    if (hasCat) await catIs(target, "still");
    await record("paused");
    if (hasReveal) {
      // The wipe still plays while decorations are paused, then nothing runs.
      await reveal.click();
      assert.ok((await snapshot(target)).running.includes("portrait-erase"));
      await settled(target);
      await record("revealed while paused");
    }
    await playback.focus();
    await page.keyboard.press("Enter");
    if (hasCat) await catIs(target, "loop");
    await record("played with Enter");
    // Reduced motion: stills, hidden control, playing state kept.
    await motion(page, target, "reduce");
    if (hasCat) await catIs(target, "still");
    await record("reduced while playing");
    await motion(page, target, "no-preference");
    if (hasCat) await catIs(target, "loop");
    await record("motion allowed again");
    // Paused, then reduced, then allowed: the pause is kept.
    await playback.focus();
    await page.keyboard.press("Space");
    await motion(page, target, "reduce");
    await motion(page, target, "no-preference");
    if (hasCat) await catIs(target, "still");
    await record("pause kept across preference change");
    await playback.click();
    if (hasCat) await catIs(target, "loop");
  }

  if (hasReveal) {
    // Reduced motion switches immediately, without the wipe.
    await motion(page, target, "reduce");
    if (hasCat) await catIs(target, "still");
    await reveal.click();
    const immediate = await snapshot(target);
    trace.push({ step: "reduced activation", ...immediate });
    assert.equal(immediate.reveal.erasing, "false");
    assert.deepEqual(immediate.running, []);
    // A preference change during a wipe ends it at once.
    await motion(page, target, "no-preference");
    await reveal.click();
    await motion(page, target, "reduce");
    await settled(target);
    await record("reduced during wipe");
    await motion(page, target, "no-preference");
  }
  return trace;
}

export function checkTrace(fixture, trace) {
  const step = (name) => trace.find((entry) => entry.step === name);
  const initial = step("initial");
  const [kind, decoration] = fixture.split("-");
  assert.equal(initial.decoration, decoration);
  if (kind === "reveal") {
    // Every load starts on the original avatar with the reveal label.
    assert.equal(initial.reveal.photo, "false");
    assert.equal(initial.reveal.label, "Reveal face");
    assert.equal(initial.reveal.illustration.visible, "visible");
    assert.equal(initial.reveal.photoLayer.visible, "hidden");
    assert.equal(initial.reveal.cue, true);
    // Both images occupy the same box, which never changes.
    assert.deepEqual(
      initial.reveal.illustration.box,
      initial.reveal.photoLayer.box,
    );
    const boxes = trace
      .filter((entry) => entry.reveal?.illustration)
      .flatMap((entry) => [
        entry.reveal.illustration.box,
        entry.reveal.photoLayer.box,
        entry.reveal.illustration.image,
        entry.reveal.photoLayer.image,
      ]);
    for (const box of boxes)
      assert.deepEqual(box, initial.reveal.illustration.box);
    for (const entry of trace.filter((item) => item.step === "wipe started"))
      for (const box of entry.boxes)
        assert.deepEqual(box, initial.reveal.illustration.box);
    assert.equal(step("wipe started").label, "Show avatar");
    for (const [name, photo] of [
      ["revealed", "true"],
      ["enter", "false"],
      ["space", "true"],
      ["guarded double activation", "false"],
    ]) {
      const entry = step(name);
      assert.equal(entry.reveal.photo, photo, name);
      assert.equal(
        entry.reveal.label,
        photo === "true" ? "Show avatar" : "Reveal face",
        name,
      );
      assert.equal(
        entry.reveal.photoLayer.visible,
        photo === "true" ? "visible" : "hidden",
        name,
      );
      assert.ok(!entry.running.includes("portrait-erase"), name);
    }
    assert.equal(step("focus").focusVisible, true);
    assert.equal(step("focus").frameOutline, "solid");
    // The immediate switch flips whatever the previous step showed.
    const at = trace.findIndex((entry) => entry.step === "reduced activation");
    const before = trace.slice(0, at).findLast((entry) => entry.reveal?.photo)
      .reveal.photo;
    assert.equal(trace[at].reveal.photo, before === "true" ? "false" : "true");
    assert.equal(step("reduced during wipe").reveal.erasing, "false");
  } else {
    // Face Reveal off: plain portrait, no cue, no second image.
    assert.equal(initial.reveal, null);
    assert.equal(initial.cue, false);
    assert.equal(initial.secondImage, false);
  }
  if (decoration === "none") {
    assert.equal(initial.control, null);
    assert.equal(initial.playback, null);
    return;
  }
  // Autoplay with a visible Pause control.
  assert.deepEqual(initial.control, { hidden: false, name: "Pause animation" });
  assert.equal(initial.playback, "playing");
  if (decoration === "cat") assert.equal(initial.cat, "loop.webp");
  else assert.ok(handsRun(initial.running), "full hand choreography runs");
  const still = (entry, name) => {
    assert.deepEqual(entry.running, [], `${name}: no running animation`);
    if (decoration === "cat") assert.equal(entry.cat, "still.webp", name);
    else assert.equal(entry.nailsOpacity, "1", `${name}: stationary hands`);
  };
  const moving = (entry, name) => {
    if (decoration === "cat") assert.equal(entry.cat, "loop.webp", name);
    else assert.ok(handsRun(entry.running), name);
  };
  const paused = step("paused");
  still(paused, "paused");
  assert.deepEqual(paused.control, { hidden: false, name: "Play animation" });
  assert.equal(paused.playback, "paused");
  // Pausing never toggles the portrait.
  if (kind === "reveal")
    assert.equal(
      paused.reveal.photo,
      step("guarded double activation").reveal.photo,
    );
  if (kind === "reveal") {
    const revealed = step("revealed while paused");
    still(revealed, "revealed while paused");
    assert.equal(revealed.reveal.photo, "true");
  }
  moving(step("played with Enter"), "played with Enter");
  assert.equal(step("played with Enter").control.name, "Pause animation");
  const reduced = step("reduced while playing");
  still(reduced, "reduced while playing");
  assert.equal(reduced.control.hidden, true, "reduced motion takes priority");
  assert.equal(reduced.playback, "playing");
  moving(step("motion allowed again"), "motion allowed again");
  assert.equal(step("motion allowed again").control.hidden, false);
  const kept = step("pause kept across preference change");
  still(kept, "pause kept");
  assert.equal(kept.control.name, "Play animation");
}

// The trace without per-document URLs and the preview frame's offset.
export function comparable(trace) {
  return JSON.parse(
    JSON.stringify(trace, (key, value) =>
      key === "box" || key === "boxes" || key === "image" || key === "src"
        ? undefined
        : value,
    ),
  );
}

export async function checkFaceRevealParity({ browser, origin, evidence }) {
  const context = await browser.newContext({
    reducedMotion: "no-preference",
    colorScheme: "light",
    viewport: { width: 1280, height: 1000 },
  });
  await context.addCookies([
    { name: "renderer-session", value: "fixture-owner-a", url: origin },
  ]);
  const errors = [];
  const results = [];
  try {
    for (const fixture of FIXTURES) {
      const publicPage = await context.newPage();
      publicPage.on("pageerror", (error) => errors.push(error.message));
      await publicPage.goto(`${origin}/published?fixture=${fixture}`);
      await publicPage.locator(".pf-avatar-frame").waitFor();
      const published = await exercise(publicPage, publicPage);
      checkTrace(fixture, published);
      // A reload is a new visit: the original avatar and playing again.
      await publicPage.reload();
      const reloaded = await snapshot(publicPage);
      if (reloaded.reveal) {
        assert.equal(reloaded.reveal.photo, "false");
        assert.equal(reloaded.reveal.label, "Reveal face");
      }
      assert.equal(reloaded.playback, published[0].playback);
      if (fixture === "reveal-cat")
        await publicPage
          .locator(".pf-avatar-envelope")
          .screenshot({ path: join(evidence, "face-reveal-cat.png") });

      const previewPage = await context.newPage();
      previewPage.on("pageerror", (error) => errors.push(error.message));
      await previewPage.goto(`${origin}/private/host?fixture=${fixture}`);
      await previewPage.waitForFunction(
        () => window.rendererState?.kind === "displayed",
      );
      const frame = previewPage
        .frames()
        .find((candidate) => candidate.url().includes("/private/preview"));
      await frame.locator(".pf-avatar-frame").waitFor();
      const previewed = await exercise(previewPage, frame);
      checkTrace(fixture, previewed);
      assert.deepEqual(
        comparable(previewed),
        comparable(published),
        `${fixture}: preview matches the published page`,
      );
      // A preview content update keeps the visitor's current state.
      if (fixture === "reveal-hands") {
        const before = (await snapshot(frame)).reveal.photo;
        await frame.locator("button[data-face-reveal]").click();
        await settled(frame);
        await frame.locator("[data-avatar-playback]").click();
        await previewPage.evaluate(async (name) => {
          const response = await fetch(`/private/model?fixture=${name}`);
          const model = await response.json();
          model.profile.name = "Updated owner";
          window.rendererBridge.request(async () => model);
        }, fixture);
        await frame.getByText("Updated owner").waitFor();
        const kept = await snapshot(frame);
        assert.equal(kept.reveal.photo, before === "true" ? "false" : "true");
        assert.equal(kept.playback, "paused");
        assert.deepEqual(kept.running, []);
      }
      results.push({ fixture, steps: published.length });
      await previewPage.close();
      await publicPage.close();
    }
    // A narrow viewport keeps the playback control beside the avatar.
    const narrow = await context.newPage();
    await narrow.setViewportSize({ width: 360, height: 900 });
    for (const fixture of ["reveal-cat", "reveal-hands"]) {
      await narrow.goto(`${origin}/published?fixture=${fixture}`);
      const fits = await narrow.evaluate(() => {
        const control = document
          .querySelector("[data-avatar-playback]")
          .getBoundingClientRect();
        const profile = document
          .querySelector(".pf-profile")
          .getBoundingClientRect();
        return (
          control.right <= profile.right &&
          document.documentElement.scrollWidth <= innerWidth
        );
      });
      assert.equal(fits, true, `${fixture} control fits at 360px`);
      await narrow
        .locator(".pf-avatar-envelope")
        .screenshot({ path: join(evidence, `${fixture}-360.png`) });
    }
    await narrow.close();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
  return {
    check:
      "Face Reveal and independent playback behave identically in preview and published pages, start on the original avatar and respect reduced motion",
    passed: true,
    fixtures: results,
  };
}
