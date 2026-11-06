import type { DraftDoc } from "@hasaweb/schema";
import {
  createComponent,
  createEmptyDraft,
  draftSchema,
  SAVE_CHANGE_BYTES,
  SAVE_PIECE_BYTES,
  validateAppend,
  validateDraftValue,
} from "@hasaweb/schema";
import { describe, expect, it } from "vitest";
import { completeDraft } from "../../../../packages/schema/src/fixtures.test-support";
import {
  applyChange,
  bytes,
  equal,
  planChanges,
  resolveField,
  stringPieces,
} from "./planner";

const empty = () =>
  createEmptyDraft({ themeId: "leaf", fontId: "dm-sans", colorMode: "system" });
function types(
  value: unknown,
  path = "$",
  result: Record<string, unknown> = {},
) {
  if (value && typeof value === "object") {
    if ("type" in value) result[path] = value.type;
    for (const [key, child] of Object.entries(value))
      types(
        child,
        Array.isArray(value)
          ? `${path}[${key}]`
          : `${path}.${JSON.stringify(key)}`,
        result,
      );
  }
  return result;
}
export function simulate(from: DraftDoc, target: DraftDoc) {
  let working = structuredClone(from),
    text = "",
    path: (string | number)[] = [];
  const commands = planChanges(from, target);
  for (const command of commands) {
    if (command.action === "change") {
      expect(bytes(command.change)).toBeLessThanOrEqual(SAVE_CHANGE_BYTES);
      if (command.change.op === "set")
        validateDraftValue(
          command.change.path,
          types(working),
          command.change.value,
        );
      if (command.change.op === "append") {
        expect(bytes(command.change.values)).toBeLessThanOrEqual(
          SAVE_PIECE_BYTES,
        );
        const node = command.change.path.reduce<unknown>(
          (node, key) => (node as Record<string | number, unknown>)[key],
          working,
        );
        validateAppend(
          command.change.path,
          types(working),
          (node as unknown[]).length,
          command.change.values,
        );
      }
      working = applyChange(working, command.change);
      draftSchema.parse(working);
    } else if (command.action === "string-start") {
      path = command.path;
      text = "";
    } else if (command.action === "piece") {
      expect(bytes(command.text)).toBeLessThanOrEqual(SAVE_PIECE_BYTES);
      text += command.text;
    } else {
      working = applyChange(working, { op: "set", path, value: text });
      draftSchema.parse(working);
    }
  }
  expect(working).toEqual(target);
  return commands;
}
describe("bounded browser save planner", () => {
  it("orders category/reference changes and keeps every intermediate valid", () => {
    const from = completeDraft();
    const skills = from.components.find((entry) => entry.type === "skills");
    if (skills?.type !== "skills") throw new Error("Missing skills fixture");
    skills.data = {
      categories: [{ id: "old", name: "Old" }],
      entries: [{ id: "skill", name: "TypeScript", categoryId: "old" }],
    };
    const target = structuredClone(from);
    const replacement = target.components.find(
      (entry) => entry.type === "skills",
    );
    if (replacement?.type !== "skills")
      throw new Error("Missing skills target");
    replacement.data = {
      categories: [{ id: "new", name: "New".repeat(3000) }],
      entries: [{ id: "skill", name: "TypeScript", categoryId: "new" }],
    };
    simulate(from, target);
  });
  it("changes one project field without restaging its unchanged large case study", () => {
    const from = completeDraft();
    const projects = from.components.find((entry) => entry.type === "projects");
    if (projects?.type !== "projects" || !projects.data.entries[0]?.caseStudy)
      throw new Error("Missing project fixture");
    projects.data.entries[0].caseStudy.body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "body".repeat(5000) }],
        },
      ],
    };
    const target = structuredClone(from);
    const replacement = target.components.find(
      (entry) => entry.type === "projects",
    );
    if (replacement?.type !== "projects" || !replacement.data.entries[0])
      throw new Error("Missing project target");
    replacement.data.entries[0].title = "Changed title";
    expect(simulate(from, target)).toHaveLength(1);
  });
  it("saves a regenerated slug as a field change without restaging the body", () => {
    const from = completeDraft();
    const projects = from.components.find((entry) => entry.type === "projects");
    const entry =
      projects?.type === "projects" ? projects.data.entries[0] : undefined;
    if (!entry?.caseStudy) throw new Error("Missing project fixture");
    entry.caseStudy.body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "body".repeat(5000) }],
        },
      ],
    };
    const target = structuredClone(from);
    const replacement = target.components.find(
      (item) => item.type === "projects",
    );
    const changed =
      replacement?.type === "projects"
        ? replacement.data.entries[0]
        : undefined;
    if (!changed?.caseStudy) throw new Error("Missing target");
    changed.title = "Renamed";
    changed.caseStudy.slug = "renamed";
    const commands = simulate(from, target);
    expect(commands).toHaveLength(2);
    expect(commands.every((command) => command.action === "change")).toBe(true);
  });
  it("keeps every intermediate valid when two case-study slugs swap", () => {
    const from = completeDraft();
    const projects = from.components.find((entry) => entry.type === "projects");
    if (projects?.type !== "projects" || !projects.data.entries[0]?.caseStudy)
      throw new Error("Missing project fixture");
    projects.data.entries.push({
      ...structuredClone(projects.data.entries[0]),
      id: "second-project",
      caseStudy: { slug: "second", body: { type: "doc", content: [] } },
    });
    const target = structuredClone(from);
    const swapped = target.components.find(
      (entry) => entry.type === "projects",
    );
    if (swapped?.type !== "projects") throw new Error("Missing target");
    const [first, second] = swapped.data.entries;
    if (!first?.caseStudy || !second?.caseStudy) throw new Error("Missing");
    [first.caseStudy.slug, second.caseStudy.slug] = [
      second.caseStudy.slug,
      first.caseStudy.slug,
    ];
    simulate(from, target);
  });
  it("emits no commands for unchanged data and one leaf change for ordinary edits", () => {
    const from = empty(),
      target = structuredClone(from);
    expect(planChanges(from, target)).toEqual([]);
    target.profile.name = "Ada";
    expect(simulate(from, target)).toEqual([
      {
        action: "change",
        change: { op: "set", path: ["profile", "name"], value: "Ada" },
      },
    ]);
  });
  it("replaces links atomically and resolves stable IDs after reordering", () => {
    const from = completeDraft(),
      target = structuredClone(from);
    target.links[0] = {
      id: "email",
      kind: "email",
      value: "owner@example.test",
      label: "Mail",
      showInProfile: true,
      showInSocialComponent: false,
    };
    simulate(from, target);
    expect(resolveField(target, ["links", { id: "email" }, "label"])).toEqual([
      "links",
      0,
      "label",
    ]);
    expect(() => resolveField(target, ["links", { id: "missing" }])).toThrow();
  });
  it("packs escaped Unicode and lone surrogates exactly without splitting pairs", () => {
    for (const value of [
      "😀".repeat(5000),
      '"\\\n\u0000'.repeat(3000),
      "\ud800x".repeat(3000),
    ]) {
      const pieces = stringPieces(value);
      expect(pieces.join("")).toBe(value);
      for (const piece of pieces)
        expect(bytes(piece)).toBeLessThanOrEqual(4096);
      const from = empty(),
        target = structuredClone(from);
      target.profile.bio = value;
      simulate(from, target);
    }
  });
  it("handles all components and large nested rich text with valid intermediates", () => {
    const from = empty(),
      target = completeDraft();
    target.profile.bio = "b".repeat(18000);
    target.components.push(createComponent("text", "extra-text"));
    const text = target.components.find((entry) => entry.type === "text");
    if (text?.type === "text")
      text.data.body = {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "deep".repeat(5000) }],
                  },
                ],
              },
            ],
          },
        ],
      };
    simulate(from, target);
    simulate(target, from);
  });
  it("does not rebuild a large collection for a changed leaf", () => {
    const from = empty();
    from.components = Array.from({ length: 80 }, (_, i) => ({
      ...createComponent("text", `text-${i}`),
      data: { title: "a", body: { type: "doc" as const, content: [] } },
    }));
    const target = structuredClone(from);
    const entry = target.components[40];
    if (entry?.type === "text") entry.data.title = "changed";
    const commands = simulate(from, target);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      change: { path: ["components", 40, "data", "title"] },
    });
  });
  it("rebuilds large reordered arrays and restores compatible samples", () => {
    const from = empty();
    from.components = Array.from({ length: 40 }, (_, i) =>
      createComponent("text", `text-${i}`),
    );
    from.samples = { "components.text-0": true };
    const target = structuredClone(from);
    target.components.reverse();
    simulate(from, target);
    const removed = structuredClone(target);
    removed.components = [];
    removed.samples = {};
    simulate(target, removed);
  });
  it("rejects over-limit targets instead of truncating", () => {
    const target = empty();
    target.profile.bio = "a".repeat(1048576);
    expect(() => planChanges(empty(), target)).toThrow();
    expect(equal(target, empty())).toBe(false);
  });
});
