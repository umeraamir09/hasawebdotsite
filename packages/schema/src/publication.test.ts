import { expect, it } from "vitest";
import { createEmptyDraft } from "./draft";
import { publicationCommandSchema, publicationContent } from "./publication";
import { createComponent } from "./registry";

it("omits untouched component samples and disabled face images without changing the private draft", () => {
  const draft = createEmptyDraft({
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  });
  draft.requestedSubdomain = "private-address";
  draft.components = [
    createComponent("resume", "sample"),
    createComponent("projects", "edited"),
  ];
  draft.samples = { "components.sample": true };
  draft.profile.faceReveal = {
    enabled: false,
    image: { assetId: "private-face" },
  };
  const content = publicationContent(draft);
  expect(content.components.map((item) => item.id)).toEqual(["edited"]);
  expect(content.profile.faceReveal).toEqual({ enabled: false });
  expect(content).not.toHaveProperty("requestedSubdomain");
  expect(content).not.toHaveProperty("samples");
  expect(draft.components).toHaveLength(2);
  expect(draft.profile.faceReveal.image?.assetId).toBe("private-face");
});
it("keeps enabled face images and rejects client readiness flags", () => {
  const draft = createEmptyDraft({
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  });
  draft.profile.faceReveal = { enabled: true, image: { assetId: "face" } };
  expect(publicationContent(draft).profile.faceReveal.image?.assetId).toBe(
    "face",
  );
  expect(
    publicationCommandSchema.safeParse({
      portfolioId: "p",
      revision: 0,
      ready: true,
    }).success,
  ).toBe(false);
});

it("rejects corrupt sample targets before omitting compatible samples", () => {
  const draft = createEmptyDraft({
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  });
  draft.samples = { "components.missing": true };
  expect(() => publicationContent(draft)).toThrow(
    "Sample marker has no target",
  );
});
