import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { browserSelection, createGroupRunner } from "./lib/browser-groups.mjs";

const names = Array.from({ length: 11 }, (_, i) => `group ${i}`);
const temporary = [];
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});

it("shards partition every selected group exactly once", () => {
  const seen = [];
  for (let k = 1; k <= 3; k++) {
    const selection = browserSelection([`--browser-shard=${k}/3`]);
    seen.push(...names.filter((name) => selection.includes(name)));
  }
  expect(seen.sort()).toEqual([...names].sort());
  const filtered = browserSelection([
    "--browser-filter=group 1",
    "--browser-shard=2/2",
  ]);
  // "group 1" and "group 10" match; the second shard takes the second match.
  expect(names.filter((name) => filtered.includes(name))).toEqual(["group 10"]);
});

it("rejects malformed shards", () => {
  for (const shard of ["0/2", "3/2", "1", "a/b"])
    expect(() => browserSelection([`--browser-shard=${shard}`])).toThrow(
      /--browser-shard/,
    );
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
    argv: [],
  });
  await run("passes", async () => {});
  expect(checks).toEqual([
    { name: "passes", passed: true, seconds: expect.any(Number) },
  ]);
  await expect(
    run("hangs", async () => {
      errors.push("late page error");
      await new Promise(() => {});
    }),
  ).rejects.toThrow("fixture group exceeded 0.05s: hangs");
  const report = JSON.parse(
    await readFile(join(evidence, "fixture-failure-1.json"), "utf8"),
  );
  expect(report).toMatchObject({
    group: "hangs",
    pageErrors: ["late page error"],
  });
  expect(checks).toHaveLength(1);
});
