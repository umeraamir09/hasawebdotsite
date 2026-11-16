import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import manifest from "./avatar-import-manifest.json";

const root = new URL("../../../", import.meta.url);
const require = createRequire(new URL("apps/web/package.json", root));
const sharp: typeof import("sharp") = require("sharp");
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("faithful portfolio avatar import", () => {
  for (const entry of manifest.files) {
    it(`preserves ${entry.destination}`, () => {
      const bytes = readFileSync(new URL(entry.destination, root));
      expect(digest(bytes)).toBe(entry.sha256);
      if (entry.change === "asset-map import only") {
        const restored = bytes
          .toString()
          .replace('from "../lib/avatar-assets"', 'from "@/lib/assets"');
        expect(digest(Buffer.from(restored))).toBe(entry.sourceSha256);
      }
    });
  }

  it("keeps the exact cleaned animation dimensions, all frame delays and the infinite loop", async () => {
    const asset = (name: string) =>
      new URL(`apps/web/public/assets/${name}`, root).pathname;
    const raw = await sharp(asset("avatar-ginger-cat-loop.webp"), {
      animated: true,
    }).metadata();
    const clean = await sharp(asset("avatar-ginger-cat-clean-loop.webp"), {
      animated: true,
    }).metadata();
    const still = await sharp(
      asset("avatar-ginger-cat-clean-still.webp"),
    ).metadata();
    for (const metadata of [raw, clean]) {
      expect(metadata.width).toBe(212);
      expect(metadata.pageHeight).toBe(220);
      expect(metadata.pages).toBe(32);
      expect(metadata.loop).toBe(0);
    }
    expect(clean.delay).toEqual(raw.delay);
    expect(clean.delay?.reduce((sum, duration) => sum + duration, 0)).toBe(
      3920,
    );
    expect(still.width).toBe(212);
    expect(still.height).toBe(220);
    expect(still.pages ?? 1).toBe(1);
  });
});
