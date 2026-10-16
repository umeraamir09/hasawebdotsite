import { z } from "zod";
import {
  DRAFT_SCHEMA_VERSION,
  type DraftDoc,
  draftSchema,
  legacyDraftEnvelopeSchema,
  migrationEnvelopeSchema,
} from "./draft";
import { assertJson, cloneJson } from "./json";
import {
  MigrationError,
  type MigrationStep,
  migrateVersioned,
  type VersionContract,
} from "./migration-contract";
import { componentRegistry } from "./registry";

export interface DraftMigrationContract<T> {
  version: number;
  envelopeSchema: z.ZodType<z.infer<typeof migrationEnvelopeSchema>>;
  envelopeMigrations: Readonly<Record<number, MigrationStep>>;
  components: Readonly<Record<string, VersionContract>>;
  schema: z.ZodType<T>;
}
export const draftMigrationContract: DraftMigrationContract<DraftDoc> = {
  version: DRAFT_SCHEMA_VERSION,
  envelopeSchema: migrationEnvelopeSchema,
  envelopeMigrations: {
    1: {
      inputSchema: legacyDraftEnvelopeSchema,
      // Optional candidate means a max-size legacy document does not grow.
      migrate: (input) => ({
        ...legacyDraftEnvelopeSchema.parse(input),
        schemaVersion: 2,
      }),
    },
  },
  components: componentRegistry,
  schema: draftSchema,
};

export function createDraftReader<T>(contract: DraftMigrationContract<T>) {
  if (!Number.isSafeInteger(contract.version) || contract.version < 1)
    throw new Error("Invalid draft contract version");
  return (input: unknown): T => {
    // Clone first so callbacks never receive any references owned by the caller.
    let value = cloneJson(input);
    let version = z
      .object({ schemaVersion: z.number().int().positive() })
      .parse(value).schemaVersion;
    if (version > contract.version)
      throw new MigrationError(
        "draft",
        version,
        new Error("Unsupported future draft"),
      );
    while (version < contract.version) {
      const step = Object.hasOwn(contract.envelopeMigrations, version)
        ? contract.envelopeMigrations[version]
        : undefined;
      if (!step)
        throw new MigrationError(
          "draft",
          version,
          new Error("Missing envelope migration"),
        );
      try {
        value = step.migrate(step.inputSchema.parse(value));
        assertJson(value);
        const nextVersion = z
          .object({ schemaVersion: z.literal(version + 1) })
          .parse(value).schemaVersion;
        version = nextVersion;
      } catch (cause) {
        throw new MigrationError("draft", version, cause);
      }
    }
    const envelope = contract.envelopeSchema.parse(value);
    if (envelope.schemaVersion !== contract.version)
      throw new MigrationError(
        "draft",
        version,
        new Error("Wrong envelope version"),
      );
    envelope.components = envelope.components.map((component) => {
      const definition = Object.hasOwn(contract.components, component.type)
        ? contract.components[component.type]
        : undefined;
      if (!definition)
        throw new MigrationError(
          component.type,
          component.version,
          new Error("Unknown component"),
        );
      return {
        ...component,
        version: definition.version,
        data: migrateVersioned(
          component.data,
          component.version,
          definition,
          component.type,
        ),
      };
    });
    return contract.schema.parse(envelope);
  };
}

// Read upgrades in memory. The persistence layer writes back only on next save.
export const readDraft = createDraftReader(draftMigrationContract);
