import type { z } from "zod";
import { assertJson, cloneJson } from "./json";

export interface MigrationStep {
  inputSchema: z.ZodType;
  migrate: (input: unknown) => unknown;
}
export interface VersionContract<T = unknown> {
  version: number;
  schema: z.ZodType<T>;
  // Key n migrates version n to n + 1. No skipping or implicit downgrades.
  migrations: Readonly<Record<number, MigrationStep>>;
}

export class MigrationError extends Error {
  constructor(
    readonly scope: string,
    readonly version: number,
    cause: unknown,
  ) {
    super(`Cannot migrate ${scope} at version ${version}`, { cause });
    this.name = "MigrationError";
  }
}

export function migrateVersioned<T>(
  input: unknown,
  fromVersion: number,
  contract: VersionContract<T>,
  scope: string,
): T {
  let version = fromVersion;
  try {
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !Number.isSafeInteger(contract.version) ||
      contract.version < version
    )
      throw new Error("Unsupported version");
    let value: unknown = cloneJson(input);
    while (version < contract.version) {
      if (!Object.hasOwn(contract.migrations, version))
        throw new Error("Missing migration step");
      const step = contract.migrations[version];
      if (!step) throw new Error("Missing migration step");
      value = step.migrate(step.inputSchema.parse(value));
      assertJson(value);
      version++;
    }
    return contract.schema.parse(value);
  } catch (cause) {
    throw new MigrationError(scope, version, cause);
  }
}
