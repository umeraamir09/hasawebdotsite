import { describe, expect, it } from "vitest";
import {
  cropRectangle,
  cropSizes,
  initialCrop,
  validateImageFile,
} from "./crop";
import { IMAGE_BYTES } from "./formats";

describe("finished profile crops", () => {
  for (const purpose of ["avatar", "banner"] as const) {
    for (const image of [
      { width: 1200, height: 600 },
      { width: 600, height: 1200 },
    ]) {
      it(`keeps ${purpose} within ${image.width} by ${image.height} at every edge and zoom`, () => {
        for (const zoom of [1, 2, 4]) {
          for (const x of [0, 0.5, 1]) {
            for (const y of [0, 0.5, 1]) {
              const crop = cropRectangle(image, purpose, { x, y, zoom });
              expect(crop.width / crop.height).toBeCloseTo(
                cropSizes[purpose].width / cropSizes[purpose].height,
              );
              expect(crop.x).toBeGreaterThanOrEqual(0);
              expect(crop.y).toBeGreaterThanOrEqual(0);
              expect(crop.x + crop.width).toBeLessThanOrEqual(
                image.width + 0.001,
              );
              expect(crop.y + crop.height).toBeLessThanOrEqual(
                image.height + 0.001,
              );
            }
          }
        }
      });
    }
  }
  it("resets to the center of the current selection", () => {
    const source = { width: 900, height: 600 };
    const moved = cropRectangle(source, "banner", { zoom: 2, x: 1, y: 0 });
    const reset = cropRectangle(source, "banner", initialCrop);
    expect(moved).not.toEqual(reset);
    expect(reset).toEqual({ x: 0, y: 165, width: 900, height: 270 });
  });
  it("accepts every supported media type at the exact byte limit", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(() =>
        validateImageFile(new Blob([new Uint8Array(IMAGE_BYTES)], { type })),
      ).not.toThrow();
      expect(() =>
        validateImageFile(
          new Blob([new Uint8Array(IMAGE_BYTES + 1)], { type }),
        ),
      ).toThrow("5 MiB");
    }
    expect(() =>
      validateImageFile(new Blob(["not an image"], { type: "image/gif" })),
    ).toThrow("JPEG, PNG or WebP");
    expect(() =>
      validateImageFile(new Blob([], { type: "image/png" })),
    ).toThrow("empty");
  });
});
