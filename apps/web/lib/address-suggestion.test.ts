import { describe, expect, it } from "vitest";
import {
  normalizeAddressSuggestion,
  storeAddressSuggestion,
  takeAddressSuggestion,
} from "./address-suggestion";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("entry page address suggestion", () => {
  it("accepts only names the Address step would accept", () => {
    expect(normalizeAddressSuggestion("  Umer ")).toBe("umer");
    expect(normalizeAddressSuggestion("umer.hasaweb.site")).toBe("umer");
    expect(normalizeAddressSuggestion("my-site-2")).toBe("my-site-2");
    for (const invalid of [
      "",
      "ab",
      "-umer",
      "umer-",
      "um er",
      "ümer",
      "a".repeat(31),
    ])
      expect(normalizeAddressSuggestion(invalid)).toBeNull();
  });

  it("prefills at most once and never returns a tampered value", () => {
    const storage = memoryStorage();
    storeAddressSuggestion("umer", storage);
    expect(takeAddressSuggestion(storage)).toBe("umer");
    expect(takeAddressSuggestion(storage)).toBeNull();
    storage.setItem("hasaweb-address-suggestion-v1", "<script>");
    expect(takeAddressSuggestion(storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("treats unavailable storage as no suggestion", () => {
    const blocked = {
      ...memoryStorage(),
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    } as Storage;
    expect(() => storeAddressSuggestion("umer", blocked)).not.toThrow();
    expect(takeAddressSuggestion(blocked)).toBeNull();
    expect(takeAddressSuggestion(null)).toBeNull();
  });
});
