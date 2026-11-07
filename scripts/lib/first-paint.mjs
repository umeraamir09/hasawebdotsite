// Records what the browser actually paints from the first rendering
// opportunity. requestAnimationFrame callbacks run only in rendering updates,
// and a document is render-blocked until its <body> exists and its blocking
// stylesheets have loaded, so every sample corresponds to a painted frame.
export const FIRST_PAINT_SAMPLER = `(() => {
  const frames = [];
  Object.defineProperty(window, "__paintFrames", { value: frames });
  let count = 0;
  const sample = () => {
    const root = document.documentElement;
    if (document.body) {
      const style = getComputedStyle(root);
      frames.push({
        background: style.backgroundColor,
        fontFamily: style.fontFamily,
        colorMode: root.dataset.colorMode ?? null,
        bodyChildren: document.body.childElementCount,
      });
    }
    if (++count < 240 && (document.readyState !== "complete" || frames.length < 8))
      requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
})();`;

export async function paintedFrames(page) {
  await page.waitForFunction(
    () =>
      document.readyState === "complete" && window.__paintFrames?.length >= 8,
  );
  return page.evaluate(() => [...window.__paintFrames]);
}

export function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
}

// Visitor choice wins, then the owner's light/dark, then the system setting.
export function resolvedMode({ initial, system, stored }) {
  if (stored) return stored;
  if (initial === "light" || initial === "dark") return initial;
  return system;
}
