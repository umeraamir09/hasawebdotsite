import { z } from "zod";
import { draftFields, draftSchema } from "./draft";
import { encodeJson, JSON_MAX_DEPTH } from "./json";

export const SAVE_PIECE_BYTES = 4096;
export const SAVE_MAX_PIECES = 512;
export type DraftPath = (string | number)[];
const root = z.strictObject(draftFields);
type Definition = {
  type: string;
  innerType?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
  getter?: () => z.ZodType;
  shape?: Record<string, z.ZodType>;
  options?: z.ZodType[];
  values?: unknown[];
  element?: z.ZodType;
  items?: z.ZodType[];
  rest?: z.ZodType | null;
  keyType?: z.ZodType;
  valueType?: z.ZodType;
  checks?: {
    _zod: { def: { check: string; minimum?: number; maximum?: number } };
  }[];
};
const definition = (schema: z.ZodType) => schema.def as unknown as Definition;
function unwrap(schema: z.ZodType): z.ZodType {
  const def = definition(schema);
  if (def.type === "optional") return unwrap(def.innerType as z.ZodType);
  if (def.type === "lazy") return unwrap((def.getter as () => z.ZodType)());
  // Content in a checked JSON pipe is validated by its output schema.
  if (def.type === "pipe") return unwrap(def.out as z.ZodType);
  return schema;
}
const pathKeys = new Set<string>();
const seen = new Set<z.ZodType>();
function collectKeys(schema: z.ZodType): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const def = definition(unwrap(schema));
  for (const [key, child] of Object.entries(def.shape ?? {})) {
    pathKeys.add(key);
    collectKeys(child);
  }
  for (const child of def.options ?? []) collectKeys(child);
  for (const child of def.items ?? []) collectKeys(child);
  if (def.element) collectKeys(def.element);
  if (def.rest) collectKeys(def.rest);
}
collectKeys(root);
export function sqlJsonPath(path: DraftPath): string {
  if (path.length > JSON_MAX_DEPTH) throw new Error("Path is too deep");
  return (
    "$" +
    path
      .map((part, index) => {
        if (typeof part === "number") {
          if (!Number.isSafeInteger(part) || part < 0)
            throw new Error("Invalid index");
          if (part > 1_048_576)
            throw new Error("Index cannot fit in a 1 MiB draft");
          return `[${part}]`;
        }
        if (
          !part ||
          part.length > 160 ||
          /["\\]/.test(part) ||
          Array.from(part).some((character) => character.charCodeAt(0) < 32) ||
          ["__proto__", "prototype", "constructor"].includes(part)
        )
          throw new Error("Invalid key");
        if (
          !pathKeys.has(part) &&
          !(
            index === 1 &&
            path[0] === "samples" &&
            path.length === 2 &&
            /^(?:profile\.(?:name|bio|avatar|banner)|components\.[a-zA-Z0-9][a-zA-Z0-9_-]{0,127})$/.test(
              part,
            )
          )
        )
          throw new Error("Unknown draft path key");
        return `.${JSON.stringify(part)}`;
      })
      .join("")
  );
}
export function resolveDraftPath(
  path: DraftPath,
  types: Record<string, unknown>,
): z.ZodType {
  sqlJsonPath(path);
  let schema: z.ZodType = root;
  const prefix: DraftPath = [];
  for (const part of path) {
    schema = unwrap(schema);
    let def = definition(schema);
    if (def.type === "union") {
      const type = types[sqlJsonPath(prefix)];
      const options = (candidate: z.ZodType): z.ZodType[] => {
        const current = unwrap(candidate);
        const def = definition(current);
        return def.type === "union"
          ? (def.options ?? []).flatMap(options)
          : [current];
      };
      const matching = options(schema).find(
        (option) =>
          definition(unwrap(option)).shape?.type &&
          definition(
            definition(unwrap(option)).shape?.type as z.ZodType,
          ).values?.includes(type),
      );
      if (!matching) throw new Error("Unknown stored discriminator");
      schema = unwrap(matching);
      def = definition(schema);
    }
    if (def.type === "object" && typeof part === "string") {
      if (
        prefix[0] === "links" &&
        prefix.length === 2 &&
        ["kind", "value"].includes(part)
      )
        throw new Error(
          "Replace the complete link to validate its kind and value together",
        );
      const next = def.shape?.[part];
      if (!next) throw new Error("Unknown draft field");
      schema = next;
    } else if (def.type === "record" && typeof part === "string") {
      def.keyType?.parse(part);
      schema = def.valueType as z.ZodType;
    } else if (
      (def.type === "array" || def.type === "tuple") &&
      typeof part === "number"
    ) {
      schema = (
        def.type === "array" ? def.element : (def.items?.[part] ?? def.rest)
      ) as z.ZodType;
      if (!schema) throw new Error("Invalid tuple index");
    } else throw new Error("Path does not match the draft contract");
    prefix.push(part);
  }
  return schema;
}
function checkDepth(value: unknown, depth: number): void {
  if (depth > JSON_MAX_DEPTH) throw new Error("JSON nesting exceeds 64 levels");
  if (value && typeof value === "object")
    for (const child of Object.values(value)) checkDepth(child, depth + 1);
}
export function validateDraftValue(
  path: DraftPath,
  types: Record<string, unknown>,
  value: unknown,
): string {
  // Includes room for a maximum-length escaped URL plus its link object.
  const json = encodeJson(value, SAVE_PIECE_BYTES + 1024);
  checkDepth(value, path.length);
  if (!path.length) draftSchema.parse(value);
  else resolveDraftPath(path, types).parse(value);
  return json;
}
export function validateAppend(
  path: DraftPath,
  types: Record<string, unknown>,
  length: number,
  values: unknown[],
): string[] {
  if (!values.length || values.length > 32)
    throw new Error("Append one to 32 entries");
  encodeJson(values, SAVE_PIECE_BYTES);
  const parent = unwrap(resolveDraftPath(path, types));
  const def = definition(parent);
  if (!["array", "tuple"].includes(def.type))
    throw new Error("Append requires an array");
  for (const check of def.checks ?? [])
    if (
      check._zod.def.check === "max_length" &&
      length + values.length > (check._zod.def.maximum ?? Infinity)
    )
      throw new Error("Array is full");
  return values.map((value, index) =>
    validateDraftValue([...path, length + index], types, value),
  );
}
export function validateRemove(
  path: DraftPath,
  types: Record<string, unknown>,
  parentLength: number,
): void {
  if (!path.length) throw new Error("Cannot remove the root");
  const field = resolveDraftPath(path, types);
  const part = path.at(-1);
  if (typeof part === "string") {
    const parent = definition(
      unwrap(resolveDraftPath(path.slice(0, -1), types)),
    );
    if (parent.type !== "record" && definition(field).type !== "optional")
      throw new Error("Required field cannot be removed");
  } else {
    if (typeof part !== "number" || part >= parentLength)
      throw new Error("Missing array entry");
    const parent = definition(
      unwrap(resolveDraftPath(path.slice(0, -1), types)),
    );
    if (
      parent.type === "tuple" &&
      (part < (parent.items?.length ?? 0) ||
        parentLength <= (parent.items?.length ?? 0))
    )
      throw new Error("Required tuple entry cannot be removed");
    for (const check of parent.checks ?? [])
      if (
        check._zod.def.check === "min_length" &&
        parentLength - 1 < (check._zod.def.minimum ?? 0)
      )
        throw new Error("Array needs an entry");
  }
}
export function freeStringMinimum(
  path: DraftPath,
  types: Record<string, unknown>,
): number {
  const def = definition(unwrap(resolveDraftPath(path, types)));
  if (def.type !== "string") throw new Error("Target is not a free text field");
  let minimum = 0;
  for (const check of def.checks ?? []) {
    if (check._zod.def.check !== "min_length")
      throw new Error("Constrained strings must use a validated replacement");
    minimum = Math.max(minimum, check._zod.def.minimum ?? 0);
  }
  return minimum;
}
