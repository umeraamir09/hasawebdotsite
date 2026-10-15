import { describe, expect, it } from "vitest";
import { z } from "zod";
import { completeDraft, definitions } from "./fixtures.test-support";
import {
  clearSample,
  collectDraftAssetReferences,
  componentRegistry,
  componentSampleKey,
  createComponent,
  createEmptyDraft,
  DRAFT_MAX_BYTES,
  DRAFT_SCHEMA_VERSION,
  draftSchema,
  isUntouchedSample,
  markSample,
  profileDefinition,
  profileSampleKey,
  readDraft,
} from "./index";

describe("draft round trips and registry", () => {
  it("retains the complete MVP data, order and Unicode through JSON and reads", () => {
    const draft = completeDraft();
    const stored = JSON.parse(JSON.stringify(draft));
    expect(draftSchema.parse(stored)).toEqual(draft);
    const read = readDraft(stored);
    expect(read).toEqual(draft);
    expect(read).not.toBe(stored);
    read.profile.name = "Changed";
    expect(stored.profile.name).toBe(draft.profile.name);
  });

  it("permits missing publication requirements and unfinished component setup", () => {
    const draft = createEmptyDraft({
      themeId: "unapproved-theme-id",
      fontId: "unapproved-font-id",
      colorMode: "light",
    });
    draft.profile.faceReveal.enabled = true;
    draft.links.push({
      id: "unfinished-link",
      label: "",
      kind: "email",
      value: "",
      showInProfile: true,
      showInSocialComponent: false,
    });
    draft.components = definitions.map((definition) =>
      createComponent(definition.type, definition.type),
    );
    expect(draftSchema.parse(draft)).toEqual(draft);
  });

  it("declares the complete optional MVP list and one versioned fixed profile", () => {
    expect(Object.keys(componentRegistry)).toEqual([
      "projects",
      "skills",
      "work-experience",
      "text",
      "github",
      "contact",
      "social-links",
      "resume",
    ]);
    expect(DRAFT_SCHEMA_VERSION).toBe(1);
    expect(profileDefinition.fixed).toBe(true);
    expect(profileDefinition.singleton).toBe(true);
    expect(
      profileDefinition.schema.parse(profileDefinition.defaults()),
    ).toEqual(profileDefinition.defaults());
  });

  it.each(definitions)(
    "validates fresh defaults and samples for $type",
    (definition) => {
      expect(definition.schema.parse(definition.defaults())).toEqual(
        definition.defaults(),
      );
      expect(definition.schema.parse(definition.sample())).toEqual(
        definition.sample(),
      );
      expect(definition.picker.requirements.length).toBeGreaterThan(0);
      expect(definition.version).toBe(1);
      expect(definition.migrations).toEqual({});
    },
  );

  it.each(definitions.filter((definition) => definition.singleton))(
    "rejects a second $type instance",
    (definition) => {
      const draft = completeDraft();
      draft.components.push(
        createComponent(definition.type, "duplicate-instance"),
      );
      const result = draftSchema.safeParse(draft);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(
          result.error.issues.some(
            (issue) => issue.path.join(".") === "components.9.type",
          ),
        ).toBe(true);
    },
  );

  it.each(["profile", "education", "stickers", "unknown"])(
    "rejects unregistered or fixed component %s",
    (type) => {
      const draft = completeDraft();
      expect(
        draftSchema.safeParse({
          ...draft,
          components: [{ id: "bad", type, version: 1, data: {} }],
        }).success,
      ).toBe(false);
    },
  );

  it.each([0, -1, 1.5, 2, "1"])(
    "rejects unsupported envelope/component version %s",
    (version) => {
      const draft = completeDraft();
      expect(
        draftSchema.safeParse({ ...draft, schemaVersion: version }).success,
      ).toBe(false);
      expect(
        draftSchema.safeParse({
          ...draft,
          components: [{ ...draft.components[0], version }],
        }).success,
      ).toBe(false);
    },
  );

  it("allows multiple text sections but rejects duplicate component or link IDs", () => {
    const draft = completeDraft();
    expect(draftSchema.safeParse(draft).success).toBe(true);
    draft.components.push(createComponent("text", "text-1"));
    expect(draftSchema.safeParse(draft).success).toBe(false);
    draft.components.pop();
    const firstLink = draft.links[0];
    if (!firstLink) throw new Error("Missing fixture link");
    draft.links.push({ ...firstLink });
    expect(draftSchema.safeParse(draft).success).toBe(false);
  });

  it.each([
    "hidden",
    "html",
    "css",
    "layout",
    "templateId",
    "subdomain",
    "ownerId",
  ])("rejects an undeclared envelope field %s", (field) => {
    expect(
      draftSchema.safeParse({ ...completeDraft(), [field]: "unexpected" })
        .success,
    ).toBe(false);
  });

  it("does not silently strip unsafe extra profile, component, link or appearance fields", () => {
    const draft = completeDraft();
    expect(
      draftSchema.safeParse({
        ...draft,
        profile: { ...draft.profile, html: "<script>run()</script>" },
      }).success,
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...draft,
        components: [{ ...createComponent("text", "text"), hidden: true }],
      }).success,
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...draft,
        links: [{ ...draft.links[0], onclick: "run()" }],
      }).success,
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...draft,
        appearance: { ...draft.appearance, colors: { text: "red" } },
      }).success,
    ).toBe(false);
  });

  it.each([
    "red",
    "#123",
    "#12345678",
    "var(--unsafe)",
    "url(javascript:run())",
  ])("rejects non-seed custom color %s", (customColor) => {
    const draft = completeDraft();
    expect(
      draftSchema.safeParse({
        ...draft,
        appearance: { ...draft.appearance, customColor },
      }).success,
    ).toBe(false);
  });
});

describe("entry structure", () => {
  it("rejects duplicate project IDs and slugs", () => {
    const schema = componentRegistry.projects.schema;
    const component = completeDraft().components.find(
      (entry) => entry.type === "projects",
    );
    const project = component?.data.entries[0];
    if (!project) throw new Error("Missing fixture project");
    expect(schema.safeParse({ entries: [project, project] }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ entries: [project, { ...project, id: "project-2" }] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        entries: [
          project,
          {
            ...project,
            id: "project-2",
            caseStudy: { ...project.caseStudy, slug: "different" },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects dangling categories and duplicate skill/category IDs", () => {
    const schema = componentRegistry.skills.schema;
    expect(
      schema.safeParse({
        categories: [],
        entries: [{ id: "ts", name: "TypeScript", categoryId: "missing" }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        categories: [
          { id: "a", name: "A" },
          { id: "a", name: "B" },
        ],
        entries: [],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        categories: [],
        entries: [
          { id: "ts", name: "TypeScript" },
          { id: "ts", name: "Duplicate" },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        categories: [],
        entries: [{ id: "ts", name: "TypeScript", proficiency: 100 }],
      }).success,
    ).toBe(false);
  });

  it("validates work dates with field paths and permits incomplete and ongoing entries", () => {
    const schema = componentRegistry["work-experience"].schema;
    const entry = {
      id: "work",
      role: "",
      organization: "",
      startDate: "2024-01",
      current: true,
      description: "",
    };
    expect(schema.safeParse({ entries: [entry] }).success).toBe(true);
    expect(
      schema.safeParse({
        entries: [{ ...entry, current: false, startDate: "", endDate: "" }],
      }).success,
    ).toBe(true);
    const result = schema.safeParse({
      entries: [{ ...entry, current: false, endDate: "2023-12" }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(["entries", 0, "endDate"]);
    expect(schema.safeParse({ entries: [entry, entry] }).success).toBe(false);
    for (const startDate of ["2024-00", "2024-13", "2024-2", "yesterday"])
      expect(
        schema.safeParse({ entries: [{ ...entry, startDate }] }).success,
      ).toBe(false);
  });

  it("keeps credentials, fetched data and private recipient details out of component contracts", () => {
    expect(
      componentRegistry.github.schema.safeParse({
        username: "example",
        includePrivate: true,
        token: "secret",
      }).success,
    ).toBe(false);
    expect(
      componentRegistry.github.schema.safeParse({
        username: "example",
        includePrivate: true,
        privateRepositories: ["private"],
      }).success,
    ).toBe(false);
    expect(
      componentRegistry.contact.schema.safeParse({
        recipientEmail: "private@example.test",
        verified: true,
      }).success,
    ).toBe(false);
    expect(
      componentRegistry["social-links"].schema.safeParse({ links: [] }).success,
    ).toBe(false);
  });
});

describe("sample identity and asset references", () => {
  it("marks fields/components by stable IDs and clears edits without mutating input", () => {
    const original = completeDraft();
    const marked = markSample(
      markSample(original, profileSampleKey("avatar")),
      componentSampleKey("projects-1"),
    );
    marked.components.reverse();
    expect(draftSchema.parse(marked)).toEqual(marked);
    expect(isUntouchedSample(marked, "components.projects-1")).toBe(true);
    const edited = clearSample(marked, "components.projects-1");
    expect(isUntouchedSample(edited, "components.projects-1")).toBe(false);
    expect(isUntouchedSample(marked, "components.projects-1")).toBe(true);
    expect(original.samples).toEqual({ "components.text-2": true });
    expect(edited.profile.avatar?.accepted).toBe(true);
  });

  it.each([
    "profile.unknown",
    "components.missing",
    "components.0",
    "__proto__",
  ])("rejects stale or unknown sample marker %s", (key) => {
    expect(() => markSample(completeDraft(), key)).toThrow(z.ZodError);
  });

  it("rejects markers targeting removed profile images and false markers", () => {
    const draft = completeDraft();
    delete draft.profile.avatar;
    expect(() => markSample(draft, "profile.avatar")).toThrow();
    expect(
      draftSchema.safeParse({ ...draft, samples: { "profile.name": false } })
        .success,
    ).toBe(false);
  });

  it("collects each image/PDF purpose and actual field path, including retained private photos", () => {
    const draft = draftSchema.parse(completeDraft());
    const references = collectDraftAssetReferences(draft);
    expect(references.map(({ assetId, kind }) => [assetId, kind])).toEqual([
      ["avatar-1", "avatar"],
      ["banner-1", "banner"],
      ["face-1", "face"],
      ["sharing-image", "og"],
      ["project-image", "project"],
      ["case-image", "case_study"],
      ["resume-pdf", "resume"],
    ]);
    for (const reference of references) {
      let value: unknown = draft;
      for (const key of reference.path)
        value = (value as Record<string | number, unknown>)[key];
      expect(value).toBe(reference.assetId);
    }
    draft.components.reverse();
    expect(
      collectDraftAssetReferences(draft).find(
        (reference) => reference.kind === "resume",
      )?.path,
    ).toEqual(["components", 0, "data", "file", "assetId"]);
  });

  it.each([
    "../avatar",
    "/private/avatar",
    "https://assets.example/avatar",
    "data:image/png;base64,a",
    "a.b",
  ])("rejects asset path or URL %s", (assetId) => {
    const draft = completeDraft();
    expect(
      draftSchema.safeParse({
        ...draft,
        profile: { ...draft.profile, banner: { assetId } },
      }).success,
    ).toBe(false);
  });

  it("rejects inline upload metadata and preserves explicit avatar acceptance", () => {
    const draft = completeDraft();
    expect(
      draftSchema.safeParse({
        ...draft,
        profile: {
          ...draft.profile,
          avatar: { assetId: "avatar", accepted: false },
        },
      }).success,
    ).toBe(true);
    expect(
      draftSchema.safeParse({
        ...draft,
        profile: { ...draft.profile, avatar: { assetId: "avatar" } },
      }).success,
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...draft,
        profile: {
          ...draft.profile,
          banner: { assetId: "banner", bytes: "base64" },
        },
      }).success,
    ).toBe(false);
  });
});

describe("bounded JSON input", () => {
  it("rejects prototype keys instead of silently dropping them", () => {
    for (const key of ["__proto__", "prototype", "constructor"]) {
      const draft = completeDraft();
      expect(
        draftSchema.safeParse({ ...draft, samples: { [key]: true } }).success,
      ).toBe(false);
      expect(() => readDraft({ ...draft, [key]: "unsafe" })).toThrow();
    }
  });

  it("rejects arrays with holes or extra keys and objects with hidden data/accessors", () => {
    const hole = new Array(2);
    const extended = [1] as unknown[] & { extra?: number };
    extended.extra = 2;
    const hidden = Object.defineProperty({}, "hidden", { value: "lost" });
    let accessed = false;
    const getter = {
      get unsafe() {
        accessed = true;
        return "unexpected";
      },
    };
    for (const extra of [
      hole,
      extended,
      hidden,
      getter,
      { [Symbol("private")]: 1 },
    ])
      expect(draftSchema.safeParse({ ...completeDraft(), extra }).success).toBe(
        false,
      );
    expect(accessed).toBe(false);
  });

  it("accepts exactly 1 MiB and rejects one UTF-8 byte more", () => {
    const draft = completeDraft();
    const baseBytes = new TextEncoder().encode(
      JSON.stringify(draft),
    ).byteLength;
    draft.profile.bio += "x".repeat(DRAFT_MAX_BYTES - baseBytes);
    expect(new TextEncoder().encode(JSON.stringify(draft)).byteLength).toBe(
      DRAFT_MAX_BYTES,
    );
    expect(draftSchema.safeParse(draft).success).toBe(true);
    draft.profile.bio += "x";
    expect(draftSchema.safeParse(draft).success).toBe(false);
    draft.profile.bio = "界".repeat(Math.floor(DRAFT_MAX_BYTES / 3));
    expect(draft.profile.bio.length).toBeLessThan(DRAFT_MAX_BYTES);
    expect(draftSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects deep and cyclic payloads safely before recursive validation", () => {
    const draft = completeDraft();
    const deep: Record<string, unknown> = {};
    let child = deep;
    for (let index = 0; index < 10000; index++) {
      child.next = {};
      child = child.next as Record<string, unknown>;
    }
    expect(draftSchema.safeParse(deep).success).toBe(false);
    expect(
      draftSchema.safeParse({ ...draft, cycle: draft, self: deep }).success,
    ).toBe(false);
    const cyclic = { ...draft, cycle: {} };
    cyclic.cycle = cyclic;
    expect(draftSchema.safeParse(cyclic).success).toBe(false);
  });

  it.each([undefined, Number.NaN, Infinity, 1n, () => 1, new Date()])(
    "rejects values JSON would drop or change: %s",
    (value) => {
      expect(
        draftSchema.safeParse({ ...completeDraft(), extra: value }).success,
      ).toBe(false);
    },
  );
});
