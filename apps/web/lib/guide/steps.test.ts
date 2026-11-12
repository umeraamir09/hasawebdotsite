import { describe, expect, it } from "vitest";
import {
  canEnter,
  firstIncompleteStep,
  guideSteps,
  isSkippable,
  nextStep,
  previousStep,
  remainingTarget,
  requiredIssues,
  resumeStep,
  stepFields,
} from "./steps";

describe("guide steps", () => {
  it("uses the agreed seven-step order", () => {
    expect(guideSteps).toEqual([
      "address",
      "profile",
      "links",
      "skills",
      "projects",
      "github",
      "review",
    ]);
    expect(nextStep("address")).toBe("profile");
    expect(nextStep("review")).toBeNull();
    expect(previousStep("address")).toBeNull();
    expect(previousStep("profile")).toBe("address");
  });

  it("shows only the first step until the server facts are known", () => {
    expect(resumeStep("review", null)).toBe("address");
    expect(resumeStep("profile", null)).toBe("address");
    expect(canEnter("address", null)).toBe(true);
  });

  it("maps required fields to their earliest step", () => {
    expect(firstIncompleteStep(["links", "bio", "address"])).toBe("address");
    expect(firstIncompleteStep(["banner", "links"])).toBe("profile");
    expect(firstIncompleteStep(["links"])).toBe("links");
    expect(firstIncompleteStep([])).toBeNull();
  });

  it("clamps forged or stale progress to the first incomplete required step", () => {
    const fresh = [
      "address",
      "name",
      "bio",
      "avatar",
      "banner",
      "links",
    ] as const;
    expect(resumeStep("review", fresh)).toBe("address");
    expect(resumeStep("github", ["name", "links"])).toBe("profile");
    expect(resumeStep("skills", ["links"])).toBe("links");
    expect(canEnter("links", ["avatar"])).toBe(false);
  });

  it("resumes saved progress up to the first incomplete step", () => {
    expect(resumeStep("profile", ["name", "links"])).toBe("profile");
    expect(resumeStep("address", ["name"])).toBe("address");
    expect(resumeStep("github", [])).toBe("github");
    expect(resumeStep(undefined, [])).toBe("address");
  });

  it("reads issues from setup results", () => {
    expect(
      requiredIssues({
        kind: "required",
        portfolioId: "p",
        revision: 2,
        issues: ["links"],
      }),
    ).toEqual(["links"]);
    expect(
      requiredIssues({ kind: "ready", portfolioId: "p", revision: 2 }),
    ).toEqual([]);
  });

  it("names the required fields each screen owns", () => {
    expect(stepFields.profile).toEqual(["name", "bio", "avatar", "banner"]);
    expect(stepFields.links).toEqual(["links"]);
  });
});

describe("optional step navigation", () => {
  it("skips only optional screens and Skip remaining lands on Review", () => {
    expect(isSkippable("skills")).toBe(true);
    expect(isSkippable("projects")).toBe(true);
    expect(isSkippable("github")).toBe(true);
    expect(isSkippable("links")).toBe(false);
    expect(isSkippable("review")).toBe(false);
    expect(nextStep("github")).toBe("review");
    expect(remainingTarget).toBe("review");
    expect(nextStep("skills")).toBe("projects");
  });
});
