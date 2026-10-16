import { describe, expect, it } from "vitest";
import { completeDraft } from "./fixtures.test-support";
import {
  freeStringMinimum,
  sqlJsonPath,
  validateDraftValue,
  validateRemove,
} from "./updates";

describe("bounded schema paths", () => {
  const projectTypes = { $: null, '$."components"[0]': "projects" };
  it("resolves stored leaves across all MVP components and nested rich-text lists", () => {
    const draft = completeDraft();
    const text = draft.components.find(
      (component) => component.type === "text",
    );
    if (text?.type !== "text") throw new Error("Missing fixture");
    text.data.body.content.push({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Outer" }] },
            {
              type: "orderedList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Nested" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const types: Record<string, unknown> = {};
    const leaves: { path: (string | number)[]; value: unknown }[] = [];
    const walk = (value: unknown, path: (string | number)[]): void => {
      if (Array.isArray(value))
        value.forEach((child, i) => {
          walk(child, [...path, i]);
        });
      else if (value && typeof value === "object") {
        if ("type" in value) types[sqlJsonPath(path)] = value.type;
        for (const [key, child] of Object.entries(value))
          walk(child, [...path, key]);
      } else leaves.push({ path, value });
    };
    walk(draft, []);
    for (const { path, value } of leaves) {
      if (path[0] === "links" && ["kind", "value"].includes(String(path[2])))
        continue;
      expect(
        () => validateDraftValue(path, types, value),
        path.join("."),
      ).not.toThrow();
    }
    expect(leaves.length).toBeGreaterThan(100);
  });
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
      validateDraftValue(["profile", "bio"], {}, "x".repeat(5120)),
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
