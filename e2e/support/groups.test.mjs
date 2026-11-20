import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createGroupRunner, groupFilter } from "./groups.mjs";

const names = Array.from({ length: 11 }, (_, i) => `group ${i}`);
const temporary = [];
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});

it("filters groups by regular expression", () => {
  const included = groupFilter("group 1");
  // "group 1" and "group 10" match.
  expect(names.filter(included)).toEqual(["group 1", "group 10"]);
  expect(names.filter(groupFilter(undefined))).toEqual(names);
});

it("reports each group as a named step", async () => {
  const steps = [];
  const run = createGroupRunner({
    label: "fixture",
    evidence: tmpdir(),
    checks: [],
    getPage: () => null,
    filter: "^b$",
    step: async (name, body) => {
      steps.push(name);
      return body();
    },
  });
  await run("a", async () => {});
  await run("b", async () => {});
  expect(steps).toEqual(["b"]);
});

it("fails a stuck group by name and records its evidence", async () => {
  const evidence = await mkdtemp(join(tmpdir(), "browser-groups-"));
  temporary.push(evidence);
  const checks = [];
  const errors = [];
  const run = createGroupRunner({
    label: "fixture",
    evidence,
    checks,
    errors,
    getPage: () => null,
    limitMs: 50,
    filter: undefined,
  });
  await run("passes", async () => {});
  expect(checks).toEqual([
    { name: "passes", passed: true, seconds: expect.any(Number) },
  ]);
  await expect(
    run("hangs", async (mark) => {
      mark("waiting forever");
      errors.push("late page error");
      await new Promise(() => {});
    }),
  ).rejects.toThrow(
    "fixture group exceeded 0.05s: hangs (at step: waiting forever)",
  );
  const report = JSON.parse(
    await readFile(join(evidence, "fixture-failure-1.json"), "utf8"),
  );
  expect(report).toMatchObject({
    group: "hangs",
    step: "waiting forever",
    pageErrors: ["late page error"],
  });
  expect(checks).toHaveLength(1);
});
