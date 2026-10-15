import { z } from "zod";

export const DRAFT_MAX_BYTES = 1_048_576;
export const JSON_MAX_DEPTH = 64;

// Inspect before Zod's recursive schemas or JSON.stringify can exhaust the stack.
// Reject values JSON would silently remove or change.
export function assertJson(input: unknown, maxBytes = DRAFT_MAX_BYTES): void {
  const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (depth > JSON_MAX_DEPTH)
      throw new Error("JSON nesting exceeds 64 levels");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object") throw new Error("Expected JSON data");
    if (ancestors.has(value)) throw new Error("Cyclic JSON data");
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error("Expected a plain JSON object");
    if (Object.getOwnPropertySymbols(value).length)
      throw new Error("Symbol properties are not JSON");
    ancestors.add(value);
    const keys = Object.keys(value);
    if (
      array &&
      (keys.length !== value.length ||
        keys.some((key, index) => key !== String(index)))
    )
      throw new Error("Sparse or extended arrays are not JSON");
    const ownNames = Object.getOwnPropertyNames(value);
    if (ownNames.length !== keys.length + (array ? 1 : 0))
      throw new Error("Non-enumerable properties are not JSON");
    for (const key of keys) {
      if (key === "__proto__" || key === "constructor" || key === "prototype")
        throw new Error("Prototype keys are not allowed in draft JSON");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor))
        throw new Error("JSON cannot contain accessors");
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  }
  visit(input, 0);
  const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (bytes > maxBytes)
    throw new Error(`Draft exceeds ${maxBytes} UTF-8 bytes`);
}

export const boundedJsonSchema = z.unknown().superRefine((input, ctx) => {
  try {
    assertJson(input);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid JSON",
    });
  }
});

export function cloneJson<T>(input: T): T {
  assertJson(input);
  return JSON.parse(JSON.stringify(input)) as T;
}
