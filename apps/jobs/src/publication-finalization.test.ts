import { describe, expect, it } from "vitest";
import { pageMetadata } from "./publication-finalization";

const source = {
  address: "ada",
  name: "Ada Lovelace",
  bio: "Writes programs for engines.",
  bannerId: "banner-1",
  bannerAlt: "Punched cards",
  title: null,
  description: null,
  ogImageId: null,
  projectTitle: null,
};
const url = (id: string) => `https://assets.example/candidate/c/assets/${id}`;

describe("published page metadata", () => {
  it("uses profile defaults and the banner on the portfolio root", () => {
    expect(pageMetadata(source, "/", url)).toEqual({
      title: "Ada Lovelace",
      metadata: {
        description: "Writes programs for engines.",
        canonicalUrl: "https://ada.hasaweb.site/",
        image: {
          url: "https://assets.example/candidate/c/assets/banner-1",
          alt: "Punched cards",
        },
      },
    });
  });

  it("applies overrides and page-specific titles on every page", () => {
    const owner = {
      ...source,
      title: "Ada · Analyst",
      description: "Notes on the engine",
      ogImageId: "og-1",
    };
    const study = pageMetadata(
      { ...owner, projectTitle: "Analytical Engine" },
      "/projects/analytical-engine",
      url,
    );
    expect(study.title).toBe("Analytical Engine · Ada Lovelace");
    expect(study.metadata).toEqual({
      description: "Notes on the engine",
      canonicalUrl: "https://ada.hasaweb.site/projects/analytical-engine",
      image: { url: url("og-1"), alt: "" },
    });
    expect(pageMetadata(owner, "/resume", url).title).toBe(
      "Resume · Ada Lovelace",
    );
    expect(pageMetadata(owner, "/", url).title).toBe("Ada · Analyst");
  });
});
