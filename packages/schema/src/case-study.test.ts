import { describe, expect, it } from "vitest";
import {
  assignCaseStudySlug,
  CASE_STUDY_SLUG_MAX,
  caseStudyPath,
  caseStudySlugBase,
  caseStudySlugCandidate,
  caseStudySlugSchema,
  reconcileCaseStudySlugs,
} from "./case-study";

const entry = (id: string, title: string, slug?: string) => ({
  id,
  title,
  ...(slug ? { caseStudy: { slug } } : {}),
});

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (!item) throw new Error("Missing test entry");
  return item;
}

describe("case-study slug generation", () => {
  it.each([
    ["My Project", "my-project"],
    ["  Hello,   World!!  ", "hello-world"],
    ["C++ & Rust: a comparison", "c-rust-a-comparison"],
    ["Café déjà vu", "cafe-deja-vu"],
    ["---", "project"],
    ["日本語", "project"],
    ["", "project"],
    ["API v2.0", "api-v2-0"],
  ])("generates %j as %j", (title, slug) => {
    expect(caseStudySlugBase(title)).toBe(slug);
    expect(caseStudySlugSchema.safeParse(slug).success).toBe(true);
  });

  it("limits slugs to 80 characters without a trailing hyphen", () => {
    const base = caseStudySlugBase(`${"a".repeat(79)} b c`);
    expect(base.length).toBeLessThanOrEqual(CASE_STUDY_SLUG_MAX);
    expect(base.endsWith("-")).toBe(false);
    expect(caseStudySlugBase("x".repeat(200))).toBe("x".repeat(80));
  });

  it("truncates the base to fit numeric suffixes", () => {
    const base = "x".repeat(80);
    expect(caseStudySlugCandidate(base, 2)).toBe(`${"x".repeat(78)}-2`);
    expect(caseStudySlugCandidate(base, 10)).toBe(`${"x".repeat(77)}-10`);
    const hyphenated = `${"x".repeat(77)}-yy`;
    expect(caseStudySlugCandidate(hyphenated, 2)).toBe(`${"x".repeat(77)}-2`);
    for (const n of [2, 10, 100])
      expect(caseStudySlugCandidate(base, n).length).toBeLessThanOrEqual(80);
  });

  it("resolves collisions within the draft with -2, -3 suffixes", () => {
    const entries = [
      entry("a", "Demo", "demo"),
      entry("b", "Demo", "demo-2"),
      entry("c", "Demo"),
    ];
    expect(assignCaseStudySlug(at(entries, 2), entries, [])).toBe("demo-3");
  });

  it("regenerates from the title before first publication", () => {
    const entries = [entry("a", "Renamed project", "old-title")];
    expect(assignCaseStudySlug(at(entries, 0), entries, [])).toBe(
      "renamed-project",
    );
  });

  it("keeps the frozen slug after a title edit", () => {
    const entries = [entry("a", "A brand new title", "original")];
    expect(
      assignCaseStudySlug(at(entries, 0), entries, [
        { projectId: "a", slug: "original" },
      ]),
    ).toBe("original");
  });

  it("does not give a still-live slug of a deleted project to a new project", () => {
    // Project "old" was deleted in the draft, but its deletion is unpublished.
    const entries = [entry("new", "Original")];
    expect(
      assignCaseStudySlug(at(entries, 0), entries, [
        { projectId: "old", slug: "original" },
      ]),
    ).toBe("original-2");
  });

  it("allows reuse only after the deletion is published", () => {
    const entries = [entry("new", "Original")];
    expect(assignCaseStudySlug(at(entries, 0), entries, [])).toBe("original");
  });

  it("keeps legacy unindexed slugs by name", () => {
    const entries = [entry("a", "Changed", "legacy"), entry("b", "Legacy")];
    const published = [{ projectId: null, slug: "legacy" }];
    expect(assignCaseStudySlug(at(entries, 0), entries, published)).toBe(
      "legacy",
    );
    expect(assignCaseStudySlug(at(entries, 1), entries, published)).toBe(
      "legacy-2",
    );
  });

  it("reconciles stale drafts against the live manifest", () => {
    const result = reconcileCaseStudySlugs(
      [
        // A stale tab took a live slug for a different project.
        entry("new", "Original", "original"),
        // A stale tab regenerated a frozen slug after a title edit.
        entry("kept", "Renamed", "renamed"),
        entry("plain", "Plain", "plain"),
        entry("none", "No case study"),
      ],
      [
        { projectId: "old", slug: "original" },
        { projectId: "kept", slug: "first-title" },
      ],
    );
    expect(Object.fromEntries(result)).toEqual({
      new: "original-2",
      kept: "first-title",
      plain: "plain",
    });
  });

  it("restores a frozen slug that another draft entry had taken", () => {
    const result = reconcileCaseStudySlugs(
      [entry("other", "Shared", "shared"), entry("owner", "Shared", "x")],
      [{ projectId: "owner", slug: "shared" }],
    );
    expect(Object.fromEntries(result)).toEqual({
      owner: "shared",
      other: "shared-2",
    });
  });

  it("builds only valid project paths", () => {
    expect(caseStudyPath("demo-2")).toBe("/projects/demo-2");
    expect(() => caseStudyPath("../x")).toThrow();
  });
});
