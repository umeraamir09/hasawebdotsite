import { describe, expect, it } from "vitest";
import { completeDraft } from "./fixtures.test-support";
import {
  DRAFT_MAX_BYTES,
  draftSchema,
  initialSetupProgress,
  readDraft,
  requestedSubdomainSchema,
  setupProgressSchema,
  toPublicContent,
} from "./index";

describe("initial setup contracts", () => {
  it("migrates v1 content and samples without inventing a candidate", () => {
    const input = { ...completeDraft(), schemaVersion: 1 };
    const before = JSON.stringify(input);
    expect(readDraft(input)).toEqual({ ...input, schemaVersion: 2 });
    expect(JSON.stringify(input)).toBe(before);
    expect(readDraft(input)).not.toHaveProperty("requestedSubdomain");
    expect(() => draftSchema.parse(input)).toThrow();
    expect(() =>
      readDraft({ ...input, requestedSubdomain: "candidate" }),
    ).toThrow();
  });
  it("upgrades a full 1 MiB legacy document without increasing its size", () => {
    const input = { ...completeDraft(), schemaVersion: 1 };
    input.profile.bio = "";
    input.profile.bio = "x".repeat(
      DRAFT_MAX_BYTES - new TextEncoder().encode(JSON.stringify(input)).length,
    );
    const output = readDraft(input);
    expect(output.profile).toEqual(input.profile);
    expect(new TextEncoder().encode(JSON.stringify(output)).length).toBe(
      DRAFT_MAX_BYTES,
    );
  });
  it("accepts only the existing candidate format", () => {
    for (const value of ["abc", "a-b", "1-2", "a".repeat(30)])
      expect(requestedSubdomainSchema.parse(value)).toBe(value);
    for (const value of [
      "",
      "ab",
      "a".repeat(31),
      "ABC",
      "-abc",
      "abc-",
      "a_b",
      "ébc",
      "abc.site",
    ])
      expect(requestedSubdomainSchema.safeParse(value).success).toBe(false);
  });
  it("keeps navigation versioned and rejects completion flags and answer copies", () => {
    expect(initialSetupProgress()).toEqual({
      schemaVersion: 1,
      step: "address",
    });
    for (const step of [
      "address",
      "profile",
      "links",
      "skills",
      "projects",
      "github",
      "review",
    ])
      expect(setupProgressSchema.parse({ schemaVersion: 1, step }).step).toBe(
        step,
      );
    for (const input of [
      { schemaVersion: 2, step: "address" },
      { schemaVersion: 1, step: "editor" },
      { ...initialSetupProgress(), enteredEditor: true },
      { ...initialSetupProgress(), firstEditorEnteredAt: 1 },
      { ...initialSetupProgress(), answers: {} },
    ])
      expect(setupProgressSchema.safeParse(input).success).toBe(false);
  });
  it("projects only public content and rejects setup metadata inside a draft", () => {
    const draft = { ...completeDraft(), requestedSubdomain: "unclaimed" };
    const projected = toPublicContent(draft);
    expect(Object.keys(projected)).toEqual([
      "schemaVersion",
      "profile",
      "links",
      "components",
      "appearance",
      "seo",
    ]);
    expect(projected.profile).toEqual(draft.profile);
    expect(projected.components).toEqual(draft.components);
    for (const key of [
      "setupProgress",
      "firstEditorEnteredAt",
      "enteredEditor",
    ])
      expect(() => draftSchema.parse({ ...draft, [key]: true })).toThrow();
  });
});
