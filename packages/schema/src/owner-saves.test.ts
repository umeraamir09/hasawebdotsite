import { describe, expect, it } from "vitest";
import {
  inspectionFreeText,
  inspectionSchema,
  validateDestination,
} from "./draft-inspection";
import { ownerSaveActions } from "./owner-saves";
import { sqlJsonPath } from "./updates";

describe("owner save contract", () => {
  const change = { op: "set", path: ["profile", "name"], value: "Owner" };
  it("requires setup progress and excludes progress from content writes", () => {
    expect(
      ownerSaveActions.patch.safeParse({
        revision: 0,
        context: "setup",
        change,
      }).success,
    ).toBe(false);
    expect(
      ownerSaveActions.patch.safeParse({
        revision: 0,
        context: "setup",
        progress: { schemaVersion: 1, step: "profile" },
        change,
      }).success,
    ).toBe(true);
    expect(
      ownerSaveActions.patch.safeParse({
        revision: 0,
        context: "content",
        change,
      }).success,
    ).toBe(true);
    expect(
      ownerSaveActions.patch.safeParse({
        revision: 0,
        context: "content",
        progress: { schemaVersion: 1, step: "profile" },
        change,
      }).success,
    ).toBe(false);
  });
  it("rejects identity, milestone, context and cursor injection", () => {
    for (const extra of [
      { userId: "other" },
      { firstEditorEnteredAt: 1 },
      { validationVersion: 2 },
    ])
      expect(
        ownerSaveActions.begin.safeParse({
          revision: 0,
          context: "content",
          ...extra,
        }).success,
      ).toBe(false);
    const id = "a6e48cbc-59bd-4fe2-b313-0364e654b1ed";
    expect(
      ownerSaveActions.change.safeParse({
        id,
        sequence: 0,
        change,
        context: "content",
      }).success,
    ).toBe(false);
    expect(
      ownerSaveActions["validation-step"].safeParse({
        id,
        sequence: 0,
        cursor: [],
      }).success,
    ).toBe(false);
    for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER])
      expect(
        ownerSaveActions.begin.safeParse({ revision, context: "content" })
          .success,
      ).toBe(false);
  });
  it("distinguishes free text from constrained destinations and discriminated nodes", () => {
    expect(inspectionFreeText(inspectionSchema(["profile", "bio"], {}))).toBe(
      true,
    );
    expect(
      inspectionFreeText(inspectionSchema(["links", 0, "value"], {}, "email")),
    ).toBe(false);
    const path = ["components", 0, "data", "body", "content", 0];
    const types = {
      [sqlJsonPath(["components", 0])]: "text",
      [sqlJsonPath(path)]: "heading",
    };
    expect(
      inspectionSchema(path, types).safeParse({
        type: "heading",
        attrs: { level: 2 },
      }).success,
    ).toBe(true);
    expect(() => inspectionSchema(path, {})).toThrow();
    expect(() =>
      validateDestination(
        ["links", 0, "value"],
        "https://example.test",
        "email",
      ),
    ).toThrow();
    expect(() => validateDestination(["profile", "name"], "Owner")).toThrow();
    expect(() =>
      validateDestination(["links", 0, "value"], "owner@example.test", "email"),
    ).not.toThrow();
  });
});
