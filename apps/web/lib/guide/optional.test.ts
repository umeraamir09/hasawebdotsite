import { createComponent } from "@hasaweb/schema";
import { describe, expect, it } from "vitest";
import { projectIncomplete, projectUntouched } from "./optional";

const blank = createComponent("projects", "p");

describe("optional guide entries", () => {
  const entry = {
    id: "e",
    title: "",
    summary: "",
    technologies: [],
    contribution: "",
  };
  it("treats only fully empty projects as untouched", () => {
    expect(projectUntouched(entry)).toBe(true);
    expect(projectUntouched({ ...entry, title: " " })).toBe(true);
    expect(projectUntouched({ ...entry, title: "App" })).toBe(false);
    expect(projectUntouched({ ...entry, technologies: ["ts"] })).toBe(false);
    expect(projectUntouched({ ...entry, demoUrl: "https://a.dev" })).toBe(
      false,
    );
  });
  it("needs a title and summary to be complete", () => {
    expect(projectIncomplete({ ...entry, title: "App" })).toBe(true);
    expect(projectIncomplete({ ...entry, title: "App", summary: "x" })).toBe(
      false,
    );
  });
  it("creates components without sample entries", () => {
    expect(blank.data.entries).toEqual([]);
  });
});
