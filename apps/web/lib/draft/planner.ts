import {
  type DraftDoc,
  type DraftPath,
  draftSchema,
  encodeJson,
  inspectionFreeText,
  inspectionSchema,
  SAVE_CHANGE_BYTES,
  SAVE_MAX_PIECES,
  SAVE_PIECE_BYTES,
  schemaDefinition,
  sqlJsonPath,
  unwrapSchema,
  validateDraftValue,
} from "@hasaweb/schema";
import type { Batch, Change, FieldPath, PlannedCommand } from "./types";

export function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        equal(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    )
  );
}
export const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function getAt(
  value: unknown,
  path: readonly (string | number)[],
): unknown {
  let node = value;
  for (const part of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[part];
  }
  return node;
}
export function resolveField(draft: DraftDoc, field: FieldPath): DraftPath {
  const path: DraftPath = [];
  for (const part of field) {
    if (typeof part === "object") {
      const array = getAt(draft, path);
      if (!Array.isArray(array))
        throw new Error("Entry container no longer exists");
      const index = array.findIndex((entry) => entry?.id === part.id);
      if (index < 0) throw new Error("Entry no longer exists");
      path.push(index);
    } else path.push(part);
  }
  sqlJsonPath(path);
  return path;
}
export function applyChange<T>(input: T, change: Change): T {
  sqlJsonPath(change.path);
  if (!change.path.length) {
    if (change.op !== "set") throw new Error("Invalid root operation");
    return structuredClone(change.value) as T;
  }
  const result = structuredClone(input);
  const parent = getAt(result, change.path.slice(0, -1)) as Record<
    string | number,
    unknown
  >;
  if (!parent || typeof parent !== "object") throw new Error("Missing parent");
  const key = change.path.at(-1) as string | number;
  if (change.op === "set") parent[key] = structuredClone(change.value);
  else if (change.op === "append") {
    const array = parent[key];
    if (!Array.isArray(array)) throw new Error("Append requires an array");
    array.push(...structuredClone(change.values));
  } else if (Array.isArray(parent) && typeof key === "number")
    parent.splice(key, 1);
  else delete parent[key];
  return result;
}
function discriminators(
  value: unknown,
  path: DraftPath = [],
  result: Record<string, unknown> = {},
) {
  if (value && typeof value === "object") {
    if ("type" in value) result[sqlJsonPath(path)] = value.type;
    for (const [key, child] of Object.entries(value))
      discriminators(
        child,
        [...path, Array.isArray(value) ? Number(key) : key],
        result,
      );
  }
  return result;
}
export function stringPieces(value: string): string[] {
  const result: string[] = [];
  let part = "",
    size = 2;
  for (const character of value) {
    const encoded = bytes(character) - 2;
    if (size + encoded > SAVE_PIECE_BYTES) {
      result.push(part);
      part = "";
      size = 2;
    }
    part += character;
    size += encoded;
  }
  if (part) result.push(part);
  if (result.length > SAVE_MAX_PIECES)
    throw new Error("Too many string pieces");
  return result;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Plan only changed subtrees. Large arrays rebuild in staging using valid
 * skeletons. Canonical content never sees their temporary empty containers.
 */
export function planChanges(
  from: DraftDoc,
  target: DraftDoc,
): PlannedCommand[] {
  draftSchema.parse(target);
  let working = structuredClone(from);
  const commands: PlannedCommand[] = [];
  const targetTypes = discriminators(target);
  function emit(change: Change) {
    encodeJson(change, SAVE_CHANGE_BYTES);
    const types = discriminators(working);
    if (change.op === "set")
      validateDraftValue(change.path, types, change.value);
    if (change.op === "append") encodeJson(change.values, SAVE_PIECE_BYTES);
    working = applyChange(working, change);
    commands.push({ action: "change", change });
  }
  function fits(path: DraftPath, value: unknown) {
    try {
      encodeJson({ op: "set", path, value }, SAVE_CHANGE_BYTES);
      validateDraftValue(path, targetTypes, value);
      return true;
    } catch {
      return false;
    }
  }
  function skeleton(value: unknown, path: DraftPath): unknown {
    if (fits(path, value)) return value;
    const schema = inspectionSchema(path, targetTypes);
    const def = schemaDefinition(unwrapSchema(schema));
    if (typeof value === "string" && inspectionFreeText(schema))
      return value ? Array.from(value)[0] : "";
    if (Array.isArray(value)) {
      const minimum =
        def.type === "tuple"
          ? (def.items?.length ?? 0)
          : Math.max(
              0,
              ...(def.checks ?? [])
                .filter((v) => v._zod.def.check === "min_length")
                .map((v) => v._zod.def.minimum ?? 0),
            );
      return value
        .slice(0, minimum)
        .map((entry, i) => skeleton(entry, [...path, i]));
    }
    if (object(value)) {
      if (def.type === "record") return {};
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          skeleton(child, [...path, key]),
        ]),
      );
    }
    throw new Error("Cannot decompose this replacement within the save limits");
  }
  function rebuildArray(path: DraftPath, value: unknown[]) {
    const seed = skeleton(value, path) as unknown[];
    emit({ op: "set", path, value: seed });
    seed.forEach((_, index) => {
      visit([...path, index], value[index]);
    });
    let index = seed.length;
    while (index < value.length) {
      const start = index,
        values: unknown[] = [];
      while (index < value.length && values.length < 32) {
        const next = skeleton(value[index], [...path, index]);
        const change: Change = {
          op: "append",
          path,
          values: [...values, next],
        };
        if (
          values.length &&
          (bytes(change.values) > SAVE_PIECE_BYTES ||
            bytes(change) > SAVE_CHANGE_BYTES)
        )
          break;
        encodeJson(change.values, SAVE_PIECE_BYTES);
        encodeJson(change, SAVE_CHANGE_BYTES);
        values.push(next);
        index++;
      }
      emit({ op: "append", path, values });
      values.forEach((_, offset) => {
        visit([...path, start + offset], value[start + offset]);
      });
    }
  }
  // Case-study slugs are unique. Field-level slug changes are safe in any
  // order unless a new slug takes another entry's previous slug, as in a swap.
  function slugSwap(old: unknown[], value: unknown[]) {
    const slug = (entry: unknown) =>
      object(entry) && object(entry.caseStudy)
        ? entry.caseStudy.slug
        : undefined;
    return value.some((entry, index) => {
      const next = slug(entry);
      return (
        next !== undefined &&
        next !== slug(old[index]) &&
        old.some((other, at) => at !== index && slug(other) === next)
      );
    });
  }
  function visit(path: DraftPath, value: unknown) {
    const old = getAt(working, path);
    if (equal(old, value)) return;
    if (
      Array.isArray(old) &&
      Array.isArray(value) &&
      old.length === value.length &&
      value.every(
        (entry, index) =>
          object(entry) &&
          object(old[index]) &&
          (entry.id !== undefined
            ? entry.id === old[index].id && entry.type === old[index].type
            : entry.type === old[index].type),
      ) &&
      !slugSwap(old, value)
    ) {
      for (let index = 0; index < value.length; index++)
        visit([...path, index], value[index]);
      return;
    }
    const atomic =
      (path[0] === "links" && path.length === 2) ||
      (object(old) && object(value) && old.type !== value.type) ||
      (object(old) &&
        object(value) &&
        "startDate" in value &&
        (!equal(old.startDate, value.startDate) ||
          !equal(old.endDate, value.endDate)));
    if (atomic || old === undefined || Array.isArray(value)) {
      if (fits(path, value)) {
        emit({ op: "set", path, value });
        return;
      }
      if (Array.isArray(value)) {
        rebuildArray(path, value);
        return;
      }
      emit({ op: "set", path, value: skeleton(value, path) });
    }
    if (typeof value === "string") {
      if (fits(path, value)) {
        emit({ op: "set", path, value });
        return;
      }
      if (!inspectionFreeText(inspectionSchema(path, targetTypes)))
        throw new Error("Constrained string is too large");
      commands.push({ action: "string-start", path });
      for (const text of stringPieces(value))
        commands.push({ action: "piece", text });
      commands.push({ action: "string-finish" });
      working = applyChange(working, { op: "set", path, value });
      return;
    }
    if (object(value)) {
      // A category replacement cannot leave references to its removed IDs.
      if (
        Array.isArray(value.categories) &&
        Array.isArray(value.entries) &&
        !equal(
          (
            (old as { categories?: { id: string }[] } | undefined)
              ?.categories ?? []
          ).map((entry) => entry.id),
          (value.categories as { id: string }[]).map((entry) => entry.id),
        )
      )
        emit({ op: "set", path: [...path, "entries"], value: [] });
      const current = getAt(working, path);
      if (object(current))
        for (const key of Object.keys(current))
          if (!(key in value)) emit({ op: "remove", path: [...path, key] });
      const keys = Object.keys(value).sort((a, b) =>
        a === "categories" ? -1 : b === "categories" ? 1 : 0,
      );
      for (const key of keys) visit([...path, key], value[key]);
      return;
    }
    emit({ op: "set", path, value });
  }
  // Samples must not temporarily point at entries removed during rebuilding.
  const structural =
    !equal(
      from.components.map((entry) => [entry.id, entry.type]),
      target.components.map((entry) => [entry.id, entry.type]),
    ) ||
    Object.keys(from.samples).some(
      (key) =>
        key.startsWith("profile.") &&
        getAt(target, ["profile", key.slice(8)]) === undefined,
    );
  if (structural && Object.keys(from.samples).length)
    emit({ op: "set", path: ["samples"], value: {} });
  for (const key of Object.keys(target) as (keyof DraftDoc)[])
    if (key !== "samples") visit([key], target[key]);
  visit(["samples"], target.samples);
  if (!equal(working, target))
    throw new Error("Planner did not reproduce the target");
  return commands;
}
export function batchMode(
  commands: PlannedCommand[],
): Exclude<Batch["mode"], "address"> {
  return commands.length === 0
    ? "progress"
    : commands.length === 1 && commands[0]?.action === "change"
      ? "patch"
      : "staged";
}
