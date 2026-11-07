import { describe, expect, it } from "vitest";
import { completeDraft } from "../../schema/src/fixtures.test-support";
import { PortfolioPage } from "./index";
import {
  parsePreviewPageModel,
  previewPageAssetUrls,
  projectPreviewPage,
} from "./model";

const ORIGIN = "https://hasaweb.site";
const options = {
  assetOrigins: [ORIGIN],
  resolveAsset: ({ assetId, purpose }: { assetId: string; purpose: string }) =>
    assetId.endsWith("-missing")
      ? { state: "unavailable" as const }
      : {
          state: "ready" as const,
          url: `${ORIGIN}/api/assets/${assetId}?purpose=${purpose}`,
          ...(purpose === "resume"
            ? { viewUrl: `${ORIGIN}/api/assets/${assetId}/view` }
            : {}),
        },
};
const draft = completeDraft;

describe("full-page preview pages", () => {
  it("projects the portfolio page like the live preview", () => {
    const page = projectPreviewPage(draft(), "/", options);
    expect(page?.page).toEqual({ kind: "portfolio" });
    expect(page?.model.components.map((component) => component.type)).toContain(
      "resume",
    );
  });
  it("projects a case study with its title, position and ready images", () => {
    const page = projectPreviewPage(draft(), "/projects/my-project", options);
    expect(page?.page.kind).toBe("case-study");
    if (page?.page.kind !== "case-study") return;
    expect(page.page.title).toBe("My project");
    expect(page.page.index).toBe(0);
    expect(page.page.images).toEqual({
      "case-image": {
        state: "ready",
        url: `${ORIGIN}/api/assets/case-image?purpose=case_study`,
      },
    });
    // Sections belong to the portfolio page; subpages carry the profile only.
    expect(page.model.components).toEqual([]);
    expect(previewPageAssetUrls(page.page)).toEqual([
      `${ORIGIN}/api/assets/case-image?purpose=case_study`,
    ]);
    expect(parsePreviewPageModel(page)).toEqual(page);
  });
  it("marks an unreadable case-study image unavailable", () => {
    const value = draft();
    const projects = value.components.find(
      (component) => component.type === "projects",
    );
    const body = projects?.data.entries[0]?.caseStudy?.body.content.at(-1);
    if (body?.type === "image") body.attrs.assetId = "case-missing";
    const page = projectPreviewPage(value, "/projects/my-project", options);
    expect(page?.page.kind === "case-study" && page.page.images).toEqual({
      "case-missing": { state: "unavailable" },
    });
  });
  it("numbers case studies in document order across entries", () => {
    const value = draft();
    const projects = value.components.find(
      (component) => component.type === "projects",
    );
    const first = projects?.data.entries[0];
    if (!projects || !first?.caseStudy) throw new Error("fixture");
    projects.data.entries = [
      {
        id: "plain",
        title: "No case study",
        summary: "",
        technologies: [],
        contribution: "",
      },
      { ...first, id: "a", caseStudy: { ...first.caseStudy, slug: "a" } },
      { ...first, id: "b", caseStudy: { ...first.caseStudy, slug: "b" } },
    ];
    const index = (path: string) => {
      const page = projectPreviewPage(value, path, options)?.page;
      return page?.kind === "case-study" ? page.index : null;
    };
    expect([index("/projects/a"), index("/projects/b")]).toEqual([0, 1]);
  });
  it("projects the resume page with the inline viewer URL", () => {
    const page = projectPreviewPage(draft(), "/resume", options);
    expect(page?.page).toEqual({
      kind: "resume",
      file: {
        state: "ready",
        url: `${ORIGIN}/api/assets/resume-pdf?purpose=resume`,
        viewUrl: `${ORIGIN}/api/assets/resume-pdf/view`,
      },
    });
  });
  it("reports pages a published portfolio would not have as unavailable", () => {
    const value = draft();
    for (const path of [
      "/projects/nope",
      "/projects/my-project/extra",
      "/projects",
      "/other",
      "/Resume",
    ])
      expect(projectPreviewPage(value, path, options), path).toBeUndefined();
    value.components = value.components.filter(
      (component) => component.type !== "resume",
    );
    expect(projectPreviewPage(value, "/resume", options)).toBeUndefined();
  });
  it("leaves out untouched sample components", () => {
    const value = draft();
    value.samples = { "components.projects-1": true };
    expect(projectPreviewPage(value, "/projects/my-project", options)).toBe(
      undefined,
    );
  });
  it("rejects malformed page models", () => {
    const page = projectPreviewPage(draft(), "/projects/my-project", options);
    expect(parsePreviewPageModel({ ...page, extra: true })).toBeUndefined();
    expect(
      parsePreviewPageModel({ model: page?.model, page: { kind: "other" } }),
    ).toBeUndefined();
    expect(
      parsePreviewPageModel({
        ...page,
        page: {
          ...page?.page,
          images: {
            "case-image": { state: "ready", url: "javascript:alert(1)" },
          },
        },
      }),
    ).toBeUndefined();
  });
  it("normalizes display strings like the live projection", () => {
    const value = draft();
    value.profile.name = "Line\r\nbreak\u0000";
    expect(projectPreviewPage(value, "/", options)?.model.profile.name).toBe(
      "Line\nbreak�",
    );
  });
  it("is exported as a view", () => {
    expect(typeof PortfolioPage).toBe("function");
  });
});
