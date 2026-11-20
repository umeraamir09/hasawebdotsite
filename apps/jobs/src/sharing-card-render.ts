import { Buffer } from "node:buffer";
import {
  SHARING_CARD,
  SharingCard,
  type SharingCardProps,
} from "@hasaweb/components/sharing-card";
import decodeWebp, { init as initWebp } from "@jsquash/webp/decode";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { createElement } from "react";
import satori, { init as initSatori } from "satori/standalone";
import { encodePng } from "./png";

// The card renderer takes its WebAssembly modules from the caller: the Worker
// imports them as compiled modules, and Node tests compile the same files.
export type CardModules = {
  yoga: WebAssembly.Module;
  resvg: WebAssembly.Module;
  webp: WebAssembly.Module;
};

let ready: Promise<void> | undefined;
function initialize(modules: CardModules) {
  // jsquash returns its result as ImageData, which Workers do not define.
  (globalThis as { ImageData?: unknown }).ImageData ??= class {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  };
  ready ??= Promise.all([
    initSatori(modules.yoga),
    initWasm(modules.resvg),
    initWebp(modules.webp),
  ]).then(() => undefined);
  return ready;
}

const signature = (bytes: Uint8Array, values: number[], offset = 0) =>
  values.every((value, index) => bytes[offset + index] === value);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/**
 * A data URI that resvg can draw, or null when the bytes are not a decodable
 * JPEG, PNG or WebP image. A missing image leaves its surface in the card.
 */
export async function cardImage(
  bytes: Uint8Array,
  modules: CardModules,
): Promise<string | null> {
  await initialize(modules);
  const uri = (type: string, data: Uint8Array) =>
    `data:${type};base64,${Buffer.from(data).toString("base64")}`;
  if (signature(bytes, [255, 216, 255])) return uri("image/jpeg", bytes);
  if (signature(bytes, [137, 80, 78, 71, 13, 10, 26, 10]))
    return uri("image/png", bytes);
  if (signature(bytes, ascii("RIFF")) && signature(bytes, ascii("WEBP"), 8)) {
    let image: { data: Uint8ClampedArray; width: number; height: number };
    try {
      image = await decodeWebp(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      );
    } catch {
      return null; // Undecodable bytes behave like a missing image.
    }
    return uri(
      "image/png",
      await encodePng(image.data, image.width, image.height),
    );
  }
  return null;
}

export async function renderSharingCard(
  props: SharingCardProps,
  font: ArrayBuffer,
  modules: CardModules,
): Promise<Uint8Array> {
  await initialize(modules);
  const fonts = ([400, 700] as const).map((weight) => ({
    name: props.fontFamily,
    data: font,
    weight,
    style: "normal" as const,
  }));
  const svg = await satori(createElement(SharingCard, props), {
    ...SHARING_CARD,
    fonts,
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: SHARING_CARD.width },
  });
  try {
    return resvg.render().asPng();
  } finally {
    resvg.free();
  }
}
