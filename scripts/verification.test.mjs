import { expect, it } from "vitest";
import {
  affectedProjects,
  localProjectLimit,
  planProjects,
  projects,
} from "./verify.mjs";

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

it("sets the local project limit from the e2e worker count", () => {
  expect(localProjectLimit({}, 4)).toBe(3);
  expect(localProjectLimit({}, 16)).toBe(12);
  expect(localProjectLimit({ E2E_WORKERS: "2" }, 4)).toBe(6);
  expect(localProjectLimit({ VERIFY_MAX_PROJECTS: "8" }, 4)).toBe(8);
});

it("leaves a large affected set to CI unless projects are requested", () => {
  const affected = affectedProjects(["packages/db/src/index.ts"]);
  expect(planProjects({ affected, limit: 3 })).toEqual({
    run: [],
    deferred: projects,
  });
  expect(planProjects({ affected: ["api"], limit: 3 })).toEqual({
    run: ["api"],
    deferred: [],
  });
  expect(
    planProjects({ affected, requested: ["editor", "api"], limit: 3 }),
  ).toEqual({ run: ["editor", "api"], deferred: [] });
  expect(planProjects({ affected: [], all: true, limit: 3 })).toEqual({
    run: projects,
    deferred: [],
  });
  expect(() =>
    planProjects({ affected: [], requested: ["nope"], limit: 3 }),
  ).toThrow("Unknown e2e project: nope");
});
