import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sharingCardPalette,
  sharingCardText,
} from "@hasaweb/components/sharing-card";
import { describe, expect, it } from "vitest";
import { encodePng } from "./png";
import {
  type CardModules,
  cardImage,
  renderSharingCard,
} from "./sharing-card-render";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
// Workers types declare WebAssembly.Module abstract; Node constructs it.
const WasmModule = WebAssembly.Module as unknown as new (
  bytes: Uint8Array,
) => WebAssembly.Module;
const compile = async (path: string) => new WasmModule(await readFile(path));
const modules: CardModules = {
  yoga: await compile(
    join(require.resolve("satori/package.json"), "../layout.wasm"),
  ),
  resvg: await compile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
  webp: await compile(
    join(
      require.resolve("@jsquash/webp/package.json"),
      "../codec/dec/webp_dec.wasm",
    ),
  ),
};
const size = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset);
  return [view.getUint32(16), view.getUint32(20)];
};

describe("png encoder", () => {
  it("writes a PNG that the card renderer accepts", async () => {
    const rgba = new Uint8Array(3 * 2 * 4).fill(200);
    const png = await encodePng(rgba, 3, 2);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(size(png)).toEqual([3, 2]);
    expect(await cardImage(png, modules)).toMatch(/^data:image\/png;base64,/);
    await expect(encodePng(rgba, 4, 2)).rejects.toThrow();
  });
});

describe("sharing card renderer", () => {
  it("decodes WebP uploads and treats anything else as missing", async () => {
    const webp = await readFile(
      join(root, "apps/web/public/assets/umer-avatar-photo.webp"),
    );
    expect(await cardImage(webp, modules)).toMatch(/^data:image\/png;base64,/);
    expect(await cardImage(new TextEncoder().encode("<svg>"), modules)).toBe(
      null,
    );
    const fakeWebp = new TextEncoder().encode("RIFF0000WEBPVP8 broken");
    expect(await cardImage(fakeWebp, modules)).toBe(null);
  });

  it("renders a 1200x630 PNG of the profile in its theme", async () => {
    const width = 1600,
      height = 480;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++)
      rgba.set([40, 90 + ((i % width) * 120) / width, 200, 255], i * 4);
    const art = await readFile(
      join(root, "packages/components/static/sharing-card-cat.png"),
    );
    const png = await renderSharingCard(
      {
        palette: sharingCardPalette("leaf", "dark"),
        fontFamily: "DM Sans",
        ...sharingCardText({
          name: "Mira Sen",
          bio: "I build thoughtful tools for everyday work. Clear notes, useful outcomes, and small details that make software feel calm.",
          location: "Karachi, Pakistan",
          links: ["Website", "GitHub", "Say hello"],
        }),
        banner: await cardImage(await encodePng(rgba, width, height), modules),
        avatar: await cardImage(
          await readFile(
            join(root, "apps/web/public/assets/umer-avatar-photo.webp"),
          ),
          modules,
        ),
        decoration: "cat",
        decorationImage: await cardImage(art, modules),
      },
      (
        await readFile(
          join(root, "packages/components/static/dm-sans-variable.ttf"),
        )
      ).buffer as ArrayBuffer,
      modules,
    );
    expect(size(png)).toEqual([1200, 630]);
    // Bytes that only look like a PNG render as an empty surface.
    const broken = new Uint8Array(64).fill(42);
    broken.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const plain = await renderSharingCard(
      {
        palette: sharingCardPalette("clay", "system"),
        fontFamily: "DM Sans",
        ...sharingCardText({ name: "Plain", bio: "", links: [] }),
        banner: await cardImage(broken, modules),
        avatar: null,
        decoration: "hands",
        decorationImage: null,
      },
      (
        await readFile(
          join(root, "packages/components/static/dm-sans-variable.ttf"),
        )
      ).buffer as ArrayBuffer,
      modules,
    );
    expect(size(plain)).toEqual([1200, 630]);
    if (process.env.SHARING_CARD_OUT)
      await writeFile(process.env.SHARING_CARD_OUT, png);
  });
});
