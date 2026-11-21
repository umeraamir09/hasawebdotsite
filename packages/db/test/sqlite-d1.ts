// Test-only D1 and R2 stand-ins for Vitest. Never imported by production code.
// The D1 database applies the real migrations to an in-memory SQLite, so
// statements, triggers, CHECK constraints and foreign keys behave as in D1.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

const migrations = fileURLToPath(new URL("../migrations", import.meta.url));

type Meta = { changes: number };
type Result<T> = { results: T[]; meta: Meta; success: true };

export function sqliteD1(): D1Database & { sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(`${migrations}/${file}`, "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  sqlite.exec("PRAGMA foreign_keys=ON");
  const changes = () =>
    Number((sqlite.prepare("SELECT changes() AS n").get() as { n: number }).n);
  function execute<T>(query: string, values: SQLInputValue[]): Result<T> {
    const write =
      /^\s*(insert|update|delete|replace)\b/i.test(query) ||
      /\breturning\b/i.test(query);
    const results = sqlite.prepare(query).all(...values) as T[];
    return {
      results,
      meta: { changes: write ? changes() : 0 },
      success: true,
    };
  }
  function statement(query: string, values: SQLInputValue[] = []) {
    return {
      query,
      values,
      bind: (...next: unknown[]) =>
        statement(
          query,
          next.map((value) => {
            if (value === undefined)
              throw new Error("D1_TYPE_ERROR: undefined binding");
            return typeof value === "boolean"
              ? Number(value)
              : (value as SQLInputValue);
          }),
        ),
      async first<T>(column?: string) {
        const row = execute<Record<string, unknown>>(query, values).results[0];
        if (!row) return null;
        return (column ? row[column] : row) as T;
      },
      async all<T>() {
        return execute<T>(query, values);
      },
      async run<T>() {
        return execute<T>(query, values);
      },
      async raw() {
        return execute<Record<string, unknown>>(query, values).results.map(
          (row) => Object.values(row),
        );
      },
    };
  }
  type Statement = ReturnType<typeof statement>;
  const db = {
    sqlite,
    prepare: (query: string) => statement(query),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((item) =>
          execute(item.query, item.values),
        );
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
  };
  return db as unknown as D1Database & { sqlite: DatabaseSync };
}

/** A Map-backed R2 bucket with the operations the Workers here use. */
export function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const encode = (value: unknown) =>
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value as ArrayBuffer);
  const object = (key: string) => {
    const bytes = objects.get(key);
    return bytes
      ? {
          key,
          size: bytes.byteLength,
          body: new Blob([bytes]).stream(),
          text: async () => new TextDecoder().decode(bytes),
        }
      : null;
  };
  const bucket = {
    objects,
    async put(key: string, value: unknown) {
      objects.set(key, encode(value));
      return object(key);
    },
    async get(key: string) {
      return object(key);
    },
    async head(key: string) {
      return object(key);
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys])
        objects.delete(key);
    },
    async list(options: { prefix?: string; limit?: number } = {}) {
      const keys = [...objects.keys()]
        .filter((key) => key.startsWith(options.prefix ?? ""))
        .sort();
      const page = keys.slice(0, options.limit ?? 1000);
      return {
        objects: page.map((key) => ({
          key,
          size: objects.get(key)?.byteLength ?? 0,
        })),
        truncated: page.length < keys.length,
        delimitedPrefixes: [],
      };
    },
  };
  return bucket as unknown as R2Bucket & { objects: Map<string, Uint8Array> };
}
