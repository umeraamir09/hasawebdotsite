import { createEmptyDraft, markSample } from "@hasaweb/schema";
import { describe, expect, it } from "vitest";
import { completeDraft } from "../../../../packages/schema/src/fixtures.test-support";
import { missingProfileFields } from "./profile";

describe("required profile feedback", () => {
  it("starts with no sample identity and four missing required fields", () => {
    const draft = createEmptyDraft({
      themeId: "leaf",
      fontId: "dm-sans",
      colorMode: "system",
    });
    expect(draft.profile).toEqual({
      name: "",
      bio: "",
      faceReveal: { enabled: false },
    });
    expect(missingProfileFields(draft)).toEqual([
      "name",
      "bio",
      "avatar",
      "banner",
    ]);
  });
  it("does not require optional location", () => {
    const draft = completeDraft();
    delete draft.profile.location;
    expect(missingProfileFields(draft)).toEqual([]);
  });
  it.each(["name", "bio", "avatar", "banner"] as const)(
    "rejects untouched legacy sample %s",
    (field) => {
      expect(
        missingProfileFields(markSample(completeDraft(), `profile.${field}`)),
      ).toEqual([field]);
    },
  );
  it("rejects whitespace text and unaccepted avatar", () => {
    const draft = completeDraft();
    draft.profile.name = " \t";
    draft.profile.bio = "\n";
    if (!draft.profile.avatar) throw new Error("Missing fixture avatar");
    draft.profile.avatar.accepted = false;
    expect(missingProfileFields(draft)).toEqual(["name", "bio", "avatar"]);
  });
});
