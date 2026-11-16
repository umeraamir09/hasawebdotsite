import { expect, it } from "vitest";
import { affectedProjects, projects } from "./verify.mjs";

it("skips e2e for docs, CI config and unit tests", () => {
  expect(
    affectedProjects([
      "docs/roadmap.md",
      "README.md",
      ".github/workflows/ci.yml",
      "apps/web/lib/draft/planner.test.ts",
    ]),
  ).toEqual([]);
});

it("selects the projects an area can affect", () => {
  expect(affectedProjects(["packages/theme/src/palette.ts"])).toEqual([
    "editor",
    "renderer",
    "publication",
  ]);
  expect(affectedProjects(["e2e/editor/resume.mjs"])).toEqual(["editor"]);
  expect(affectedProjects(["e2e/auth.spec.mjs"])).toEqual(["auth"]);
});

it("runs everything for shared contracts and unknown paths", () => {
  expect(affectedProjects(["packages/db/src/index.ts"])).toEqual(projects);
  expect(affectedProjects(["pnpm-lock.yaml"])).toEqual(projects);
  expect(affectedProjects(["something/new.ts"])).toEqual(projects);
});
