import { expect, it } from "vitest";
import { publicationTaskBatch } from "./publication-task-batch";

it("uses an in-range publication batch and falls back to 16", () => {
  expect(publicationTaskBatch(undefined)).toBe(16);
  expect(publicationTaskBatch("")).toBe(16);
  expect(publicationTaskBatch("16")).toBe(16);
  expect(publicationTaskBatch("6")).toBe(6);
  expect(publicationTaskBatch("1")).toBe(1);
  expect(publicationTaskBatch("32")).toBe(32);
  expect(publicationTaskBatch("0")).toBe(16);
  expect(publicationTaskBatch("33")).toBe(16);
  expect(publicationTaskBatch("4.5")).toBe(16);
  expect(publicationTaskBatch("nope")).toBe(16);
});
