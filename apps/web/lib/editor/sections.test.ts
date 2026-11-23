import { describe, expect, it } from "vitest";
import { completeDraft } from "../../../../packages/schema/src/fixtures.test-support";
import { activeSelection, moveTarget, outlineKey } from "./sections";

const ids = ["a", "b", "c"];
const key = (name: string, altKey = false) => ({ key: name, altKey });

describe("outline keyboard", () => {
  it("moves the selection through the profile and the sections", () => {
    expect(outlineKey(ids, { kind: "profile" }, key("ArrowDown"))).toEqual({
      kind: "select",
      selection: { kind: "component", id: "a" },
    });
    expect(
      outlineKey(ids, { kind: "component", id: "a" }, key("ArrowUp")),
    ).toEqual({ kind: "select", selection: { kind: "profile" } });
    expect(
      outlineKey(ids, { kind: "component", id: "b" }, key("ArrowDown")),
    ).toEqual({ kind: "select", selection: { kind: "component", id: "c" } });
    expect(outlineKey(ids, { kind: "profile" }, key("ArrowUp"))).toBeNull();
    expect(
      outlineKey(ids, { kind: "component", id: "c" }, key("ArrowDown")),
    ).toBeNull();
    expect(
      outlineKey(ids, { kind: "component", id: "b" }, key("Home")),
    ).toEqual({ kind: "select", selection: { kind: "profile" } });
    expect(outlineKey(ids, { kind: "profile" }, key("End"))).toEqual({
      kind: "select",
      selection: { kind: "component", id: "c" },
    });
  });

  it("reorders a section with Alt and an arrow, and never moves the profile", () => {
    expect(
      outlineKey(ids, { kind: "component", id: "b" }, key("ArrowUp", true)),
    ).toEqual({ kind: "move", id: "b", targetId: "a" });
    expect(
      outlineKey(ids, { kind: "component", id: "b" }, key("ArrowDown", true)),
    ).toEqual({ kind: "move", id: "b", targetId: "c" });
    expect(
      outlineKey(ids, { kind: "component", id: "a" }, key("ArrowUp", true)),
    ).toBeNull();
    expect(
      outlineKey(ids, { kind: "component", id: "c" }, key("ArrowDown", true)),
    ).toBeNull();
    expect(
      outlineKey(ids, { kind: "profile" }, key("ArrowDown", true)),
    ).toBeNull();
  });

  it("asks to remove a section with Delete or Backspace, not the profile", () => {
    expect(
      outlineKey(ids, { kind: "component", id: "b" }, key("Delete")),
    ).toEqual({ kind: "remove", id: "b" });
    expect(
      outlineKey(ids, { kind: "component", id: "b" }, key("Backspace")),
    ).toEqual({ kind: "remove", id: "b" });
    expect(outlineKey(ids, { kind: "profile" }, key("Delete"))).toBeNull();
    expect(
      outlineKey(ids, { kind: "component", id: "b" }, key("Enter")),
    ).toBeNull();
  });
});

describe("section moves and selection", () => {
  it("finds the neighbour a move swaps with", () => {
    expect(moveTarget(ids, "a", "up")).toBeUndefined();
    expect(moveTarget(ids, "a", "down")).toBe("b");
    expect(moveTarget(ids, "c", "up")).toBe("b");
    expect(moveTarget(ids, "c", "down")).toBeUndefined();
    expect(moveTarget(ids, "missing", "up")).toBeUndefined();
  });

  it("falls back to the profile when the selected section is gone", () => {
    const draft = completeDraft();
    const [first] = draft.components;
    if (!first) throw new Error("The fixture has sections");
    expect(activeSelection(draft, { kind: "component", id: first.id })).toEqual(
      { kind: "component", id: first.id },
    );
    expect(
      activeSelection(draft, { kind: "component", id: "removed" }),
    ).toEqual({ kind: "profile" });
    expect(activeSelection(null, { kind: "component", id: first.id })).toEqual({
      kind: "profile",
    });
  });
});
