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

it("plans the same seven hosted e2e jobs for every code change", async () => {
  const { ciMatrix } = await import("./ci-plan.mjs");
  const hosted = [
    ["editor 1/3", "--project=editor --shard=1/3"],
    ["editor 2/3", "--project=editor --shard=2/3"],
    ["editor 3/3", "--project=editor --shard=3/3"],
    ["autosave", "--project=autosave"],
    ["uploads and auth", "--project=uploads --project=auth"],
    ["renderer and runtime", "--project=renderer --project=runtime"],
    ["publication and api", "--project=publication --project=api"],
  ].map(([name, args]) => ({ name, args, workers: "1" }));
  for (const affected of [[], ["api"], [...projects]])
    expect(ciMatrix({ affected, selfHosted: false })).toEqual(hosted);
});

it("plans one two-worker e2e job on a self-hosted runner", async () => {
  const { ciMatrix } = await import("./ci-plan.mjs");
  expect(ciMatrix({ affected: ["auth", "api"], selfHosted: true })).toEqual([
    { name: "auth, api", args: "--project=auth --project=api", workers: "2" },
  ]);
  expect(ciMatrix({ affected: [], selfHosted: true })).toEqual([]);
});

it("runs every project when CI itself changes", async () => {
  const { ciAffected } = await import("./ci-plan.mjs");
  for (const path of [
    ".github/workflows/ci.yml",
    "scripts/ci-plan.mjs",
    "scripts/verify.mjs",
  ])
    expect(ciAffected(["docs/roadmap.md", path])).toEqual(projects);
  expect(ciAffected(["docs/roadmap.md"])).toEqual([]);
  expect(ciAffected(["packages/email/src/index.ts"])).toEqual(["api"]);
});
