import { describe, expect, it } from "vitest";
import { completeDraft } from "./fixtures.test-support";
import { DRAFT_MAX_BYTES, draftSchema, serializeDraft } from "./index";

describe("single-pass draft JSON guards", () => {
  it("serializes the same accepted document without changing its content", () => {
    const input = completeDraft();
    const result = serializeDraft(input);
    expect(JSON.parse(result.json)).toEqual(draftSchema.parse(input));
    expect(result.draft).toEqual(input);
  });
  it("accepts exactly 1 MiB and rejects one additional UTF-8 byte", () => {
    const input = completeDraft();
    input.profile.bio = "";
    const missing =
      DRAFT_MAX_BYTES -
      new TextEncoder().encode(JSON.stringify(input)).byteLength;
    input.profile.bio = "x".repeat(missing);
    expect(
      new TextEncoder().encode(serializeDraft(input).json).byteLength,
    ).toBe(DRAFT_MAX_BYTES);
    input.profile.bio += "x";
    expect(() => serializeDraft(input)).toThrow();
  });
  it("keeps standalone rich-text guards and whole-draft rejection equivalent", () => {
    const cases: unknown[] = [];
    const duplicate = completeDraft();
    const first = duplicate.components[0];
    if (!first) throw new Error("missing fixture");
    duplicate.components.push(first);
    cases.push(duplicate);
    const unsafe = completeDraft();
    const link = unsafe.links[0];
    if (!link) throw new Error("missing fixture");
    link.value = "javascript:alert(1)";
    cases.push(unsafe);
    const marked = completeDraft();
    marked.samples["components.absent"] = true;
    cases.push(marked);
    const unknown = { ...completeDraft(), unknown: true };
    cases.push(unknown);
    const getter = completeDraft();
    Object.defineProperty(getter.profile, "bio", {
      get() {
        throw new Error("must not execute");
      },
      enumerable: true,
    });
    cases.push(getter);
    const proto = JSON.parse(JSON.stringify(completeDraft()));
    proto.profile.constructor = "bad";
    cases.push(proto);
    const nonfinite = completeDraft() as unknown as Record<string, unknown>;
    nonfinite.schemaVersion = Infinity;
    cases.push(nonfinite);
    const deep = completeDraft() as unknown as Record<string, unknown>;
    let node: Record<string, unknown> = deep;
    for (let i = 0; i < 70; i++) {
      const next = {};
      node.extra = next;
      node = next;
    }
    cases.push(deep);
    for (const input of cases) {
      expect(draftSchema.safeParse(input).success).toBe(false);
      expect(() => serializeDraft(input)).toThrow();
    }
  });
});
