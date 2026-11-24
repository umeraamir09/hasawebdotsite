import { describe, expect, it } from "vitest";
import { matchSkills } from "./skill-suggestions";

describe("skill suggestions", () => {
  it("puts names that start with the query first", () => {
    expect(matchSkills("f", [])).toEqual(["Fastify", "Figma", "Firebase"]);
    expect(matchSkills("script", [], 5)).toEqual(["JavaScript", "TypeScript"]);
  });

  it("ignores case and leaves out entered names", () => {
    expect(matchSkills("FIG", [])).toEqual(["Figma"]);
    expect(matchSkills("fi", [" figma "])).toEqual(["Firebase"]);
  });

  it("suggests nothing for an empty query", () => {
    expect(matchSkills("  ", [])).toEqual([]);
  });
});
