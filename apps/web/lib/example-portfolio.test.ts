import { stat } from "node:fs/promises";
import {
  createEmptyDraft,
  draftSchema,
  SAVE_CHANGE_BYTES,
  SAVE_REQUEST_BYTES,
} from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { describe, expect, it } from "vitest";
import {
  exampleContent,
  exampleImages,
} from "../../../scripts/example-portfolio/content.mjs";

// Phase 50: `pnpm example:publish` sends this content through the ordinary
// owner routes, one field per patch, so it must be a valid draft and every
// change must fit the draft API's per-change and per-request limits.
const assets = {
  avatar: "11111111-1111-4111-8111-111111111111",
  banner: "22222222-2222-4222-8222-222222222222",
  umrflix: "33333333-3333-4333-8333-333333333333",
  mixer: "44444444-4444-4444-8444-444444444444",
};
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe("example portfolio content", () => {
  const content = exampleContent(assets);

  it("is a valid draft at the example address with real, accepted content", () => {
    const draft = {
      ...createEmptyDraft(content.appearance),
      ...content,
      requestedSubdomain: "example",
    };
    expect(draftSchema.parse(draft)).toEqual(draft);
    expect(draft.samples).toEqual({});
    expect(content.profile.avatar?.accepted).toBe(true);
    expect(content.links.some((link) => link.showInProfile)).toBe(true);
    // Readiness: named, described and present in the approved catalog.
    expect(content.profile.name && content.profile.bio).toBeTruthy();
    expect(appearanceCatalog.themes.map((theme) => theme.id)).toContain(
      content.appearance.themeId,
    );
    expect(appearanceCatalog.fonts.map((font) => font.id)).toContain(
      content.appearance.fontId,
    );
  });

  it("fits each set patch within the draft API limits", () => {
    for (const key of [
      "profile",
      "links",
      "components",
      "appearance",
    ] as const) {
      const change = { op: "set", path: [key], value: content[key] };
      expect(bytes(change)).toBeLessThanOrEqual(SAVE_CHANGE_BYTES);
      expect(
        bytes({
          context: "setup",
          revision: Number.MAX_SAFE_INTEGER - 1,
          progress: { schemaVersion: 1, step: "review" },
          change,
        }),
      ).toBeLessThanOrEqual(SAVE_REQUEST_BYTES);
    }
  });

  it("references every uploaded image and ships images within the upload limit", async () => {
    const text = JSON.stringify(content);
    for (const id of Object.values(assets)) expect(text).toContain(id);
    for (const { file } of Object.values(exampleImages))
      expect((await stat(file)).size).toBeLessThanOrEqual(5_242_880);
  });
});
