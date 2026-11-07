import { createEmptyDraft, draftSchema, serializeDraft } from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { describe, expect, it } from "vitest";
import {
  faceRevealIncomplete,
  withDecoration,
  withFaceRevealEnabled,
  withoutFaceImage,
} from "./avatar-extras";

const fresh = () =>
  createEmptyDraft({ themeId: "leaf", fontId: "dm-sans", colorMode: "system" });

describe("avatar decoration and Face Reveal draft changes", () => {
  it("starts a new draft with no decoration and Face Reveal off", () => {
    const draft = fresh();
    expect("decorationId" in draft.profile).toBe(false);
    expect(draft.profile.faceReveal).toEqual({ enabled: false });
    expect(faceRevealIncomplete(draft)).toBe(false);
    expect(appearanceCatalog.decorations.map(({ id }) => id)).toEqual([
      "cat",
      "hands",
    ]);
  });
  it("selects, changes and removes a decoration by omitting the key", () => {
    const draft = fresh();
    const cat = withDecoration(draft, "cat");
    expect(cat.profile.decorationId).toBe("cat");
    const hands = withDecoration(cat, "hands");
    expect(hands.profile.decorationId).toBe("hands");
    const removed = withDecoration(hands, null);
    expect("decorationId" in removed.profile).toBe(false);
    expect(removed.profile.decorationId).toBeUndefined();
    // The saved JSON has no key at all, never `null` or an empty string.
    expect(serializeDraft(removed).json).not.toContain("decorationId");
    expect(draftSchema.parse(removed)).toEqual(removed);
    // Inputs are never mutated.
    expect(hands.profile.decorationId).toBe("hands");
    expect(draft.profile).not.toHaveProperty("decorationId");
  });
  it("never writes null for a removed decoration", () => {
    const removed = withDecoration(withDecoration(fresh(), "cat"), null);
    expect(Object.keys(removed.profile)).not.toContain("decorationId");
    expect(
      draftSchema.safeParse({
        ...removed,
        profile: { ...removed.profile, decorationId: null },
      }).success,
    ).toBe(false);
  });
  it("flags an enabled Face Reveal that has no second photo", () => {
    const enabled = withFaceRevealEnabled(fresh(), true);
    expect(enabled.profile.faceReveal).toEqual({ enabled: true });
    expect(faceRevealIncomplete(enabled)).toBe(true);
  });
  it("retains a ready second photo privately when Face Reveal is turned off", () => {
    const ready = fresh();
    ready.profile.faceReveal = {
      enabled: true,
      image: { assetId: "face-1", alt: "Me outdoors" },
    };
    expect(faceRevealIncomplete(ready)).toBe(false);
    const off = withFaceRevealEnabled(ready, false);
    expect(off.profile.faceReveal).toEqual({
      enabled: false,
      image: { assetId: "face-1", alt: "Me outdoors" },
    });
    expect(faceRevealIncomplete(off)).toBe(false);
    // Turning it back on restores the same photo without a new upload.
    expect(withFaceRevealEnabled(off, true).profile.faceReveal.image).toEqual({
      assetId: "face-1",
      alt: "Me outdoors",
    });
    expect(draftSchema.parse(off)).toEqual(off);
  });
  it("removing the photo keeps the setting, so an enabled add-on is incomplete", () => {
    const ready = fresh();
    ready.profile.faceReveal = { enabled: true, image: { assetId: "face-1" } };
    const removed = withoutFaceImage(ready);
    expect(removed.profile.faceReveal).toEqual({ enabled: true });
    expect("image" in removed.profile.faceReveal).toBe(false);
    expect(faceRevealIncomplete(removed)).toBe(true);
    expect(faceRevealIncomplete(withFaceRevealEnabled(removed, false))).toBe(
      false,
    );
    expect(ready.profile.faceReveal.image?.assetId).toBe("face-1");
  });
});
