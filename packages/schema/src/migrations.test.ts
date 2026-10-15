import { describe, expect, it } from "vitest";
import { z } from "zod";
import { completeDraft } from "./fixtures.test-support";
import {
  componentRegistry,
  createDraftReader,
  draftFields,
  draftMigrationContract,
  draftSchema,
  MigrationError,
  type MigrationStep,
  migrateVersioned,
  migrationEnvelopeSchema,
  readDraft,
} from "./index";

describe("migration contracts", () => {
  const oldText = z.strictObject({
    heading: z.string(),
    body: componentRegistry.text.schema.shape.body,
  });
  const textMigration: MigrationStep = {
    inputSchema: oldText,
    migrate: (input) => {
      const data = oldText.parse(input);
      return { title: data.heading, body: data.body };
    },
  };

  it("runs multiple validated component steps without mutating source", () => {
    const v1 = z.strictObject({ text: z.string() });
    const v2 = z.strictObject({ title: z.string() });
    const v3 = z.strictObject({ title: z.string(), description: z.string() });
    const input = { text: "My original content 👋" };
    const output = migrateVersioned(
      input,
      1,
      {
        version: 3,
        schema: v3,
        migrations: {
          1: {
            inputSchema: v1,
            migrate: (value) => ({ title: v1.parse(value).text }),
          },
          2: {
            inputSchema: v2,
            migrate: (value) => ({ ...v2.parse(value), description: "" }),
          },
        },
      },
      "fixture",
    );
    expect(output).toEqual({ title: input.text, description: "" });
    expect(input).toEqual({ text: "My original content 👋" });
  });

  it("migrates a stored envelope and component together then validates the whole draft", () => {
    const original = completeDraft();
    const oldInput = { ...original, legacySeo: original.seo } as Record<
      string,
      unknown
    >;
    delete oldInput.seo;
    oldInput.components = original.components.map((component) =>
      component.type === "text"
        ? {
            ...component,
            data: { heading: component.data.title, body: component.data.body },
          }
        : component,
    );
    const before = JSON.stringify(oldInput);
    const oldEnvelope = z.looseObject({
      schemaVersion: z.literal(1),
      legacySeo: draftFields.seo,
    });
    const textV2 = componentRegistry.text.instanceSchema.extend({
      version: z.literal(2),
    });
    const targetSchema = z.strictObject({
      ...draftFields,
      schemaVersion: z.literal(2),
      components: z.array(
        z.union([
          textV2,
          componentRegistry.projects.instanceSchema,
          componentRegistry.skills.instanceSchema,
          componentRegistry["work-experience"].instanceSchema,
          componentRegistry.github.instanceSchema,
          componentRegistry.contact.instanceSchema,
          componentRegistry["social-links"].instanceSchema,
          componentRegistry.resume.instanceSchema,
        ]),
      ),
    });
    const reader = createDraftReader({
      version: 2,
      envelopeSchema: migrationEnvelopeSchema,
      schema: targetSchema,
      envelopeMigrations: {
        1: {
          inputSchema: oldEnvelope,
          migrate: (input) => {
            const value = oldEnvelope.parse(input);
            const { legacySeo, ...rest } = value;
            return { ...rest, schemaVersion: 2, seo: legacySeo };
          },
        },
      },
      components: {
        ...componentRegistry,
        text: {
          version: 2,
          schema: componentRegistry.text.schema,
          migrations: { 1: textMigration },
        },
      },
    });
    const result = reader(oldInput);
    expect(result).toEqual({
      ...original,
      schemaVersion: 2,
      components: original.components.map((component) =>
        component.type === "text" ? { ...component, version: 2 } : component,
      ),
    });
    expect(JSON.stringify(oldInput)).toBe(before);
    expect(reader(result)).toEqual(result);
  });

  it("upgrades old component data inside an envelope already at its current version", () => {
    const original = completeDraft();
    const input = {
      ...original,
      components: original.components.map((component) =>
        component.type === "text"
          ? {
              ...component,
              data: {
                heading: component.data.title,
                body: component.data.body,
              },
            }
          : component,
      ),
    };
    // A fixture for a future text v2 release. No fictitious production v0 shape.
    const finalSchema = migrationEnvelopeSchema.transform((envelope) =>
      draftSchema.parse({
        ...envelope,
        components: envelope.components.map((component) =>
          component.type === "text" ? { ...component, version: 1 } : component,
        ),
      }),
    );
    const reader = createDraftReader({
      ...draftMigrationContract,
      schema: finalSchema,
      components: {
        ...componentRegistry,
        text: {
          version: 2,
          schema: componentRegistry.text.schema,
          migrations: { 1: textMigration },
        },
      },
    });
    expect(reader(input)).toEqual(original);
  });

  it.each([0, -1, 1.5, 2])(
    "rejects invalid or future stored version %s",
    (schemaVersion) => {
      expect(() => readDraft({ ...completeDraft(), schemaVersion })).toThrow();
    },
  );

  it("rejects unsupported component versions, unknown types and missing migration steps", () => {
    const draft = completeDraft();
    expect(() =>
      readDraft({
        ...draft,
        components: [{ ...draft.components[0], version: 2 }],
      }),
    ).toThrow(MigrationError);
    expect(() =>
      readDraft({
        ...draft,
        components: [{ id: "unknown", type: "toString", version: 1, data: {} }],
      }),
    ).toThrow(MigrationError);
    expect(() =>
      createDraftReader({ ...draftMigrationContract, version: 2 })(draft),
    ).toThrow(MigrationError);
    expect(() =>
      migrateVersioned(
        {},
        1,
        { version: 2, schema: z.object({}), migrations: {} },
        "gap",
      ),
    ).toThrow(MigrationError);
  });

  it("validates source, intermediate and final values and propagates failures safely", () => {
    const input = { text: "Keep my work" };
    const schema = z.strictObject({ text: z.string() });
    const contract = {
      version: 2,
      schema,
      migrations: { 1: { inputSchema: schema, migrate: () => ({ text: 5 }) } },
    };
    expect(() =>
      migrateVersioned(input, 1, contract, "invalid-output"),
    ).toThrow(MigrationError);
    expect(() =>
      migrateVersioned(
        { unexpected: "Do not silently strip" },
        1,
        contract,
        "invalid-input",
      ),
    ).toThrow(MigrationError);
    expect(() =>
      migrateVersioned(
        input,
        1,
        {
          ...contract,
          version: 3,
          migrations: {
            1: contract.migrations[1],
            2: { inputSchema: schema, migrate: (value) => value },
          },
        },
        "invalid-intermediate",
      ),
    ).toThrow(MigrationError);
    expect(input).toEqual({ text: "Keep my work" });
    const mutating = {
      ...contract,
      migrations: {
        1: {
          inputSchema: schema,
          migrate: (value: unknown) => {
            (value as { text: string }).text = "Changed";
            throw new Error("Injected failure");
          },
        },
      },
    };
    expect(() => migrateVersioned(input, 1, mutating, "failure")).toThrow(
      MigrationError,
    );
    expect(input).toEqual({ text: "Keep my work" });
  });

  it("requires an envelope step to increment exactly one version", () => {
    for (const schemaVersion of [1, 3]) {
      const reader = createDraftReader({
        ...draftMigrationContract,
        version: 2,
        envelopeMigrations: {
          1: {
            inputSchema: draftSchema,
            migrate: (value) => ({
              ...draftSchema.parse(value),
              schemaVersion,
            }),
          },
        },
      });
      expect(() => reader(completeDraft())).toThrow(MigrationError);
    }
  });

  it("rejects unsafe migration results and invalid final document relationships", () => {
    const schema = componentRegistry.text.schema;
    expect(() =>
      migrateVersioned(
        { heading: "Safe", body: { type: "doc", content: [] } },
        1,
        {
          version: 2,
          schema,
          migrations: {
            1: {
              inputSchema: oldText,
              migrate: () => ({
                title: "Unsafe",
                body: {
                  type: "doc",
                  content: [{ type: "html", html: "<script>run()</script>" }],
                },
              }),
            },
          },
        },
        "text",
      ),
    ).toThrow(MigrationError);
    const invalid = completeDraft();
    invalid.components.reverse();
    const first = invalid.components[0];
    if (!first) throw new Error("Missing fixture component");
    invalid.components.push({ ...first });
    expect(() => readDraft(invalid)).toThrow();
  });
});
