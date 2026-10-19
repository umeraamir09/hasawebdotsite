// biome-ignore-all lint/style/noNonNullAssertion: These fixtures contain the asserted entries.
import { type DraftReadResult, richText } from "@hasaweb/schema";
import { describe, expect, it } from "vitest";
import { completeDraft } from "../../../../packages/schema/src/fixtures.test-support";
import { applySelections, compareRecovery } from "./review";
import type { RecoveryRecord } from "./types";

function fixture() {
  const base: DraftReadResult = {
    portfolioId: "portfolio-a",
    revision: 1,
    draft: completeDraft(),
    progress: { schemaVersion: 1, step: "profile" },
    firstEditorEnteredAt: null,
  };
  const source: RecoveryRecord = {
    version: 1,
    id: "source",
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "setup",
    base,
    working: structuredClone(base.draft),
    progress: structuredClone(base.progress),
    inputs: {},
    batch: null,
    validationJournal: null,
  };
  return { source, current: structuredClone(base), local: source.working! };
}
describe("three-way selected review", () => {
  it("preserves unrelated saved values and exposes both-side changes", () => {
    const { source, local, current } = fixture();
    local.profile.name = "Mine";
    local.profile.bio = "Local bio";
    current.draft.profile.name = "Theirs";
    current.draft.profile.location = "Lahore";
    const items = compareRecovery(source, current);
    expect(items.find((v) => v.path.at(-1) === "name")?.conflicting).toBe(true);
    const result = applySelections(source, current, items, {
      itemIds: items.filter((v) => v.path.at(-1) === "name").map((v) => v.id),
    });
    expect(result.draft.profile).toMatchObject({
      name: "Mine",
      bio: current.draft.profile.bio,
      location: "Lahore",
    });
    expect(source.working?.profile.bio).toBe("Local bio");
  });
  it("matches reordered entries by stable ID and treats links atomically", () => {
    const { source, local, current } = fixture();
    local.links[0]!.label = "Local email";
    current.draft.links.reverse();
    const items = compareRecovery(source, current);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("structure");
    const result = applySelections(source, current, items, {
      itemIds: items.map((v) => v.id),
    });
    expect(result.draft.links[0]?.id).toBe("github-1");
    expect(result.draft.links[1]?.label).toBe("Local email");
  });
  it("retains changed removed entries without recreating them", () => {
    const { source, local, current } = fixture();
    local.links[0]!.label = "Preserve this";
    current.draft.links.shift();
    const items = compareRecovery(source, current);
    expect(items[0]).toMatchObject({ kind: "missing", selectable: false });
    expect(() =>
      applySelections(source, current, items, { itemIds: [items[0]!.id] }),
    ).toThrow();
    expect(
      applySelections(source, current, items, { itemIds: [] }).draft,
    ).toEqual(current.draft);
  });
  it("makes additions, removals and insertion order explicit, preserving new current entries", () => {
    const { source, local, current } = fixture();
    local.links.unshift({ ...local.links[0]!, id: "added", label: "Added" });
    local.links.pop();
    current.draft.links.push({
      ...current.draft.links[0]!,
      id: "remote",
      label: "Remote",
    });
    const items = compareRecovery(source, current);
    expect(items.map((v) => v.kind)).toEqual(["remove", "add", "order"]);
    const result = applySelections(source, current, items, {
      itemIds: items.map((v) => v.id),
    });
    expect(result.draft.links.map((v) => v.id)).toEqual([
      "added",
      "remote",
      "email-1",
    ]);
  });
  it("treats rich text as an explicit structure", () => {
    const { source, local, current } = fixture();
    const component = local.components.find((v) => v.type === "text");
    if (component?.type !== "text") throw new Error("Missing fixture");
    component.data.body = richText("Local rich text");
    const items = compareRecovery(source, current);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("structure");
    expect(
      applySelections(source, current, items, {
        itemIds: items.map((v) => v.id),
      }).draft,
    ).toEqual(local);
  });
  it("never applies setup progress after permanent handoff", () => {
    const { source, local, current } = fixture();
    source.progress = { schemaVersion: 1, step: "links" };
    local.profile.name = "Recovered";
    current.firstEditorEnteredAt = 123;
    current.progress = { schemaVersion: 1, step: "review" };
    const items = compareRecovery(source, current);
    expect(items.find((v) => v.kind === "progress")?.selectable).toBe(false);
    const result = applySelections(source, current, items, {
      itemIds: items.filter((v) => v.selectable).map((v) => v.id),
    });
    expect(result.progress).toEqual(current.progress);
    expect(result.draft.profile.name).toBe("Recovered");
  });
  it("preserves unrelated newer fields inside selected schema-coupled objects", () => {
    const { source, local, current } = fixture();
    local.links[0]!.label = "My label";
    current.draft.links[0]!.value = "newer@example.test";
    local.links[1]!.kind = "website";
    local.links[1]!.value = "https://local.test";
    current.draft.links[1]!.label = "Newer label";
    const work = local.components.find(
      (entry) => entry.type === "work-experience",
    )!;
    const saved = current.draft.components.find(
      (entry) => entry.type === "work-experience",
    )!;
    if (work.type !== "work-experience" || saved.type !== "work-experience")
      throw new Error("Missing work fixture");
    work.data.entries[0]!.startDate = "2023-01";
    saved.data.entries[0]!.description = "Newer description";
    const items = compareRecovery(source, current);
    const result = applySelections(source, current, items, {
      itemIds: items.map((item) => item.id),
    }).draft;
    expect(result.links[0]).toMatchObject({
      label: "My label",
      value: "newer@example.test",
    });
    expect(result.links[1]).toMatchObject({
      label: "Newer label",
      value: "https://local.test",
      kind: "website",
    });
    const merged = result.components.find(
      (entry) => entry.type === "work-experience",
    )!;
    if (merged.type !== "work-experience")
      throw new Error("Missing work fixture");
    expect(merged.data.entries[0]).toMatchObject({
      startDate: "2023-01",
      description: "Newer description",
    });
  });
});
