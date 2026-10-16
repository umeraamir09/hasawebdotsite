import { describe, expect, it } from "vitest";
import {
  freeStringMinimum,
  sqlJsonPath,
  validateDraftValue,
  validateRemove,
} from "./updates";

describe("bounded schema paths", () => {
  const projectTypes = { $: null, '$."components"[0]': "projects" };
  it("uses the current component discriminator and the existing leaf rules", () => {
    expect(
      validateDraftValue(
        ["components", 0, "data", "entries", 0, "summary"],
        projectTypes,
        "A summary",
      ),
    ).toBe('"A summary"');
    expect(() =>
      validateDraftValue(
        ["components", 0, "data", "entries", 0, "demoUrl"],
        projectTypes,
        "javascript:alert(1)",
      ),
    ).toThrow();
    expect(() =>
      validateDraftValue(
        ["components", 0, "data", "categories"],
        projectTypes,
        [],
      ),
    ).toThrow();
    expect(() =>
      validateDraftValue(["components", 0, "type"], projectTypes, "text"),
    ).toThrow();
  });
  it("allows staged free text and keeps constrained values in the schema validator", () => {
    expect(freeStringMinimum(["profile", "bio"], {})).toBe(0);
    expect(() => freeStringMinimum(["appearance", "themeId"], {})).toThrow();
    expect(() => freeStringMinimum(["links", 0, "value"], {})).toThrow();
  });
  it("rejects prototype paths, unknown keys, impossible indices and required-field removal", () => {
    for (const path of [
      ["__proto__"],
      ["profile", "constructor"],
      ["unknown"],
      ["links", 2000000],
    ])
      expect(() => sqlJsonPath(path)).toThrow();
    expect(() => validateRemove(["profile", "name"], {}, 0)).toThrow();
    expect(() => validateRemove(["links", 1], {}, 1)).toThrow();
  });
  it("bounds submitted JSON and nesting before recursive content validation", () => {
    expect(() =>
      validateDraftValue(["profile", "bio"], {}, "x".repeat(4096)),
    ).toThrow();
    const deep: Record<string, unknown> = {};
    let node = deep;
    for (let i = 0; i < 70; i++) {
      const next = {};
      node.content = next;
      node = next;
    }
    expect(() => validateDraftValue(["profile", "bio"], {}, deep)).toThrow();
  });
});
