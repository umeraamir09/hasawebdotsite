import { describe, expect, it } from "vitest";
import { addressCandidates } from "./address-suggestions";

describe("address candidates", () => {
  it("derives joined, hyphenated and single-word names", () => {
    expect(addressCandidates("Umer Aamir")).toEqual([
      "umeraamir",
      "umer-aamir",
      "umer",
      "aamir",
    ]);
  });

  it("removes accents and other characters", () => {
    expect(addressCandidates("  Zoë O'Brien ")).toEqual([
      "zoeobrien",
      "zoe-o-brien",
      "zoe",
      "brien",
    ]);
  });

  it("drops names outside the address rules and the current value", () => {
    expect(addressCandidates("Al")).toEqual([]);
    expect(addressCandidates("Ana Li", "anali")).toEqual(["ana-li", "ana"]);
    expect(addressCandidates("")).toEqual([]);
    const long = addressCandidates(`${"a".repeat(20)} ${"b".repeat(20)}`);
    expect(long.every((name) => name.length <= 30)).toBe(true);
  });

  it("deduplicates a single-word name", () => {
    expect(addressCandidates("Prince")).toEqual(["prince"]);
  });
});
