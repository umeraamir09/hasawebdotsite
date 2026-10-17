import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const source = path("../public/assets/avatar-ginger-cat-loop.webp");
const {
  width,
  pageHeight: height,
  pages,
  delay,
  loop,
} = await sharp(source, {
  animated: true,
}).metadata();
if (width !== 212 || height !== 220 || !pages || delay?.length !== pages) {
  throw new Error(
    "The cat animation must have 212 × 220 frames and frame timing.",
  );
}

const mouthMask = (
  await readFile(path("../public/assets/avatar-cat-mouth-mask.svg"))
).toString("base64");

// Render the edge cleanup once into the asset. Live SVG filters can cache an
// animated image's first frame in Firefox/Zen until another event repaints it.
async function cleanFrame(pixels) {
  const png = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <filter id="mouth-edge" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">
        <feMorphology in="SourceAlpha" operator="erode" radius="${4 / width} ${4 / height}" result="trimmed" />
        <feImage href="data:image/svg+xml;base64,${mouthMask}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="mouth" />
        <feComposite in="trimmed" in2="mouth" operator="in" result="cleanMouth" />
        <feComposite in="SourceAlpha" in2="mouth" operator="out" result="fur" />
        <feComposite in="cleanMouth" in2="fur" operator="arithmetic" k2="1" k3="1" result="cleanAlpha" />
        <feComposite in="SourceGraphic" in2="cleanAlpha" operator="in" />
      </filter>
    </defs>
    <image href="data:image/png;base64,${png.toString("base64")}" width="${width}" height="${height}" filter="url(#mouth-edge)" />
  </svg>`;
  return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
}

const original = await sharp(source, { animated: true })
  .ensureAlpha()
  .raw()
  .toBuffer();
const frameBytes = width * height * 4;
const frames = [];
for (let frame = 0; frame < pages; frame++) {
  frames.push(
    await cleanFrame(
      original.subarray(frame * frameBytes, (frame + 1) * frameBytes),
    ),
  );
}

const cleaned = Buffer.concat(frames);
const output = path("../public/assets/avatar-ginger-cat-clean-loop.webp");
await sharp(cleaned, {
  raw: { width, height: height * pages, channels: 4, pageHeight: height },
})
  .webp({ lossless: true, effort: 6, loop, delay })
  .toFile(output);

const encoded = sharp(output, { animated: true });
const metadata = await encoded.metadata();
if (
  metadata.pages !== pages ||
  metadata.loop !== loop ||
  JSON.stringify(metadata.delay) !== JSON.stringify(delay) ||
  !(await encoded.ensureAlpha().raw().toBuffer()).equals(cleaned)
) {
  throw new Error("Encoding changed the cleaned frames or animation timing.");
}

const still = await sharp(path("../public/assets/avatar-ginger-cat-still.webp"))
  .ensureAlpha()
  .raw()
  .toBuffer();
await sharp(await cleanFrame(still), { raw: { width, height, channels: 4 } })
  .webp({ lossless: true, effort: 6 })
  .toFile(path("../public/assets/avatar-ginger-cat-clean-still.webp"));

console.log(
  `Cleaned ${pages} frames and the reduced-motion still; preserved every frame, delay and the infinite loop.`,
);
