import { describe, expect, it } from "vitest";
import {
  clipSeoText,
  resolveSeo,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  seoPageTitle,
  seoSchema,
  validateDraftValue,
} from "./index";

const profile = {
  name: "Ada Lovelace",
  bio: "I write programs for engines that do not exist yet.",
  banner: { assetId: "banner-1", alt: "Punched cards" },
};

describe("search and sharing defaults", () => {
  it("derives title, description and image from the profile", () => {
    expect(resolveSeo({ profile, seo: {} })).toEqual({
      title: "Ada Lovelace",
      description: "I write programs for engines that do not exist yet.",
      image: { assetId: "banner-1", purpose: "banner", alt: "Punched cards" },
      identity: "Ada Lovelace",
      overridden: { title: false, description: false, image: false },
    });
  });

  it("uses owner overrides, and empty overrides return to the default", () => {
    const resolved = resolveSeo({
      profile,
      seo: {
        title: "  Ada · Analyst  ",
        description: "Notes\non the\tengine\u0000\u007f",
        ogImage: { assetId: "og-1" },
      },
    });
    expect(resolved.title).toBe("Ada · Analyst");
    expect(resolved.description).toBe("Notes on the engine");
    expect(resolved.image).toEqual({ assetId: "og-1", purpose: "og", alt: "" });
    expect(resolved.overridden).toEqual({
      title: true,
      description: true,
      image: true,
    });
    const cleared = resolveSeo({
      profile,
      seo: { title: " ", description: "" },
    });
    expect(cleared.title).toBe("Ada Lovelace");
    expect(cleared.description).toBe(profile.bio);
    expect(cleared.overridden.title).toBe(false);
  });

  it("trims a long bio on a word boundary", () => {
    const bio = `${"word ".repeat(60)}end`;
    const { description } = resolveSeo({
      profile: { ...profile, bio },
      seo: {},
    });
    expect(Array.from(description).length).toBeLessThanOrEqual(
      SEO_DESCRIPTION_MAX,
    );
    expect(description).toMatch(/^word( word)*…$/);
  });

  it("clips without splitting a word, punctuation or a surrogate pair", () => {
    expect(clipSeoText("short", 10)).toBe("short");
    expect(clipSeoText("alpha beta, gamma delta", 14)).toBe("alpha beta…");
    expect(clipSeoText("x".repeat(20), 8)).toBe("xxxxxxx…");
    const emoji = clipSeoText("😀".repeat(10), 5);
    expect(emoji).toBe("😀😀😀😀…");
  });

  it("has no image without a banner or override, and a fallback title", () => {
    const resolved = resolveSeo({
      profile: { name: " ", bio: "" },
      seo: {},
    });
    expect(resolved).toMatchObject({
      title: "Portfolio",
      description: "",
      image: null,
      identity: "Portfolio",
    });
  });
});

describe("page-specific titles", () => {
  const resolved = resolveSeo({
    profile,
    seo: { title: "Ada Lovelace · First programmer" },
  });

  it("names the portfolio on case studies and the resume", () => {
    expect(seoPageTitle(resolved, { kind: "home" })).toBe(
      "Ada Lovelace · First programmer",
    );
    expect(
      seoPageTitle(resolved, {
        kind: "case-study",
        projectTitle: "Analytical\nEngine",
      }),
    ).toBe("Analytical Engine · Ada Lovelace");
    expect(seoPageTitle(resolved, { kind: "resume" })).toBe(
      "Resume · Ada Lovelace",
    );
    expect(
      seoPageTitle(resolved, { kind: "case-study", projectTitle: "  " }),
    ).toBe("Untitled project · Ada Lovelace");
  });
});

describe("schema limits", () => {
  it("bounds owner overrides in full and incremental validation", () => {
    expect(
      seoSchema.safeParse({
        title: "t".repeat(SEO_TITLE_MAX),
        description: "d".repeat(SEO_DESCRIPTION_MAX),
      }).success,
    ).toBe(true);
    expect(
      seoSchema.safeParse({ title: "t".repeat(SEO_TITLE_MAX + 1) }).success,
    ).toBe(false);
    expect(
      seoSchema.safeParse({
        description: "d".repeat(SEO_DESCRIPTION_MAX + 1),
      }).success,
    ).toBe(false);
    expect(() =>
      validateDraftValue(["seo", "title"], {}, "t".repeat(SEO_TITLE_MAX + 1)),
    ).toThrow();
    expect(validateDraftValue(["seo", "title"], {}, "Ada")).toBe('"Ada"');
  });
});
